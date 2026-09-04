//! What crosses out of this module: down the socket to a window, and to
//! whatever is following the sessions in this program.

use std::sync::Arc;

use serde::{Deserialize, Serialize};

/// A run of output, addressed to the session that said it.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Said {
    pub id: String,
    pub data: String,
    /// How much the session had said before this run, which is how a terminal
    /// just handed the backlog knows this is not in it.
    pub seq: usize,
}

/// What a session has said so far, for a terminal that has just attached.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Held {
    pub text: String,
    /// How far `text` reaches into everything the session has said.
    pub upto: usize,
}

/// One session that is still running, for whatever has stopped knowing about it
/// — a window that reloaded, or one that never started it. The id, directory
/// and size are this side's own; `meta` is the window's, handed back as left.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Running {
    pub id: String,
    pub cwd: String,
    /// The size the shell is at, which is the size a screen has to be rebuilt at
    /// to read the same thing off it.
    pub rows: u16,
    pub cols: u16,
    pub meta: Option<String>,
}

/// What the sessions do, for whatever is following them — the things the other
/// end of the socket has to be handed, and nothing else.
#[derive(Clone, Copy, Debug)]
pub enum Event<'a> {
    /// A shell has started, at the size it was started at.
    Opened { rows: u16, cols: u16 },
    /// A run of output, and how much the session had said before it.
    Said { data: &'a str, at: usize },
    /// The screen it is drawn on has been given a different amount of room.
    Resized { rows: u16, cols: u16 },
    /// The shell has ended, and the session with it.
    Ended,
}

/// Something following the sessions, told what each of them does as it does it.
pub type Follower = Arc<dyn Fn(&str, Event<'_>) + Send + Sync>;

/// Something put in the environment of every session started, asked once per
/// session as that session is about to run. Registered for the same reason a
/// follower is: what goes in an environment besides the terminal's own name is
/// a fact about the rest of the app.
pub type Dresser = Arc<dyn Fn(&str, &str) -> Vec<(String, String)> + Send + Sync>;
