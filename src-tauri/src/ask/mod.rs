//! What an agent running in a terminal is asking, read off the screen it drew
//! it on.
//!
//! The agents all stop and ask the same kind of question — may I run this, may
//! I write that, which of these did you mean — and every one of them draws it
//! as a box at the foot of the screen. A terminal has no interface to ask
//! through, so the drawing is the only place the question exists: the stream is
//! followed into a `Screen`, the screen is `read` whenever it changes, and what
//! is found is handed to the window as a question with answers.
//!
//! Four ways of answering are read, and `Taking` says which one a question
//! wants. The reading is a pattern rather than a parse — it takes what is
//! unmistakably a question being put and leaves every idle shell prompt and
//! empty composer alone, because a card that stood on those would stop meaning
//! that somebody's turn has stopped.
//!
//! One smaller thing is read off the same screen and kept beside the question:
//! the last thing typed at the session — see `typed`. It is not a question and
//! nothing waits on it; it is here because this is where a session's screen is
//! already held, and reading it anywhere else would be holding a second one.

use std::hash::{DefaultHasher, Hash, Hasher};

use serde::Serialize;

mod choice;
mod glyph;
mod read;
mod screen;
mod typed;
pub mod watch;

#[cfg(test)]
mod tests;

pub use read::read;
pub use screen::Screen;
pub use typed::typed;

/// One question, as it can be answered from anywhere the window draws it.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Ask {
    /// Which question this is, hashed from the question itself so that a press
    /// meant for one can never land on whatever the agent asked next.
    pub seq: u64,
    /// What the question is about, in the order the box says it.
    pub detail: Vec<String>,
    /// The question, which is the line the answers underneath it are to.
    pub question: String,
    /// How this one is taken, the one thing not readable from what it says.
    pub taking: Taking,
    /// Whether several answers may be held before the question is taken, which
    /// an agent shows by drawing a box beside every answer.
    pub picking: bool,
    /// Whether the answer the mark stands on is one to be written at, which
    /// only the caret says.
    pub writing: bool,
    /// The answers offered, or none at all when the answer is to be written.
    pub choices: Vec<Choice>,
}

/// What has to be typed at a session to take an answer.
#[derive(Clone, Copy, Debug, Hash, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Taking {
    /// The key the agent printed beside the answer, typed on its own.
    Key,
    /// The key and a return, because a line is not read until there is one.
    Line,
    /// The agent's own mark, walked to the answer with the arrows and taken
    /// with a return — so how far to walk is counted at the moment of the press.
    Walk,
    /// Words: there is no list, and what is typed is whatever was written.
    Words,
}

/// One of the answers, as the agent itself offered it.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Choice {
    /// What an answer names this one by: the key the agent printed, or the
    /// place it stands in for a list that is walked instead.
    pub key: String,
    pub label: String,
    /// Where the agent's own cursor is standing.
    pub selected: bool,
    /// Whether the agent is holding this one as taken, which is not the mark.
    pub picked: bool,
}

/// A question as it was read, before it has a name to be answered by.
#[derive(Clone, Debug, PartialEq)]
pub struct Reading {
    pub detail: Vec<String>,
    pub question: String,
    pub taking: Taking,
    pub picking: bool,
    pub writing: bool,
    pub choices: Vec<Choice>,
}

impl Reading {
    /// What an answer is addressed to: this question and no other.
    ///
    /// Everything the person was shown goes in; everything that moves while the
    /// question stands — the mark, what is held, the row being written at —
    /// stays out, so the same box read twice hashes the same both times. Cut to
    /// forty-eight bits because the window counts in doubles.
    pub fn seq(&self) -> u64 {
        let mut hasher = DefaultHasher::new();
        self.detail.hash(&mut hasher);
        self.question.hash(&mut hasher);
        self.taking.hash(&mut hasher);
        self.picking.hash(&mut hasher);
        for choice in &self.choices {
            choice.key.hash(&mut hasher);
            choice.label.hash(&mut hasher);
        }
        hasher.finish() & ((1 << 48) - 1)
    }
}

impl Ask {
    /// The question a reading found, under the name an answer comes back with.
    pub fn of(reading: Reading) -> Self {
        Self {
            seq: reading.seq(),
            detail: reading.detail,
            question: reading.question,
            taking: reading.taking,
            picking: reading.picking,
            writing: reading.writing,
            choices: reading.choices,
        }
    }
}
