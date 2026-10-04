//! What has changed among the sessions, kept for long enough that an overseer
//! who was busy writing a line can catch up on what happened meanwhile.
//!
//! The overseer is an agent, and an agent is slow and costs something each
//! time it looks. So it is not shown the sessions as they happen — it asks
//! after them, says how far it had already read, and is held here until there
//! is something past that. What it is handed is a list of who changed and how,
//! which is enough to know where to look and not so much that reading it is
//! the work.
//!
//! Numbered from one for the life of this window. A window that comes up again
//! starts counting again, and an overseer still holding a number from the last
//! one is told it has missed things rather than being kept waiting for a
//! number this window will take minutes to reach.

use std::collections::{HashSet, VecDeque};
use std::sync::{Condvar, Mutex};
use std::time::{Duration, Instant};

use serde::Serialize;

use crate::ask::Doing;
use crate::sync::lock;

/// How many changes are held. An overseer that has not asked in long enough
/// for more than this to pile up is told it missed some, and reads every
/// session again — which is what it would have had to do with that many
/// anyway.
pub const HELD: usize = 512;

/// One session, and what happened to it.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Change {
    pub id: String,
    #[serde(flatten)]
    pub what: What,
}

/// What happened, named the way the overseer is told it.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum What {
    /// A shell started.
    Opened,
    /// A session ended, and whatever was said about it went with it.
    Ended,
    /// It turned to doing something else.
    Doing { doing: Doing },
    /// It put a question to the person, or stopped asking one: nothing in it is
    /// the question going away.
    Asking { question: Option<String> },
    /// The agent in it said what it is working on, or that there is nothing to
    /// show.
    Report { report: Option<String> },
}

impl What {
    /// Which of these it is, without what it carries: two of the same kind for
    /// the same session are one change by the time anybody reads them.
    fn kind(&self) -> &'static str {
        match self {
            Self::Opened => "opened",
            Self::Ended => "ended",
            Self::Doing { .. } => "doing",
            Self::Asking { .. } => "asking",
            Self::Report { .. } => "report",
        }
    }
}

/// What a wait comes back with.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Caught {
    /// What to wait from next time.
    pub cursor: u64,
    /// What changed since the place waited from, the latest of each kind for
    /// each session, in the order they last happened.
    pub changes: Vec<Change>,
    /// Some of what changed is no longer held — or the number waited from was
    /// never this window's — so `changes` is not the whole story and the
    /// sessions have to be read again from the top.
    pub missed: bool,
}

/// The changes, and a way to be woken when there is another.
#[derive(Default)]
pub struct Journal {
    kept: Mutex<Kept>,
    arrived: Condvar,
}

#[derive(Default)]
struct Kept {
    /// The number of the latest change, or nought before there has been one.
    cursor: u64,
    held: VecDeque<(u64, Change)>,
    /// The number of the latest change let go of to make room, which is how a
    /// wait from before it knows it cannot be answered in full.
    forgotten: u64,
}

impl Kept {
    /// Whether a wait from `since` would be handed less than happened.
    fn missed(&self, since: u64) -> bool {
        since > self.cursor || since < self.forgotten
    }

    /// Everything after `since` that is wanted, with each session's changes of
    /// one kind folded into the last of them.
    fn after(&self, since: u64, wanted: &impl Fn(&Change) -> bool) -> Vec<Change> {
        let mut seen = HashSet::new();
        let mut changes: Vec<Change> = self
            .held
            .iter()
            .rev()
            .take_while(|(at, _)| *at > since)
            .map(|(_, change)| change)
            .filter(|change| wanted(change))
            .filter(|change| seen.insert((change.id.clone(), change.what.kind())))
            .cloned()
            .collect();
        changes.reverse();
        changes
    }
}

impl Journal {
    /// Writes one change down, and wakes whoever is waiting for it.
    pub fn note(&self, id: &str, what: What) {
        {
            let mut kept = lock(&self.kept);
            kept.cursor += 1;
            let at = kept.cursor;
            kept.held.push_back((
                at,
                Change {
                    id: id.to_string(),
                    what,
                },
            ));
            while kept.held.len() > HELD {
                if let Some((gone, _)) = kept.held.pop_front() {
                    kept.forgotten = gone;
                }
            }
        }
        self.arrived.notify_all();
    }

    /// The number of the latest change.
    pub fn cursor(&self) -> u64 {
        lock(&self.kept).cursor
    }

    /// What changed after `since`, waiting up to `timeout` for something to.
    ///
    /// No `since` is now: whatever happens from here on. Changes already there
    /// are handed over at once. Where there were none and one arrives, the wait
    /// goes on for `linger` more before answering, because a session that
    /// changes once is usually in the middle of changing several times — a
    /// command finishes and the prompt comes back, an agent stops and asks —
    /// and an overseer woken for each of those is an overseer paying to read
    /// the same session three times. `wanted` leaves out what this overseer is
    /// not to be told, which is mostly its own terminal.
    pub fn wait(
        &self,
        since: Option<u64>,
        timeout: Duration,
        linger: Duration,
        wanted: impl Fn(&Change) -> bool,
    ) -> Caught {
        let deadline = Instant::now() + timeout;
        let mut kept = lock(&self.kept);
        let since = since.unwrap_or(kept.cursor);
        let mut until: Option<Instant> = None;
        let mut first = true;

        loop {
            let changes = kept.after(since, &wanted);
            let missed = kept.missed(since);
            let now = Instant::now();
            let found = !changes.is_empty();
            if missed || (found && first) {
                return Caught {
                    cursor: kept.cursor,
                    changes,
                    missed,
                };
            }
            first = false;
            if found && until.is_none() {
                until = Some((now + linger).min(deadline));
            }
            let stop = until.unwrap_or(deadline);
            if now >= stop {
                return Caught {
                    cursor: kept.cursor,
                    changes,
                    missed,
                };
            }
            kept = self
                .arrived
                .wait_timeout(kept, stop - now)
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .0;
        }
    }
}
