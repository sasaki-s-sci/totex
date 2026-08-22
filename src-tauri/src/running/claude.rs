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

use crate::host::Host;

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
///
/// The override is an environment variable, and a distribution's environment is
/// not this process's — nothing on the Windows side can read what a shell
/// inside it exports. So a distribution is looked at where Claude Code puts its
/// state for everybody who has not moved it.
fn config_dir(host: &Host) -> Option<PathBuf> {
    if !host.is_remote()
        && let Ok(configured) = std::env::var("CLAUDE_CONFIG_DIR")
        && !configured.trim().is_empty()
    {
        return Some(PathBuf::from(configured));
    }
    super::home(host).map(|home| host.join(&home, ".claude"))
}

/// Every session file on `host`, in no particular order.
pub fn entries(host: &Host) -> Vec<Entry> {
    let Some(dir) = config_dir(host).map(|dir| host.join(&dir, "sessions")) else {
        return Vec::new();
    };
    let Ok(listing) = host.read_dir(&dir) else {
        return Vec::new();
    };

    // All of them in one reading: this runs every couple of seconds, and a
    // directory of small files is a round trip apiece for a machine that is
    // not this one.
    let files: Vec<PathBuf> = listing
        .iter()
        .filter(|file| file.name.ends_with(".json"))
        .map(|file| host.join(&dir, &file.name))
        .collect();

    host.texts(&files)
        .iter()
        .filter_map(|text| parse(text))
        .collect()
}

/// One session file, or nothing at all if it is not one.
///
/// Being written to as it is read is ordinary here — a session updates its own
/// status — so a file that does not parse is skipped and picked up next sweep.
pub fn parse(text: &str) -> Option<Entry> {
    serde_json::from_str(text).ok()
}
