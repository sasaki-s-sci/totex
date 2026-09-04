//! What crosses the socket, in both directions.
//!
//! Lines of JSON. A window asks under a number and is answered under the same
//! number, in whatever order the answers finish; and what the sessions do is
//! pushed down to every window as it happens, under no number at all, because
//! nobody asked. The two ends share these shapes by linking this crate, which
//! is the only thing that keeps them agreeing — and [`crate::PROTOCOL`] is what
//! says when they no longer do.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::door::Report;
use crate::session::Event;

/// The file this program writes saying where it is, beside the store.
pub const ADDRESS: &str = "address.json";

/// Where this program says it is, for a window looking for it.
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Address {
    pub port: u16,
    /// What a window has to say first. Invented per run and never on the wire
    /// in the clear anywhere but the loopback, so that a program on this
    /// machine that can open a socket is not for that reason one that can write
    /// on somebody's terminal.
    pub token: String,
    pub pid: u32,
    pub version: String,
    pub protocol: u32,
}

impl Address {
    pub fn path(home: &Path) -> PathBuf {
        home.join(ADDRESS)
    }

    pub fn read(home: &Path) -> Option<Self> {
        let bytes = std::fs::read(Self::path(home)).ok()?;
        serde_json::from_slice(&bytes).ok()
    }
}

/// Every question this program answers, by name.
///
/// Said out loud, and not derived from the table that answers them, because it
/// is what this program announces about itself when a window connects: a window
/// that asks for a name this list does not carry is a newer window talking to an
/// older program, and the answer to that is `unknown` rather than a hang.
pub const ANSWERS: &[&str] = &[
    "open",
    "sessions",
    "attach",
    "write",
    "resize",
    "close",
    "door_serving",
    "door_serve",
    "door_stop",
    "door_reports",
    "door_setups",
    "door_install",
    "store_get",
    "store_put",
    "store_list",
    "take_program",
    "stop",
    "relaunch",
];

/// What this program says about itself the moment a window has said the token.
pub fn hello(version: &str) -> Value {
    json!({ "keep": { "version": version, "protocol": crate::PROTOCOL, "answers": ANSWERS } })
}

/// One question, as it arrives.
#[derive(Deserialize)]
pub struct Asked {
    /// What the answer will be marked with on the way back.
    pub id: u64,
    /// The name of the question -- see [`ANSWERS`].
    #[serde(rename = "do")]
    pub command: String,
    #[serde(default, rename = "with")]
    pub with: Value,
}

/// One answer, as it goes back.
pub fn answered(id: u64, answer: Option<Result<Value, String>>) -> Value {
    match answer {
        Some(Ok(said)) => json!({ "id": id, "said": said }),
        Some(Err(but)) => json!({ "id": id, "but": but }),
        None => json!({ "id": id, "unknown": true }),
    }
}

/// What the sessions do, as it is pushed down to every window.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "event", rename_all = "camelCase")]
pub enum Told {
    Opened {
        id: String,
        rows: u16,
        cols: u16,
    },
    Said {
        id: String,
        data: String,
        seq: usize,
    },
    Resized {
        id: String,
        rows: u16,
        cols: u16,
    },
    Ended {
        id: String,
    },
    /// What a session said it was doing through the door, or — with nothing in
    /// it — that there is nothing to show any more.
    Report {
        id: String,
        report: Option<Report>,
    },
    /// How much of a release has come down, said as it arrives. Cumulative
    /// rather than a chunk at a time, so that a window which missed one
    /// message draws the same ring as one that missed none.
    Coming {
        taken: u64,
        length: Option<u64>,
    },
}

impl Told {
    /// One event of the sessions', addressed.
    pub fn of(id: &str, event: Event<'_>) -> Self {
        let id = id.to_string();
        match event {
            Event::Opened { rows, cols } => Told::Opened { id, rows, cols },
            Event::Said { data, at } => Told::Said {
                id,
                data: data.to_string(),
                seq: at,
            },
            Event::Resized { rows, cols } => Told::Resized { id, rows, cols },
            Event::Ended => Told::Ended { id },
        }
    }

    /// The same, read back the other way: which session, and what it did. A
    /// report is not one of the sessions' events and reads as nothing here.
    pub fn event(&self) -> Option<(&str, Event<'_>)> {
        Some(match self {
            Told::Opened { id, rows, cols } => (
                id,
                Event::Opened {
                    rows: *rows,
                    cols: *cols,
                },
            ),
            Told::Said { id, data, seq } => (id, Event::Said { data, at: *seq }),
            Told::Resized { id, rows, cols } => (
                id,
                Event::Resized {
                    rows: *rows,
                    cols: *cols,
                },
            ),
            Told::Ended { id } => (id, Event::Ended),
            Told::Report { .. } | Told::Coming { .. } => return None,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn what_a_session_does_survives_the_wire_both_ways() {
        let told = Told::of("s1", Event::Said { data: "hi", at: 7 });
        let line = serde_json::to_string(&told).expect("json");
        assert!(line.contains("\"event\":\"said\""), "{line}");
        let back: Told = serde_json::from_str(&line).expect("json back");
        match back.event() {
            Some(("s1", Event::Said { data: "hi", at: 7 })) => {}
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn a_report_is_not_one_of_the_sessions_events() {
        let told = Told::Report {
            id: "s1".to_string(),
            report: None,
        };
        assert!(told.event().is_none());
        let line = serde_json::to_string(&told).expect("json");
        assert!(line.contains("\"event\":\"report\""), "{line}");
    }

    #[test]
    fn every_name_announced_is_one_the_table_answers_to() {
        for name in ANSWERS {
            assert!(
                crate::serve::answers(name),
                "{name} is announced and not answered"
            );
        }
    }
}
