//! What Claude Code publishes about itself.
//!
//! It keeps a file per live session under `~/.claude/sessions`, named after the
//! process, holding the session's own id, the directory it was started in and
//! what it is doing right now — busy, idle, or waiting on an answer. That last
//! one is the thing no other source has: a process table says a session exists,
//! and this says whether it is working or sitting there wanting a reply.
//!
//! Read rather than asked for. `claude agents --json` prints the same set, but
//! it is a whole process to start and this is a directory of small files.
//!
//! Nothing here is a published interface, so every field is optional and a file
//! that has moved on to some other shape simply contributes less.

use std::path::PathBuf;

use serde::Deserialize;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub pid: Option<u32>,
    pub session_id: Option<String>,
    pub cwd: Option<String>,
    /// The name the session goes by — derived from its directory, mostly, which
    /// is what makes two sessions in the same repository tellable apart.
    pub name: Option<String>,
    /// `busy`, `idle`, `waiting`, `shell`.
    pub status: Option<String>,
    /// `interactive` or `bg`.
    pub kind: Option<String>,
    pub version: Option<String>,
    pub started_at: Option<u64>,
    pub updated_at: Option<u64>,
    /// The kernel's start stamp for the process, as a string. Pid plus this is
    /// what tells a live session from a file left behind by a dead one whose
    /// number has since been handed to something else.
    pub proc_start: Option<String>,
}

/// Where Claude Code keeps its state, honouring the override it reads itself.
fn config_dir() -> Option<PathBuf> {
    if let Ok(configured) = std::env::var("CLAUDE_CONFIG_DIR")
        && !configured.trim().is_empty()
    {
        return Some(PathBuf::from(configured));
    }
    super::home().map(|home| home.join(".claude"))
}

/// Every session file on this machine, in no particular order.
pub fn entries() -> Vec<Entry> {
    let Some(dir) = config_dir().map(|dir| dir.join("sessions")) else {
        return Vec::new();
    };
    let Ok(listing) = std::fs::read_dir(dir) else {
        return Vec::new();
    };

    listing
        .flatten()
        .filter(|file| file.path().extension().is_some_and(|kind| kind == "json"))
        .filter_map(|file| std::fs::read_to_string(file.path()).ok())
        .filter_map(|text| parse(&text))
        .collect()
}

/// One session file, or nothing at all if it is not one.
///
/// Being written to as it is read is ordinary here — a session updates its own
/// status — so a file that does not parse is skipped and picked up next sweep.
pub fn parse(text: &str) -> Option<Entry> {
    serde_json::from_str(text).ok()
}
