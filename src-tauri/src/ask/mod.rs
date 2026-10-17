//! What is running in a terminal, read off the screen it draws.
//!
//! A terminal has no interface for saying what is going on inside it, so the
//! drawing is the only place any of it exists: the stream is followed into a
//! `Screen`, and the screen is read whenever it changes. Two things are read
//! off it and kept: the last thing typed at the session — see `typed` — and
//! what the session is doing, see `doing`. Nothing waits on either; they are
//! labels and marks for the canvas.
//!
//! A third reading stands beside them and is never handed to anybody: `read`,
//! which finds the box an agent draws at the foot of the screen when it stops to
//! ask something — may I run this, may I write that, which of these did you
//! mean. Its answers are drawn as lines that look exactly like something typed,
//! a mark and the words after it, so while one stands `typed` has to know not to
//! take them for the last thing somebody said. The reading is a pattern rather
//! than a parse — it takes what is unmistakably a question being put and leaves
//! every idle shell prompt and empty composer alone, because a composer is
//! exactly where the last thing typed is to be found.

mod choice;
mod doing;
mod glyph;
mod read;
mod screen;
mod typed;
pub mod watch;

#[cfg(test)]
mod tests;

#[cfg(test)]
pub(crate) use doing::doing;
pub use doing::{Doing, doing_as};
use read::read;
pub use screen::Screen;
pub use typed::typed;

/// How the question on screen is answered at the terminal, which is what tells
/// the shapes of box apart.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Taking {
    /// The key the agent printed beside the answer, typed on its own.
    Key,
    /// The key and a return, because a line is not read until there is one.
    Line,
    /// The agent's own mark, walked to the answer with the arrows and taken
    /// with a return.
    Walk,
    /// Words: there is no list, and what is typed is whatever was written.
    Words,
}

/// One of the answers, as the agent itself offered it.
#[derive(Clone, Debug, PartialEq)]
struct Choice {
    /// The key the agent printed beside it, or the place it stands in for a
    /// list that is walked instead.
    pub key: String,
    pub label: String,
    /// Where the agent's own cursor is standing.
    pub selected: bool,
    /// Whether the agent is holding this one as taken, which is not the mark.
    pub picked: bool,
}

/// A question as it was read off the screen.
#[derive(Clone, Debug, PartialEq)]
struct Reading {
    pub detail: Vec<String>,
    pub question: String,
    pub taking: Taking,
    pub picking: bool,
    pub writing: bool,
    pub choices: Vec<Choice>,
}
