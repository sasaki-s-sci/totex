//! A shell held open at the far end of a reach, and commands handed to it down
//! a pipe.
//!
//! `wsl.exe` costs tens of milliseconds before the program it was asked for
//! starts, and an `ssh` connection costs a handshake across a network; a scan
//! of a folder of repositories is hundreds of small git runs — the difference
//! between a graph that appears and one that arrives. So a machine is opened
//! once and reused. What comes back is framed by length rather than delimited,
//! because the answers are file contents and a file holds every byte a
//! delimiter could be.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::process::{Child, ChildStdin, ChildStdout, Stdio};
use std::sync::{Mutex, OnceLock};

use super::{Reach, line};
use crate::base64::encode;

/// How many held-open shells a machine keeps. The scan walks repositories in
/// parallel and each worker wants a shell of its own; past that they queue,
/// which is what they would do for the CPU anyway.
const CHANNELS: usize = 8;

/// The shell held open at the far end of a channel.
///
/// Reads one base64 command per line, runs it, and answers with a header naming
/// the exit code and the two lengths, then exactly those bytes. The output goes
/// through files rather than a pipe so that the lengths are known before
/// anything is sent. Every command is given `/dev/null` to read: a channel is
/// shared, and one command waiting on a prompt would hold up everything behind.
/// Each runs in a subshell of its own for the same reason: a command line
/// begins with `cd`, and a shell that kept that directory would carry it into
/// the next command — and, once the directory was removed, complain about it
/// on every command's stderr after.
const RUNNER: &str = r#"
out=$(mktemp) || exit 1
err=$(mktemp) || exit 1
trap 'rm -f "$out" "$err"' EXIT INT TERM HUP
while IFS= read -r line; do
  [ -n "$line" ] || continue
  cmd=$(printf '%s\n' "$line" | base64 -d) || cmd='exit 127'
  ( eval "$cmd" ) >"$out" 2>"$err" </dev/null
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
    /// What to say when the far end goes quiet, which names the kind of far end
    /// it was.
    gone: &'static str,
}

impl Channel {
    fn open(reach: &Reach) -> Result<Self, String> {
        let gone = reach.unreachable();
        let mut child = reach
            .command(&["sh", "-c", RUNNER])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|error| format!("{gone}: {error}"))?;
        let input = child.stdin.take().ok_or("no-input")?;
        let output = BufReader::new(child.stdout.take().ok_or("no-output")?);
        Ok(Self {
            child,
            input,
            output,
            gone,
        })
    }

    fn request(&mut self, command: &str) -> Result<Output, String> {
        let gone = self.gone;
        self.input
            .write_all(encode(command.as_bytes()).as_bytes())
            .and_then(|_| self.input.write_all(b"\n"))
            .and_then(|_| self.input.flush())
            // A pipe already closed is the far end gone before it read a
            // word: the same bridge failure as an empty answer below, met a
            // moment earlier.
            .map_err(|error| {
                if error.kind() == std::io::ErrorKind::BrokenPipe {
                    gone.to_string()
                } else {
                    error.to_string()
                }
            })?;

        let mut header = String::new();
        self.output
            .read_line(&mut header)
            .map_err(|error| error.to_string())?;
        // Nothing at all is the bridge itself failing rather than the shell
        // answering wrongly: `ssh` that could not connect starts fine and then
        // closes its pipe, and so does a distribution that was shut down.
        if header.is_empty() {
            return Err(self.gone.to_string());
        }
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

fn take(key: &str) -> Option<Channel> {
    crate::sync::lock(pool()).get_mut(key)?.pop()
}

fn give(key: &str, channel: Channel) {
    let mut held = crate::sync::lock(pool());
    let channels = held.entry(key.to_string()).or_default();
    if channels.len() < CHANNELS {
        channels.push(channel);
    }
}

/// Runs one command at the far end of `reach` and waits for it.
///
/// A channel that fails is not handed back — the shell at the far end is gone,
/// or has lost its place in the protocol — and the command is tried once more on
/// a new one, which is what a distribution that was restarted or a connection
/// that was dropped looks like.
pub fn exec(
    reach: &Reach,
    cwd: Option<&str>,
    env: &[(&str, &str)],
    argv: &[&str],
) -> Result<Output, String> {
    let command = line(cwd, env, argv);
    let key = reach.key();
    let mut last = None;
    for _ in 0..2 {
        let mut channel = match take(&key) {
            Some(channel) => channel,
            None => Channel::open(reach)?,
        };
        match channel.request(&command) {
            Ok(output) => {
                give(&key, channel);
                return Ok(output);
            }
            Err(error) => last = Some(error),
        }
    }
    Err(last.unwrap_or_else(|| reach.unreachable().to_string()))
}

/// Runs a shell script at the far end of `reach`, with `args` as `$1` onwards.
/// Passing the arguments as arguments is what keeps a file name with a quote in
/// it from being read as part of the script.
pub fn script(
    reach: &Reach,
    cwd: Option<&str>,
    body: &str,
    args: &[&str],
) -> Result<Output, String> {
    let mut argv = vec!["sh", "-c", body, "totex"];
    argv.extend_from_slice(args);
    exec(reach, cwd, &[], &argv)
}
