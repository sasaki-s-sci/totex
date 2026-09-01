//! One session's screen, and the question standing on it.

use super::super::{Ask, Doing, Reading, Screen, doing, read, typed};

/// Fed everything the session says whether or not a terminal is being drawn for
/// it — a session nobody has opened is exactly the one whose question the graph
/// has to carry.
pub struct Watcher {
    pub(super) screen: Screen,
    asking: Option<Ask>,
    /// The last thing typed at this session, kept rather than read when asked
    /// for.
    ///
    /// Held because the screen forgets: a turn an agent was handed scrolls off
    /// the top the moment it starts working, and what somebody wants to know
    /// looking at a stack of marks is what each of those terminals was asked to
    /// do — which for a busy one is no longer drawn anywhere. So every run of
    /// output is read for one, and the last one there was stands until another
    /// takes its place. A session that has never been typed at has none.
    typed: Option<String>,
    /// The command that started whatever is drawing on this screen, which is
    /// the reading above with the agents taken out of it.
    ///
    /// Held apart because `typed` cannot survive an agent. That reading takes
    /// the lowest line anybody could have typed on, and an agent redraws a
    /// whole transcript of lines that look exactly like that — its composer,
    /// the answer its own mark is standing on. So a session running one says it
    /// was last told `1. Yes, run it`, which is right for the label the canvas
    /// draws and useless for saying what is running.
    ///
    /// This is the same reading, kept only while the session is on its ordinary
    /// screen. An agent takes the alternate one as it starts, so what is left
    /// standing here is the line that started it, and it is left standing for
    /// as long as the agent holds that screen.
    started: Option<String>,
    /// What the session is doing, as its screen stands.
    ///
    /// Kept rather than read when asked for, because this one is *sent*: the
    /// mark on the canvas is drawn from it, and a window that had to ask would
    /// be a window polling every session for a glyph. So the reading is taken
    /// as the output arrives, and what crosses to the window is the moments it
    /// changed — which for a shell somebody is typing at is twice a command.
    doing: Doing,
    /// Whether that has changed since anybody was told, which is what keeps a
    /// session drawing its own output from saying `running` a thousand times.
    turned: bool,
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
            typed: None,
            started: None,
            // A shell that has not printed its prompt yet is a shell nobody
            // can type at, which is what starting up is.
            doing: Doing::Running,
            turned: false,
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
        self.remember();
        self.reckon();
        self.settle(read(&self.screen))
    }

    /// Takes a whole backlog at once and stands wherever it leaves the screen.
    /// Nothing is reported: this is a question already being asked, arrived at a
    /// second time. A window that has just come up asks via `pty_asking`.
    ///
    /// One thing does not survive it: a session already running an agent comes
    /// back as running something, because what says it is an agent is the line
    /// that started it — and the whole backlog goes in at once, so there is no
    /// moment here at which that line was the last thing typed. It is right
    /// again the next time the session is left at a prompt. Nothing calls this
    /// from the window today; `rederive` is a command for the day something
    /// does.
    pub(super) fn replay(&mut self, text: &str, upto: usize) {
        self.screen.feed(text);
        self.asking = read(&self.screen).map(Ask::of);
        // Whatever is on the screen this backlog leaves, and no more: the runs
        // it was made of went by in one, so there is nothing here to have
        // watched somebody type.
        self.remember();
        self.reckon();
        // Nothing was told, so nothing is owed: a window that has just come up
        // asks for the lot of these through `pty_doing`.
        self.turned = false;
        self.fed = upto;
    }

    pub fn resize(&mut self, rows: u16, cols: u16) {
        self.screen.resize(rows, cols);
    }

    pub fn asking(&self) -> Option<&Ask> {
        self.asking.as_ref()
    }

    /// The last thing typed at this session, or nothing where none of it was
    /// ever drawn.
    pub fn typed(&self) -> Option<&str> {
        self.typed.as_deref()
    }

    /// Takes what is being typed off the screen as it stands, and keeps it.
    ///
    /// Kept only when there is something to keep. A composer emptied by the
    /// return that sent it says nothing about what was sent, and a shell
    /// standing at a fresh prompt says nothing about the command that has just
    /// finished — so the reading that found nothing leaves the last one that
    /// found something where it is.
    fn remember(&mut self) {
        if let Some(said) = typed(&self.screen) {
            self.typed = Some(said);
        }
        // And the same reading again, kept only off the ordinary screen — see
        // `started`. Taken here rather than beside the state it is read for,
        // because this is the one place that knows the reading is fresh.
        if !self.screen.standing().alt && self.started != self.typed {
            self.started = self.typed.clone();
        }
    }

    /// Takes the session's state off the screen as it stands, and keeps it.
    fn reckon(&mut self) {
        let doing = doing(&self.screen, self.started.as_deref());
        if doing == self.doing {
            return;
        }
        self.doing = doing;
        self.turned = true;
    }

    /// What the session is doing, for a window asking after the lot of them.
    pub fn doing(&self) -> Doing {
        self.doing
    }

    /// The same thing, but only where it has changed since it was last asked
    /// for — which is what is worth crossing to the window.
    pub fn turned(&mut self) -> Option<Doing> {
        std::mem::take(&mut self.turned).then_some(self.doing)
    }

    /// How far into everything the session has said this screen has been fed,
    /// which is how anything else tells whether the agent has drawn since.
    pub fn drawn(&self) -> usize {
        self.fed
    }

    /// Reads the screen again as it stands, without a word having been added to
    /// it.
    ///
    /// For a press the agent did nothing about — see `look_again` beside the
    /// acts. Everything else here reads because something arrived; this reads
    /// because nothing did, and the same screen read twice is the same question
    /// under the same name.
    pub fn again(&mut self) -> Option<Option<Ask>> {
        self.settle(read(&self.screen))
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
