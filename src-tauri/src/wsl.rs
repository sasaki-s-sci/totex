//! Reaching into a WSL distribution instead of at the share it publishes.
//!
//! Windows shows a distribution's filesystem as `\\wsl.localhost\<distro>\...`,
//! and that share is enough to read bytes with. It is not enough to work in: a
//! `git` run from Windows over 9p reads a Linux checkout with the wrong line
//! endings and the wrong file modes, `cmd` refuses a UNC directory outright,
//! the coding agents are installed inside the distribution and not beside the
//! window, and Windows' own change notifications never fire for the share. So
//! a path that names a distribution is worked on *inside* it, and the share is
//! left as the fallback for when there is no distribution to reach.
//!
//! Everything here is one distribution and one Linux path — [`Location`] — got
//! from the UNC spelling, which stays the canonical form the rest of the app
//! passes around. Nothing else has to know a path is remote until it runs
//! something.
//!
//! ## Why a channel rather than a command
//!
//! `wsl.exe` costs tens of milliseconds before the program it was asked for
//! starts, and a scan of a folder of repositories is hundreds of small git
//! runs. Paying that per run is the difference between a graph that appears and
//! one that arrives. So a distribution is opened once — a shell, held open —
//! and commands are handed to it down a pipe. What comes back is framed by
//! length rather than delimited, because the answers are file contents and a
//! file holds every byte a delimiter could be.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::{Mutex, OnceLock};

/// The prefix Windows publishes a distribution's filesystem under, and the one
/// older builds published it under before that.
const PREFIXES: [&str; 2] = [r"\\wsl.localhost\", r"\\wsl$\"];

/// The one this app writes, so a path means the same thing every time it is
/// compared, keyed on or stored.
const CANONICAL: &str = r"\\wsl.localhost\";

/// How many held-open shells a distribution keeps.
///
/// The scan walks repositories in parallel and each worker wants a shell of its
/// own; past that they queue, which is what they would do for the CPU anyway.
const CHANNELS: usize = 8;

/// A path inside a WSL distribution: which one, and where in it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Location {
    pub distro: String,
    /// An absolute Linux path — `/home/a/repo`, never the UNC spelling.
    pub path: String,
}

/// Reads the UNC spelling of a WSL path, or `None` when it is not one.
///
/// Done on the string rather than through `Path`, because the answer must be
/// the same on both platforms: this runs in a Linux build's tests, where a
/// backslash is an ordinary character and `Path` would see one component.
pub fn locate(raw: &str) -> Option<Location> {
    // Asked of every path the app touches, including every row of a listing, so
    // the answer for the ones that are plainly not a share costs two bytes.
    if !raw.starts_with(r"\\") && !raw.starts_with("//") {
        return None;
    }
    let uniform = raw.replace('/', "\\");
    let rest = PREFIXES
        .iter()
        .find_map(|prefix| uniform.strip_prefix(prefix))?;
    let (distro, tail) = match rest.split_once('\\') {
        Some((distro, tail)) => (distro, tail),
        None => (rest, ""),
    };
    if distro.is_empty() {
        return None;
    }
    Some(Location {
        distro: distro.to_string(),
        path: linux_path(tail),
    })
}

/// `home\a\repo` as the distribution spells it, and `/` for the share's root.
fn linux_path(tail: &str) -> String {
    let cleaned = tail.replace('\\', "/");
    let trimmed = cleaned.trim_matches('/');
    if trimmed.is_empty() {
        "/".to_string()
    } else {
        format!("/{trimmed}")
    }
}

/// The UNC spelling of a Linux path in a distribution, which is what the rest
/// of the app stores, compares and hands back over IPC.
pub fn unc(distro: &str, path: &str) -> String {
    let inner = path.trim_start_matches('/').replace('/', "\\");
    if inner.is_empty() {
        format!("{CANONICAL}{distro}")
    } else {
        format!("{CANONICAL}{distro}\\{inner}")
    }
}

impl Location {
    pub fn unc(&self) -> String {
        unc(&self.distro, &self.path)
    }

    /// The same distribution, at another path in it.
    pub fn at(&self, path: &str) -> Self {
        Self {
            distro: self.distro.clone(),
            path: path.to_string(),
        }
    }

    /// The directory holding this one, or `None` at the root of the
    /// distribution — which is where a walk upwards has to stop.
    pub fn parent(&self) -> Option<Self> {
        let cut = self.path.rfind('/')?;
        if self.path == "/" {
            return None;
        }
        Some(self.at(if cut == 0 { "/" } else { &self.path[..cut] }))
    }

    /// The last part of the path. The root has none, so it is called by the
    /// distribution it is the root of.
    pub fn name(&self) -> String {
        match self.path.rsplit('/').next() {
            Some(name) if !name.is_empty() => name.to_string(),
            _ => self.distro.clone(),
        }
    }
}

/// Two Linux paths joined, without going through `Path` — see [`locate`].
pub fn join(base: &str, name: &str) -> String {
    if name.starts_with('/') {
        return name.to_string();
    }
    if base.ends_with('/') {
        format!("{base}{name}")
    } else {
        format!("{base}/{name}")
    }
}

/// Folds `.` and `..` out of a Linux path, without asking the distribution.
///
/// The path bar takes what a person types, and what a person types climbs. The
/// folding is lexical because the alternative is a round trip per keystroke —
/// and because a path that still says `..` in the middle will not compare equal
/// to the same directory named plainly, which is what the panes key on.
pub fn clean(path: &str) -> String {
    let mut parts: Vec<&str> = Vec::new();
    for part in path.split('/') {
        match part {
            "" | "." => {}
            ".." => {
                parts.pop();
            }
            name => parts.push(name),
        }
    }
    if parts.is_empty() {
        "/".to_string()
    } else {
        format!("/{}", parts.join("/"))
    }
}

// ---------------------------------------------------------------- quoting

/// One argument, as a Bourne shell has to read it to get it back unchanged.
///
/// Single quotes, so nothing inside is expanded: these carry file paths and
/// people's sentences, and `$`, backticks and backslashes all have to come out
/// the far side as themselves.
pub fn quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

/// A command line for the shell at the other end of a channel: the directory to
/// run in, the environment to run under, and the words themselves.
pub fn line(cwd: Option<&str>, env: &[(&str, &str)], argv: &[&str]) -> String {
    let mut rendered = String::new();
    if let Some(cwd) = cwd {
        rendered.push_str(&format!("cd {} && ", quote(cwd)));
    }
    for (name, value) in env {
        rendered.push_str(&format!("{name}={} ", quote(value)));
    }
    let mut words = argv.iter();
    if let Some(first) = words.next() {
        rendered.push_str(&quote(first));
    }
    for word in words {
        rendered.push(' ');
        rendered.push_str(&quote(word));
    }
    rendered
}

// ---------------------------------------------------------------- the shell

/// `wsl.exe`, wherever this build can reach it.
///
/// On Windows it is on the path. A Linux build is itself inside a distribution,
/// where Windows programs are reachable through interop — which is what lets
/// the whole of this module be built and tested on either side.
pub fn program() -> &'static str {
    if cfg!(windows) {
        "wsl.exe"
    } else {
        "/mnt/c/Windows/System32/wsl.exe"
    }
}

/// A `wsl.exe` that will not flash a console window over the app.
///
/// Public because the streaming halves — the terminal, an agent's turn, a watch
/// — own their own child rather than borrowing a channel: they are open for as
/// long as somebody is looking at them, and a channel is held only for the one
/// command it is running.
pub fn command(distro: &str, cwd: Option<&str>) -> Command {
    let mut command = Command::new(program());
    command.arg("-d").arg(distro);
    if let Some(cwd) = cwd {
        command.arg("--cd").arg(cwd);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    command
}

/// The shell held open at the far end of a channel.
///
/// Reads one base64 command per line, runs it, and answers with a header
/// naming the exit code and the two lengths, then exactly those bytes. The
/// output goes through files rather than a pipe so that the lengths are known
/// before anything is sent — a pipe would have to be read to its end to be
/// measured, and its end is what the length is for.
///
/// Every command is given `/dev/null` to read: a channel is shared, and one
/// command waiting on a prompt would hold up everything behind it.
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
fn parse_header(line: &str) -> Result<(i32, usize, usize), String> {
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
/// or has lost its place in the protocol — and the command is tried once more
/// on a new one, which is what a distribution that was shut down and started
/// again looks like from here.
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

/// Runs a shell script inside `distro`, with `args` as `$1` onwards.
///
/// The scripts are how anything that is not a single program is asked for — a
/// listing with its file types, a poll for what has changed — and passing their
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

// ---------------------------------------------------------------- watching

/// How many paths one poll is given, so the command line stays a command line.
const WATCHED: usize = 200;

/// A depth that is not a depth, for the targets watched all the way down.
const DEEP: usize = 64;

/// A poll running inside a distribution. Dropping it stops the loop.
pub struct Poll {
    children: Vec<Child>,
}

impl Drop for Poll {
    fn drop(&mut self) {
        for child in &mut self.children {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

/// The loop that stands in for Windows' change notifications.
///
/// Nothing on the Windows side is told when a file inside a distribution moves
/// — the share publishes no notifications at all — so the distribution is asked
/// instead, once a second, for what has been written since the last look. What
/// comes back is paths, which is what the two watches above this want: it is
/// how a refresh re-reads one repository instead of all of them.
///
/// The overlap of a second is deliberate. `find` compares whole seconds, so a
/// write landing in the same second as the previous look would fall between two
/// ticks and never be reported. Reporting it twice instead costs a debounce.
const POLL: &str = r#"
depth=$1
shift
last=$(date +%s)
while :; do
  sleep 1
  now=$(date +%s)
  find "$@" -maxdepth "$depth" -newermt "@$last" -print0 2>/dev/null
  printf '\000'
  last=$((now - 1))
done
"#;

/// Watches `paths` inside `distro`, and says which of them moved.
///
/// `recursive` is whether a target's whole tree counts or only the directory
/// itself — the same two modes the local watcher has. The paths handed to
/// `on_change` are the distribution's own spelling; whoever asked knows which
/// distribution it asked.
pub fn watch(
    distro: &str,
    recursive: bool,
    paths: &[String],
    on_change: impl Fn(Vec<String>) + Send + Clone + 'static,
) -> Result<Poll, String> {
    let depth = if recursive { DEEP } else { 1 }.to_string();
    let mut children = Vec::new();

    for batch in paths.chunks(WATCHED) {
        let mut child = command(distro, None)
            .arg("-e")
            .arg("sh")
            .arg("-c")
            .arg(POLL)
            .arg("totex")
            .arg(&depth)
            .args(batch)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|error| format!("wsl-unreachable: {error}"))?;

        let Some(output) = child.stdout.take() else {
            continue;
        };
        children.push(child);

        let said = on_change.clone();
        std::thread::spawn(move || pump(output, said));
    }

    Ok(Poll { children })
}

/// Reads what one poll says: NUL-terminated paths, and an empty record for the
/// end of a round. The round is what makes a batch — everything one look found
/// is handed over together, so a command that touched forty files is one
/// refresh and not forty.
fn pump(mut output: ChildStdout, on_change: impl Fn(Vec<String>)) {
    let mut buffer = Vec::new();
    let mut batch: Vec<String> = Vec::new();
    let mut chunk = [0u8; 8 * 1024];

    loop {
        let read = match output.read(&mut chunk) {
            Ok(0) | Err(_) => return,
            Ok(read) => read,
        };
        buffer.extend_from_slice(&chunk[..read]);

        while let Some(at) = buffer.iter().position(|byte| *byte == 0) {
            let record: Vec<u8> = buffer.drain(..=at).take(at).collect();
            if record.is_empty() {
                if !batch.is_empty() {
                    on_change(std::mem::take(&mut batch));
                }
                continue;
            }
            batch.push(String::from_utf8_lossy(&record).into_owned());
        }
    }
}

// ---------------------------------------------------------------- base64

const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/// Base64, because a command crosses the pipe as one line and a path is allowed
/// to hold a newline. Written out rather than depended on: it is sixteen lines
/// and this is the only place in the app that needs it.
pub fn encode(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let mut block = [0u8; 3];
        block[..chunk.len()].copy_from_slice(chunk);
        let packed = u32::from_be_bytes([0, block[0], block[1], block[2]]);
        for step in 0..4 {
            if step <= chunk.len() {
                let index = (packed >> (18 - step * 6)) & 0x3f;
                out.push(ALPHABET[index as usize] as char);
            } else {
                out.push('=');
            }
        }
    }
    out
}

// ---------------------------------------------------------------- distributions

/// The installed distributions, as `wsl.exe` reports them.
///
/// Only the rail asks, and only the Windows side has a rail with distributions
/// on it — a window running inside one is already in the only distribution it
/// can see the filesystem of.
#[cfg_attr(not(any(windows, test)), allow(dead_code))]
pub fn distros() -> Vec<String> {
    let mut command = Command::new(program());
    command.args(["--list", "--quiet"]);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    match command.output() {
        // WSL is simply not installed, which is not an error worth surfacing.
        Err(_) => Vec::new(),
        Ok(output) if !output.status.success() => Vec::new(),
        Ok(output) => parse_list(&output.stdout),
    }
}

/// Parses `wsl.exe --list --quiet`, which answers in UTF-16LE on most builds
/// and in UTF-8 on others.
#[cfg_attr(not(any(windows, test)), allow(dead_code))]
pub fn parse_list(stdout: &[u8]) -> Vec<String> {
    let zeros = stdout.iter().filter(|byte| **byte == 0).count();
    let text = if zeros * 3 > stdout.len() {
        let units: Vec<u16> = stdout
            .chunks_exact(2)
            .map(|pair| u16::from_le_bytes([pair[0], pair[1]]))
            .collect();
        String::from_utf16_lossy(&units)
    } else {
        String::from_utf8_lossy(stdout).into_owned()
    };

    text.lines()
        .map(|line| line.trim_matches(|c: char| c.is_whitespace() || c == '\u{feff}' || c == '\0'))
        // `--quiet` drops the header, but not the default marker on old builds.
        .map(|line| line.trim_end_matches("(Default)").trim())
        .filter(|line| !line.is_empty())
        .map(str::to_string)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_a_distribution_out_of_the_share() {
        let found = locate(r"\\wsl.localhost\Ubuntu\home\a\repo").expect("a wsl path");
        assert_eq!(found.distro, "Ubuntu");
        assert_eq!(found.path, "/home/a/repo");
    }

    #[test]
    fn reads_the_spelling_older_builds_publish() {
        let found = locate(r"\\wsl$\Ubuntu-24.04\srv").expect("a wsl path");
        assert_eq!(found.distro, "Ubuntu-24.04");
        assert_eq!(found.path, "/srv");
    }

    #[test]
    fn the_share_itself_is_the_root_of_the_distribution() {
        let found = locate(r"\\wsl.localhost\Ubuntu").expect("a wsl path");
        assert_eq!(found.path, "/");
        assert_eq!(found.parent(), None);
    }

    #[test]
    fn a_local_path_is_not_one() {
        assert_eq!(locate(r"C:\Users\a"), None);
        assert_eq!(locate("/home/a"), None);
        assert_eq!(locate(r"\\server\share\dir"), None);
    }

    #[test]
    fn the_unc_spelling_survives_the_round_trip() {
        let raw = r"\\wsl.localhost\Ubuntu\home\a\repo";
        assert_eq!(locate(raw).expect("a wsl path").unc(), raw);
    }

    #[test]
    fn the_legacy_spelling_is_written_back_as_the_current_one() {
        let found = locate(r"\\wsl$\Ubuntu\home").expect("a wsl path");
        assert_eq!(found.unc(), r"\\wsl.localhost\Ubuntu\home");
    }

    #[test]
    fn walks_up_and_down_without_leaving_the_distribution() {
        let found = locate(r"\\wsl.localhost\Ubuntu\home\a").expect("a wsl path");
        assert_eq!(found.at(&join(&found.path, "repo")).path, "/home/a/repo");
        assert_eq!(found.parent().expect("a parent").path, "/home");
        assert_eq!(found.name(), "a");
        let root = found.at("/");
        assert_eq!(root.name(), "Ubuntu");
    }

    #[test]
    fn a_path_that_climbs_is_folded_before_it_is_asked_about() {
        assert_eq!(clean("/a/./b/../c"), "/a/c");
        assert_eq!(clean("/../.."), "/");
        assert_eq!(clean("/home//a/"), "/home/a");
    }

    #[test]
    fn an_argument_survives_the_shell_unchanged() {
        let rendered = line(Some("/tmp"), &[("LC_ALL", "C")], &["git", "log", "it's"]);
        assert_eq!(rendered, "cd '/tmp' && LC_ALL='C' 'git' 'log' 'it'\\''s'");
    }

    #[test]
    fn encodes_the_way_base64_reads_it_back() {
        assert_eq!(encode(b""), "");
        assert_eq!(encode(b"f"), "Zg==");
        assert_eq!(encode(b"fo"), "Zm8=");
        assert_eq!(encode(b"foo"), "Zm9v");
        assert_eq!(encode(b"foob"), "Zm9vYg==");
        assert!(!encode("echo 'it\\'s'".as_bytes()).contains('\n'));
    }

    #[test]
    fn reads_the_frame_the_runner_writes() {
        assert_eq!(parse_header("R 0 12 0\n").expect("a header"), (0, 12, 0));
        assert_eq!(
            parse_header("R 128 0 40\n").expect("a header"),
            (128, 0, 40)
        );
        assert!(parse_header("hello\n").is_err());
    }

    /// A distribution to try things in, or `None` where there is none to reach.
    ///
    /// Every test below is a real round trip through `wsl.exe`, so each one is
    /// skipped rather than failed where WSL is not installed — which is every
    /// machine the CI builds on.
    fn reachable() -> Option<String> {
        distros().into_iter().next()
    }

    #[test]
    fn runs_a_command_inside_the_distribution() {
        let Some(distro) = reachable() else {
            return;
        };
        let output = exec(&distro, Some("/etc"), &[], &["pwd"]).expect("a shell");
        assert!(output.ok(), "{:?}", output.stderr);
        assert_eq!(output.text().trim(), "/etc");
    }

    #[test]
    fn hands_back_what_a_command_failed_with() {
        let Some(distro) = reachable() else {
            return;
        };
        let output =
            exec(&distro, None, &[], &["sh", "-c", "echo no >&2; exit 3"]).expect("a shell");
        assert_eq!(output.code, 3);
        assert_eq!(String::from_utf8_lossy(&output.stderr).trim(), "no");
    }

    /// The reason the answers are framed by length: a file is bytes, and every
    /// byte a delimiter could be is one a file is allowed to hold.
    #[test]
    fn carries_bytes_a_line_could_not() {
        let Some(distro) = reachable() else {
            return;
        };
        let output = exec(
            &distro,
            None,
            &[],
            &["sh", "-c", "printf 'a\\nb'; printf '\\000'; printf 'c'"],
        )
        .expect("a shell");
        assert_eq!(output.stdout, b"a\nb\0c");
    }

    /// The whole point of holding the shell open: the second command must not
    /// pay for `wsl.exe` again.
    #[test]
    fn the_shell_is_still_there_for_the_next_command() {
        let Some(distro) = reachable() else {
            return;
        };
        for _ in 0..3 {
            let output = exec(&distro, None, &[], &["true"]).expect("a shell");
            assert!(output.ok());
        }
        let started = std::time::Instant::now();
        exec(&distro, None, &[], &["true"]).expect("a shell");
        assert!(
            started.elapsed() < std::time::Duration::from_millis(250),
            "a held-open shell took {:?}",
            started.elapsed()
        );
    }

    #[test]
    fn a_script_reads_its_arguments_as_arguments() {
        let Some(distro) = reachable() else {
            return;
        };
        let output =
            script(&distro, None, "printf '%s|' \"$@\"", &["it's", "a b"]).expect("a shell");
        assert_eq!(output.text(), "it's|a b|");
    }

    /// The poll that stands in for the change notifications Windows never gets
    /// about the share. Writing a file has to come back as that file.
    #[test]
    fn says_what_was_written_since_the_last_look() {
        let Some(distro) = reachable() else {
            return;
        };
        let dir = "/tmp/totex-watch-test";
        exec(&distro, None, &[], &["rm", "-rf", dir]).expect("a shell");
        exec(&distro, None, &[], &["mkdir", "-p", dir]).expect("a shell");

        let (tx, rx) = std::sync::mpsc::channel();
        let poll = watch(&distro, false, &[dir.to_string()], move |moved| {
            let _ = tx.send(moved);
        })
        .expect("a poll");

        // After the first look, so the write is something that happened since.
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(15);
        let mut seen: Vec<String> = Vec::new();
        while std::time::Instant::now() < deadline {
            exec(&distro, None, &[], &["touch", &format!("{dir}/written")]).expect("a shell");
            if let Ok(moved) = rx.recv_timeout(std::time::Duration::from_millis(1_500)) {
                seen = moved;
                if seen.iter().any(|path| path.ends_with("/written")) {
                    break;
                }
            }
        }
        drop(poll);

        assert!(
            seen.iter().any(|path| path.ends_with("/written")),
            "the write never came back: {seen:?}"
        );
    }

    #[test]
    fn names_every_distribution_the_list_holds() {
        let utf16: Vec<u8> = "Ubuntu\r\nDebian\r\n"
            .encode_utf16()
            .flat_map(u16::to_le_bytes)
            .collect();
        assert_eq!(parse_list(&utf16), vec!["Ubuntu", "Debian"]);
        assert_eq!(parse_list(b"Ubuntu\nDebian\n"), vec!["Ubuntu", "Debian"]);
    }
}
