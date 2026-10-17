//! A hash of the world a job is running in.
//!
//! Taken when a job starts and again before it is run a second time, and only
//! ever compared with itself: what it says is "the same" or "not the same", and
//! nothing reads what is inside it. That is what lets it be a hash rather than
//! the whole of a diff kept in the window's state.
//!
//! Which is also why the hash is written out here rather than borrowed. The two
//! takings can be a release apart, and a hash that changed with the compiler —
//! which `DefaultHasher` is free to — would read as a world that moved when it
//! did not.

use std::path::Path;

use crate::git::cmd;
use crate::host::Host;

/// How a guard command is run: for its words, and not for its colours.
///
/// `NO_COLOR` because what it prints is hashed rather than shown, and a program
/// that decided whether to paint by something other than what it was asked
/// would hash differently for the same world.
const ENVIRONMENT: [(&str, &str); 1] = [("NO_COLOR", "1")];

/// See [`super::resume_fingerprint`].
pub fn take(cwd: &str, guard: &str) -> Result<Option<String>, String> {
    if guard == "none" {
        return Ok(None);
    }

    let dir = Path::new(cwd);
    let host = Host::of(dir);
    if !host.is_dir(dir) {
        return Err("missing-directory".to_string());
    }

    if guard == "git" {
        return git(dir);
    }
    if let Some(line) = guard.strip_prefix("cmd:") {
        return command(&host, dir, line.trim()).map(Some);
    }
    Err("unknown-guard".to_string())
}

/// The checkout `dir` is in: which commit it stands at, and everything that
/// has been done to it since — staged or not, tracked or not.
///
/// Three questions where it looks like one would do, because each sees what the
/// others miss. The commit is the world everybody else can see; `status` is the
/// only one of them that names a file nobody has added yet; and the diff is the
/// only one that says what changed inside a file that `status` would list as
/// modified both before and after a further edit.
fn git(dir: &Path) -> Result<Option<String>, String> {
    let inside = cmd::try_run(dir, &["rev-parse", "--is-inside-work-tree"]);
    if inside.as_deref().map(str::trim) != Some("true") {
        return Ok(None);
    }

    // A repository with no commit yet has no HEAD to stand at or to diff
    // against. That is a world too, and `status` is the whole of it.
    let head = cmd::try_run(dir, &["rev-parse", "HEAD"]).unwrap_or_default();
    let status = cmd::run(
        dir,
        &["status", "--porcelain=v1", "-z", "--untracked-files=all"],
    )?;
    let diff = cmd::try_run(
        dir,
        &["diff", "HEAD", "--binary", "--no-ext-diff", "--no-color"],
    )
    .unwrap_or_default();

    let mut hash = Fnv::start();
    hash.part(head.trim().as_bytes());
    hash.part(status.as_bytes());
    hash.part(diff.as_bytes());
    Ok(Some(format!("git:{}", hash.hex())))
}

/// What `line` says in `dir`, and how it exits.
///
/// In the shell every machine has rather than the one its owner types into, for
/// the reason `crate::tasks` asks a remote machine that way: which shell that is
/// cannot be known from out here. The exit is hashed along with what it said,
/// because a check that fails without a word is the commonest way for one to
/// say the world is not what it was.
fn command(host: &Host, dir: &Path, line: &str) -> Result<String, String> {
    if line.is_empty() {
        return Err("empty-guard".to_string());
    }

    let argv: Vec<&str> = match host {
        Host::Wsl(_) | Host::Ssh(_) => vec!["sh", "-c", line],
        #[cfg(windows)]
        Host::Local => vec!["cmd", "/C", line],
        #[cfg(not(windows))]
        Host::Local => vec!["sh", "-c", line],
    };
    let said = host.exec(Some(dir), &ENVIRONMENT, &argv)?;

    let mut hash = Fnv::start();
    hash.part(&said.code.to_le_bytes());
    hash.part(&said.stdout);
    Ok(format!("cmd:{}", hash.hex()))
}

/// FNV-1a, 64 bits: a hash short enough to write out by hand, which is the
/// whole of what it was chosen for — see the module comment.
pub struct Fnv(u64);

const OFFSET: u64 = 0xcbf2_9ce4_8422_2325;
const PRIME: u64 = 0x0000_0100_0000_01b3;

impl Fnv {
    pub fn start() -> Self {
        Self(OFFSET)
    }

    pub fn write(&mut self, bytes: &[u8]) {
        for byte in bytes {
            self.0 ^= u64::from(*byte);
            self.0 = self.0.wrapping_mul(PRIME);
        }
    }

    /// One piece of what is being hashed, with its length in front of it, so
    /// that where one piece ends and the next begins is part of the hash too:
    /// `ab` then `c` is not `a` then `bc`.
    pub fn part(&mut self, bytes: &[u8]) {
        self.write(&(bytes.len() as u64).to_le_bytes());
        self.write(bytes);
    }

    /// Sixteen lowercase hex digits, always sixteen.
    pub fn hex(&self) -> String {
        format!("{:016x}", self.0)
    }
}
