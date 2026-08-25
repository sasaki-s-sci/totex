//! A shell, running in a directory the window picked.
//!
//! The window draws the terminal; this owns the process. Each session is a
//! pseudo-terminal so the shell believes it has one — without that, a prompt
//! never appears and anything interactive hangs waiting for a tty.
//!
//! The process belongs to whoever opened the session and not to whatever is
//! drawing it, so what it says is kept here as well as sent: a terminal built
//! late, or built again, is handed everything it missed instead of coming up
//! blank in front of a live shell. Output is pushed rather than polled, and
//! gathered on the way by `stream`.
//!
//! This is the one thing in the app that cannot be worked out again — a running
//! shell is a process with a history nobody else has a copy of. So nothing that
//! could be derived is kept in here: what wants to follow the sessions
//! registers through `follow` rather than being given a field on one, which is
//! what it would have to do if this were a program of its own. See `derived`.

pub mod control;
pub mod spawn;

mod backlog;
pub mod model;

#[cfg(test)]
pub(crate) mod tests;

use std::collections::HashMap;
use std::io::Write;
use std::sync::{Arc, Mutex};

use portable_pty::{Child, MasterPty};

use backlog::Backlog;

pub use control::{pty_attach, pty_write, running};
pub use model::{Dresser, Event, Follower};
pub use spawn::shell;

/// Carries a run of a session's output to the window.
const DATA_EVENT: &str = "pty:data";
/// Carries the session that has ended, so the window can say so.
const EXIT_EVENT: &str = "pty:exit";

/// One running shell. The master is kept so the session can be resized.
struct Session {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn Child + Send + Sync>,
    /// Shared with the thread reading the pty, which fills it whether or not
    /// there is a window at the other end of the event.
    said: Arc<Mutex<Backlog>>,
    /// Where it was started, and how much room it was last told it has. Facts
    /// about the process rather than about whoever is drawing it: a screen read
    /// at the wrong width is a box with its side in the middle of a line.
    cwd: String,
    rows: u16,
    cols: u16,
    /// Whatever the window asked to have kept beside this session. Never looked
    /// at here, and deliberately a string rather than anything with a shape:
    /// holding it unread is what lets the window change without this knowing.
    meta: Option<String>,
}

#[derive(Default)]
pub struct PtyState {
    sessions: Mutex<HashMap<String, Session>>,
    /// Whatever is following the sessions besides the window, registered rather
    /// than compiled in — what follows them today is the reading of the
    /// questions agents ask, which has no business owning a process.
    following: Mutex<Vec<Follower>>,
    /// Whatever the app wants in the environment of the sessions it starts.
    dressing: Mutex<Vec<Dresser>>,
}

impl PtyState {
    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<String, Session>> {
        crate::sync::lock(&self.sessions)
    }

    /// Adds one, for the life of the app.
    pub fn follow(&self, follower: Follower) {
        crate::sync::lock(&self.following).push(follower);
    }

    /// Adds something to the environment of every session started from now on.
    pub fn dress(&self, dresser: Dresser) {
        crate::sync::lock(&self.dressing).push(dresser);
    }

    /// What is to go in one session's environment, asked of all of them —
    /// before the session it is for exists, and with nothing of this module's
    /// held, because what answers is the rest of the app.
    fn dressed(&self, id: &str, cwd: &str) -> Vec<(String, String)> {
        let dressing: Vec<Dresser> = {
            let held = crate::sync::lock(&self.dressing);
            if held.is_empty() {
                return Vec::new();
            }
            held.clone()
        };
        dressing
            .iter()
            .flat_map(|dresser| dresser(id, cwd))
            .collect()
    }

    /// Tells them all. The list is copied out before any of it is called: a
    /// follower does its own work here, and holding a lock across that would
    /// put every session behind whatever the slowest of them is doing.
    fn tell(&self, id: &str, event: Event<'_>) {
        let following: Vec<Follower> = {
            let held = crate::sync::lock(&self.following);
            if held.is_empty() {
                return;
            }
            held.clone()
        };
        for follower in following {
            follower(id, event);
        }
    }
}
