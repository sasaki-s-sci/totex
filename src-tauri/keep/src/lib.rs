//! The half of the app that cannot be dropped.
//!
//! Everything a window holds is one of two kinds of thing. One is a running
//! shell: a process with a history nobody else has a copy of, gone for good if
//! whatever holds it stops. The other is all the rest — the snapshot a folder
//! was scanned into, the screen a session has drawn and the question standing
//! on it, the window itself — and none of that is a possession. It is a saving.
//! Throw it away and it comes back.
//!
//! This program is the first kind, and only the first kind. It holds the
//! sessions, the door an agent reports through, and a small store of whatever
//! the window asks it to remember. It is started beside the window, and it is
//! deliberately not the window's child: when the window is replaced — an update,
//! a crash, a reload that went wrong — this goes on running, and the next window
//! finds every shell where it was left, still holding what it said.
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

/// What the two ends of the socket have to agree on.
///
/// A version of the conversation rather than of the program. It moves when a
/// question is added, removed, or has its arguments or its answer changed in a
/// way the other end would read wrongly, and it does not move for anything
/// else. A window that finds a program speaking another number cannot ask it
/// anything — and cannot replace it without ending what it holds, which is the
/// one cost this whole arrangement exists to avoid. So this number is meant to
/// stay where it is.
pub const PROTOCOL: u32 = 1;

/// The version of this program, which is the app's own.
pub const VERSION: &str = env!("CARGO_PKG_VERSION");

/// Everything this program holds.
pub struct Keep {
    pub sessions: Arc<Sessions>,
    pub door: Arc<Door>,
    pub store: Store,
    /// Where the store keeps its documents, or nothing on a machine with no
    /// data directory — which is a machine where nothing is remembered past
    /// this run.
    pub home: Option<PathBuf>,
}

impl Keep {
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
