//! The half of the app that cannot be dropped.
//!
//! Everything a window holds is one of two kinds of thing. One is a running
//! shell: a process with a history nobody else has a copy of, gone for good if
//! whatever holds it stops. The other is all the rest — the snapshot a folder
//! was scanned into, the screen a session has drawn and the question standing
//! on it, the window itself — and none of that is a possession. It is a saving.
//! Throw it away and it comes back.
//!
//! This program is the first kind, and only the first kind: the persistent
//! half. It holds the sessions, the door an agent reports through, a small
//! store of whatever the window asks it to remember, and the one thing that
//! can replace the window — a release brought down and put in once the window
//! has gone. It is started beside the window, and it is deliberately not the
//! window's child: when the window is replaced — an update, a crash, a reload
//! that went wrong — this goes on running, and the next window finds every
//! shell where it was left, still holding what it said. Everything else is the
//! ephemeral half, and the ephemeral half is what a release replaces.
//!
//! ## What it knows
//!
//! As little as possible, because what it holds cannot be replaced while it is
//! held. It knows how to start a shell and keep what the shell says, how to
//! stand a door for the agents in those shells to report through, and how to
//! keep a JSON document under a name. It does not know what a question is, what
//! a repository is, or what any of the documents it keeps mean: all of that is
//! the window's, and the window is the half that changes.
//!
//! ## How it is asked
//!
//! Lines of JSON over a loopback socket — see [`wire`], [`serve`] and [`talk`].
//! A window connects, says the token it read out of the address file this
//! program wrote, and asks by name. What the sessions do is pushed back down the
//! same socket to every window connected, so a window that has just come up in
//! front of running shells is told what they say from that moment on, and asks
//! for what they said before.
//!
//! ## Which releases replace it
//!
//! The version is one number for both halves, and which part of it turns over
//! says which half a release replaces. A patch — `0.1.30` to `0.1.31` — is the
//! ephemeral half alone: the window goes, the release goes in, the next window
//! opens on it, and this program is the same program throughout, holding the
//! same shells. A minor — `0.1.x` to `0.2.0` — is this program too, and there
//! is no putting it in without ending what it holds. So `major.minor` is the
//! [`LINE`], and a window and a program on the same line understand one
//! another whatever their patch numbers are; a window that finds a program on
//! another line stops it and starts the one it brought.
//!
//! That is also the rule for what is on the wire. Within a line nothing
//! crosses the socket under a new name and nothing is read out of a new place:
//! the hello still says `keep`, the address file still says `protocol`, and
//! the directory a window looks in is still `keep` — because a window of
//! `0.1.31` has to find the program a window of `0.1.30` started, and would
//! not, under any other spelling. The spelling of the line before this one is
//! the line's to keep.

pub mod door;
pub mod serve;
pub mod session;
pub mod store;
mod stream;
pub mod talk;
#[cfg(test)]
mod tests;
pub mod update;
pub mod wire;

use std::path::PathBuf;
use std::sync::Arc;

pub use door::Door;
pub use session::Sessions;
pub use store::Store;

/// The version of this program, which is the app's own.
pub const VERSION: &str = env!("CARGO_PKG_VERSION");

/// The line this program is on: `major.minor` of [`VERSION`], as one number.
///
/// What the two ends of the socket have to agree on. A window and a program
/// on the same line ask and answer the same questions, whatever the patch
/// number of either — that is what a patch release promises, and what
/// `.github/workflows/release.yml` refuses to cut one that breaks. A window
/// that finds a program on another line cannot ask it anything, and replaces
/// it at the cost of what it holds — which is the one cost this arrangement
/// exists to avoid, paid once per minor release and never otherwise.
///
/// Said on the wire under the name the line before this one gave it — see
/// [`wire::hello`] — so that a window from earlier in the line reads it as the
/// same number it always read.
pub const LINE: u32 =
    number(env!("CARGO_PKG_VERSION_MAJOR")) * 1000 + number(env!("CARGO_PKG_VERSION_MINOR"));

/// A decimal number out of a string cargo wrote, at compile time.
const fn number(text: &str) -> u32 {
    let bytes = text.as_bytes();
    let mut found = 0u32;
    let mut at = 0;
    while at < bytes.len() {
        found = found * 10 + (bytes[at] - b'0') as u32;
        at += 1;
    }
    found
}

/// The line a version is on, read the same way as [`LINE`] at runtime, or
/// nothing for a string that is not a version.
pub fn line_of(version: &str) -> Option<u32> {
    let mut parts = version.split('.');
    let major: u32 = parts.next()?.parse().ok()?;
    let minor: u32 = parts.next()?.parse().ok()?;
    Some(major * 1000 + minor)
}

/// Everything this program holds.
pub struct Persistent {
    pub sessions: Arc<Sessions>,
    pub door: Arc<Door>,
    pub store: Store,
    /// Where the store keeps its documents, or nothing on a machine with no
    /// data directory — which is a machine where nothing is remembered past
    /// this run.
    pub home: Option<PathBuf>,
}

impl Persistent {
    /// Everything, empty, and joined together.
    pub fn new(home: Option<PathBuf>) -> Arc<Self> {
        let sessions = Arc::new(Sessions::default());
        let door = Door::new(Arc::clone(&sessions));
        let store = Store::at(home.as_ref().map(|home| home.join("store")));
        Arc::new(Self {
            sessions,
            door,
            store,
            home,
        })
    }
}

#[cfg(test)]
mod line {
    use super::*;

    #[test]
    fn the_line_is_the_major_and_the_minor_and_not_the_patch() {
        assert_eq!(line_of("0.1.30"), Some(1));
        assert_eq!(line_of("0.1.31"), Some(1));
        assert_eq!(line_of("0.2.0"), Some(2));
        assert_eq!(line_of("1.0.0"), Some(1000));
        assert_eq!(line_of("nonsense"), None);
        assert_eq!(line_of(VERSION), Some(LINE));
    }
}
