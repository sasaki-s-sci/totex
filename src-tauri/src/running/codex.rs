//! What Codex leaves on disk.
//!
//! Every thread is written to a rollout file under `~/.codex/sessions`, laid
//! out by date, whose first line says what the thread is: its id, the directory
//! it was started in, and the version that started it. The file is appended to
//! as the turn goes, so when it was last written is also the closest thing on
//! disk to "is it doing something right now".
//!
//! There is a real interface as well — `codex app-server` speaks JSON-RPC and
//! answers `thread/list` with the working directory, the git branch and the
//! parent of every thread — but only for threads that server is itself running.
//! A terminal a person started is not one of those, so the files are what a
//! machine-wide view has to be read from.

use std::collections::HashSet;
use std::path::{Path, PathBuf};

use serde::Deserialize;

/// How many rollouts back to look for the thread a running process is on.
///
/// Only ever asked about processes that are running now, so the answer is
/// always among the newest few. The cap is what stops a machine with a year of
/// history from being walked end to end every sweep.
const RECENT_LIMIT: usize = 64;

#[derive(Clone, Debug, Deserialize)]
pub struct Meta {
    /// The thread's own id, the one `codex resume` takes.
    pub session_id: Option<String>,
    pub cwd: Option<String>,
    pub cli_version: Option<String>,
    /// `user` for a thread somebody is talking to, `subagent` for one the agent
    /// started for itself.
    pub thread_source: Option<String>,
    /// Which subagent, when it is one. Shaped differently in every version so
    /// far — `{"subagent": {"other": "guardian"}}` today — so it is read as
    /// whatever it is and dug through rather than typed out.
    pub source: Option<serde_json::Value>,
}

/// One rollout: what it says about itself, and when it was last written to.
#[derive(Clone, Debug)]
pub struct Thread {
    pub meta: Meta,
    /// The rollout's own thread id, taken from its filename.
    ///
    /// A subagent currently repeats its parent's `session_id` in the payload,
    /// while the filename carries the subagent's actual id. Keeping both is
    /// what gives every node a distinct, stable identity.
    pub rollout_id: String,
    /// The subagent this thread belongs to, when it is not somebody's own.
    ///
    /// This is the only place any of the three admits to a subagent from
    /// outside: Codex runs them as threads of the same process, so nothing in
    /// the process table says they are there, and this line in the rollout is
    /// what does.
    pub subagent: Option<String>,
    /// Milliseconds since the epoch, from the file itself.
    pub updated_at: Option<u64>,
}

fn sessions_dir() -> Option<PathBuf> {
    if let Ok(configured) = std::env::var("CODEX_HOME")
        && !configured.trim().is_empty()
    {
        return Some(PathBuf::from(configured).join("sessions"));
    }
    super::home().map(|home| home.join(".codex").join("sessions"))
}

/// The newest rollouts on this machine, newest first.
pub fn recent() -> Vec<Thread> {
    let Some(root) = sessions_dir() else {
        return Vec::new();
    };

    let mut found = Vec::new();
    for file in newest_files(&root, RECENT_LIMIT) {
        let Some(meta) = read_meta(&file) else {
            continue;
        };
        found.push(Thread {
            rollout_id: rollout_id(&file),
            subagent: subagent_role(&meta),
            meta,
            updated_at: modified_at(&file),
        });
    }
    found
}

/// The newest user thread in a directory that no other live process claimed.
///
/// Processes are visited newest first by the sweep, and rollouts are already
/// newest first, so two Codex terminals in one worktree get two different
/// threads instead of producing duplicate graph node ids.
pub fn claim_thread<'a>(
    threads: &'a [Thread],
    cwd: &Path,
    claimed: &mut HashSet<String>,
) -> Option<&'a Thread> {
    let thread = threads.iter().find(|thread| {
        in_directory(thread, cwd)
            && thread.subagent.is_none()
            && !claimed.contains(&thread.rollout_id)
    })?;
    claimed.insert(thread.rollout_id.clone());
    Some(thread)
}

/// The subagent threads in a directory, newest first.
pub fn subagents_in<'a>(
    threads: &'a [Thread],
    cwd: &'a Path,
    parent_session: &'a str,
) -> impl Iterator<Item = &'a Thread> {
    threads.iter().filter(move |thread| {
        in_directory(thread, cwd)
            && thread.subagent.is_some()
            && thread.meta.session_id.as_deref() == Some(parent_session)
    })
}

fn in_directory(thread: &Thread, cwd: &Path) -> bool {
    thread.meta.cwd.as_deref().map(Path::new) == Some(cwd)
}

/// Which subagent a thread belongs to, if it is one.
///
/// The shape has already changed once and will again, so this digs rather than
/// deserialises: whatever names the subagent is taken from wherever it is, and
/// a shape with nothing to name in it is simply a thread with no subagent.
pub fn subagent_role(meta: &Meta) -> Option<String> {
    if meta.thread_source.as_deref() != Some("subagent") {
        return None;
    }
    let named = meta
        .source
        .as_ref()
        .and_then(|source| source.get("subagent"))
        .and_then(|subagent| subagent.as_object())
        .and_then(|fields| fields.iter().next())
        .map(|(key, value)| match value.as_str() {
            Some(name) => name.to_string(),
            None => key.clone(),
        });
    // Known to be one even when nothing in it says which.
    Some(named.unwrap_or_else(|| "subagent".to_string()))
}

/// The first line of a rollout, which is the thread's own description of itself.
///
/// Only the first line: these files run to megabytes once a conversation has
/// been going for a while, and everything after the first line is the
/// conversation itself.
fn read_meta(file: &Path) -> Option<Meta> {
    use std::io::{BufRead, BufReader};

    let handle = std::fs::File::open(file).ok()?;
    let mut line = String::new();
    BufReader::new(handle).read_line(&mut line).ok()?;
    parse_meta(&line)
}

/// The id at the end of `rollout-<timestamp>-<uuid>.jsonl`.
///
/// The filename is part of Codex's on-disk layout and is the only place a
/// subagent records its own id today. A future shape that drops the UUID still
/// gets the whole filename as a stable, unique fallback.
fn rollout_id(file: &Path) -> String {
    let stem = file
        .file_stem()
        .and_then(|name| name.to_str())
        .unwrap_or_default();
    let candidate = stem
        .len()
        .checked_sub(36)
        .and_then(|start| stem.get(start..))
        .filter(|value| {
            value
                .chars()
                .enumerate()
                .all(|(index, character)| match index {
                    8 | 13 | 18 | 23 => character == '-',
                    _ => character.is_ascii_hexdigit(),
                })
        });
    candidate.unwrap_or(stem).to_string()
}

/// The session line, or nothing when the file starts with something else.
pub fn parse_meta(line: &str) -> Option<Meta> {
    #[derive(Deserialize)]
    struct Envelope {
        #[serde(rename = "type")]
        kind: String,
        payload: Meta,
    }

    let envelope: Envelope = serde_json::from_str(line).ok()?;
    (envelope.kind == "session_meta").then_some(envelope.payload)
}

/// The newest rollout files under a tree laid out by year, month and day.
///
/// Walked newest directory first and stopped as soon as enough files are in
/// hand, so the cost is the last day or two of history rather than all of it.
/// Names sort chronologically — they begin with the timestamp — which is what
/// lets this order a directory without asking the filesystem for dates.
fn newest_files(root: &Path, limit: usize) -> Vec<PathBuf> {
    let mut found = Vec::new();
    for day in newest_dirs(root, 3) {
        let mut files: Vec<PathBuf> = std::fs::read_dir(&day)
            .into_iter()
            .flatten()
            .flatten()
            .map(|entry| entry.path())
            .filter(|path| {
                path.file_name()
                    .and_then(|name| name.to_str())
                    .is_some_and(|name| name.starts_with("rollout-") && name.ends_with(".jsonl"))
            })
            .collect();
        files.sort();
        files.reverse();
        found.extend(files);
        if found.len() >= limit {
            found.truncate(limit);
            break;
        }
    }
    found
}

/// The `depth` newest leaves of the date tree, newest first.
fn newest_dirs(root: &Path, depth: usize) -> Vec<PathBuf> {
    let mut level = vec![root.to_path_buf()];
    for _ in 0..depth {
        let mut next = Vec::new();
        for dir in &level {
            let mut children: Vec<PathBuf> = std::fs::read_dir(dir)
                .into_iter()
                .flatten()
                .flatten()
                .map(|entry| entry.path())
                .filter(|path| path.is_dir())
                .collect();
            children.sort();
            children.reverse();
            next.extend(children);
        }
        if next.is_empty() {
            return level;
        }
        level = next;
    }
    level
}

/// When a file was last written, in milliseconds since the epoch.
fn modified_at(file: &Path) -> Option<u64> {
    let modified = std::fs::metadata(file).ok()?.modified().ok()?;
    let since = modified.duration_since(std::time::UNIX_EPOCH).ok()?;
    Some(since.as_millis() as u64)
}
