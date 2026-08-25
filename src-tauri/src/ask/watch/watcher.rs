//! One session's screen, and the question standing on it.

use super::super::{Ask, Reading, Screen, read};

/// Fed everything the session says whether or not a terminal is being drawn for
/// it — a session nobody has opened is exactly the one whose question the graph
/// has to carry.
pub struct Watcher {
    pub(super) screen: Screen,
    asking: Option<Ask>,
    /// How far into everything the session has said this screen has been fed.
    ///
    /// For the moment this is rebuilt: the screen is taken from the backlog in
    /// one go and the runs still arriving live are the same runs that backlog
    /// already holds until the two meet, so a run from before here would be
    /// drawn twice.
    pub(super) fed: usize,
}

impl Watcher {
    /// A screen with nothing on it, at the size the session is being run at.
    pub fn new(rows: u16, cols: u16) -> Self {
        Self {
            screen: Screen::new(rows, cols),
            asking: None,
            fed: 0,
        }
    }

    /// Follows a run of output, and says what is being asked when that changed.
    /// `None` for output that left the question as it was, which is nearly all
    /// of it.
    pub fn keep(&mut self, at: usize, data: &str) -> Option<Option<Ask>> {
        if at < self.fed {
            return None;
        }
        self.fed = at + data.len();
        self.screen.feed(data);
        self.settle(read(&self.screen))
    }

    /// Takes a whole backlog at once and stands wherever it leaves the screen.
    /// Nothing is reported: this is a question already being asked, arrived at a
    /// second time. A window that has just come up asks via `pty_asking`.
    pub(super) fn replay(&mut self, text: &str, upto: usize) {
        self.screen.feed(text);
        self.asking = read(&self.screen).map(Ask::of);
        self.fed = upto;
    }

    pub fn resize(&mut self, rows: u16, cols: u16) {
        self.screen.resize(rows, cols);
    }

    pub fn asking(&self) -> Option<&Ask> {
        self.asking.as_ref()
    }

    /// Puts the question away once it has been answered. The agent would redraw
    /// without it a moment later, but a moment is exactly how long a card that
    /// has been pressed must not stay on the graph. False when it is no longer
    /// the question being asked, which refuses an answer meant for something
    /// else.
    pub fn answered(&mut self, seq: u64) -> bool {
        if self.asking.as_ref().is_some_and(|ask| ask.seq == seq) {
            self.asking = None;
            return true;
        }
        false
    }

    /// The reading against what was already being asked. The same question with
    /// the mark on another line keeps the same name — an answer half given is
    /// not refused because somebody moved the selection — but it is a different
    /// drawing of it, and the card follows the agent's own mark.
    fn settle(&mut self, reading: Option<Reading>) -> Option<Option<Ask>> {
        let Some(reading) = reading else {
            return self.asking.take().map(|_| None);
        };

        let ask = Ask::of(reading);
        if self.asking.as_ref() == Some(&ask) {
            return None;
        }
        self.asking = Some(ask.clone());
        Some(Some(ask))
    }
}
