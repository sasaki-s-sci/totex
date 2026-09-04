//! A shell held open inside a distribution, and commands handed to it down a
//! pipe.
//!
//! `wsl.exe` costs tens of milliseconds before the program it was asked for
//! starts, and a scan of a folder of repositories is hundreds of small git runs
//! — the difference between a graph that appears and one that arrives. So a
//! distribution is opened once and reused. What comes back is framed by length
//! rather than delimited, because the answers are file contents and a file holds
//! every byte a delimiter could be.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::process::{Child, ChildStdin, ChildStdout, Stdio};
use std::sync::{Mutex, OnceLock};

use super::shell::{command, line};
use crate::base64::encode;

/// How many held-open shells a distribution keeps. The scan walks repositories
/// in parallel and each worker wants a shell of its own; past that they queue,
/// which is what they would do for the CPU anyway.
const CHANNELS: usize = 8;

/// The shell held open at the far end of a channel.
///
/// Reads one base64 command per line, runs it, and answers with a header naming
/// the exit code and the two lengths, then exactly those bytes. The output goes
/// through files rather than a pipe so that the lengths are known before
/// anything is sent. Every command is given `/dev/null` to read: a channel is
/// shared, and one command waiting on a prompt would hold up everything behind.
const RUNNER: &str = r#"
out=$(mktemp) || exit 1
err=$(mktemp) || exit 1
trap 'rm -f "$out" "$err"' EXIT INT TERM HUP
while IFS= read -r line; do
  [ -n "$line" ] || continue
  cmd=$(printf '%s\n' "$line" | base64 -d) || cmd='exit 127'
  eval "$cmd" >"$out" 2>"$err" </dev/null
  code=$?
  printf 'R %s %s %s\n' "$code" "$(wc -c <"$out")" "$(wc -c <"$err")"
  cat "$out"
  cat "$err"
done
"#;

/// What one command said.
#[derive(Debug, Clone)]
pub struct Output {
    pub code: i32,
    pub stdout: Vec<u8>,
    pub stderr: Vec<u8>,
}

impl Output {
    pub fn ok(&self) -> bool {
        self.code == 0
    }

    pub fn text(&self) -> String {
        String::from_utf8_lossy(&self.stdout).into_owned()
    }
}

struct Channel {
    child: Child,
    input: ChildStdin,
    output: BufReader<ChildStdout>,
}

impl Channel {
    fn open(distro: &str) -> Result<Self, String> {
        let mut child = command(distro, None)
            .arg("-e")
            .arg("sh")
            .arg("-c")
            .arg(RUNNER)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|error| format!("wsl-unreachable: {error}"))?;
        let input = child.stdin.take().ok_or("no-input")?;
        let output = BufReader::new(child.stdout.take().ok_or("no-output")?);
        Ok(Self {
            child,
            input,
            output,
        })
    }

    fn request(&mut self, command: &str) -> Result<Output, String> {
        self.input
            .write_all(encode(command.as_bytes()).as_bytes())
            .and_then(|_| self.input.write_all(b"\n"))
            .and_then(|_| self.input.flush())
            .map_err(|error| error.to_string())?;

        let mut header = String::new();
        self.output
            .read_line(&mut header)
            .map_err(|error| error.to_string())?;
        let (code, out_len, err_len) = parse_header(&header)?;

        let mut stdout = vec![0u8; out_len];
        let mut stderr = vec![0u8; err_len];
        self.output
            .read_exact(&mut stdout)
            .and_then(|_| self.output.read_exact(&mut stderr))
            .map_err(|error| error.to_string())?;

        Ok(Output {
            code,
            stdout,
            stderr,
        })
    }
}

impl Drop for Channel {
    fn drop(&mut self) {
        // Closing the pipe ends the loop on its own; the kill is for a shell
        // stuck inside a command that will never finish.
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

/// `R <code> <stdout bytes> <stderr bytes>`, and nothing else is that line.
pub(super) fn parse_header(line: &str) -> Result<(i32, usize, usize), String> {
    let mut fields = line.split_whitespace();
    if fields.next() != Some("R") {
        return Err("channel-desynced".to_string());
    }
    let mut number = || {
        fields
            .next()
            .and_then(|value| value.parse::<i64>().ok())
            .ok_or_else(|| "channel-desynced".to_string())
    };
    let code = number()? as i32;
    let out_len = number()?.max(0) as usize;
    let err_len = number()?.max(0) as usize;
    Ok((code, out_len, err_len))
}

type Pool = Mutex<HashMap<String, Vec<Channel>>>;

fn pool() -> &'static Pool {
    static POOL: OnceLock<Pool> = OnceLock::new();
    POOL.get_or_init(Pool::default)
}

fn take(distro: &str) -> Option<Channel> {
    crate::sync::lock(pool()).get_mut(distro)?.pop()
}

fn give(distro: &str, channel: Channel) {
    let mut held = crate::sync::lock(pool());
    let channels = held.entry(distro.to_string()).or_default();
    if channels.len() < CHANNELS {
        channels.push(channel);
    }
}

/// Runs one command inside `distro` and waits for it.
///
/// A channel that fails is not handed back — the shell at the far end is gone,
/// or has lost its place in the protocol — and the command is tried once more on
/// a new one, which is what a distribution that was restarted looks like.
pub fn exec(
    distro: &str,
    cwd: Option<&str>,
    env: &[(&str, &str)],
    argv: &[&str],
) -> Result<Output, String> {
    let command = line(cwd, env, argv);
    let mut last = None;
    for _ in 0..2 {
        let mut channel = match take(distro) {
            Some(channel) => channel,
            None => Channel::open(distro)?,
        };
        match channel.request(&command) {
            Ok(output) => {
                give(distro, channel);
                return Ok(output);
            }
            Err(error) => last = Some(error),
        }
    }
    Err(last.unwrap_or_else(|| "wsl-unreachable".to_string()))
}

/// Runs a shell script inside `distro`, with `args` as `$1` onwards. Passing the
/// arguments as arguments is what keeps a file name with a quote in it from
/// being read as part of the script.
pub fn script(
    distro: &str,
    cwd: Option<&str>,
    body: &str,
    args: &[&str],
) -> Result<Output, String> {
    let mut argv = vec!["sh", "-c", body, "totex"];
    argv.extend_from_slice(args);
    exec(distro, cwd, &[], &argv)
}
