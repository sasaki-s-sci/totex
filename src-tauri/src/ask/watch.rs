//! Which session is standing on a question, kept beside the sessions rather
//! than inside them.
//!
//! Every question in the app is read off a session's own screen, which makes
//! all of this derived: hand the same bytes to the same reading and the same
//! question comes back, under the same name. Nothing in here is a possession.
//! It is a saving — the screen each session has drawn, so that a run of output
//! can be answered by looking at what changed in it rather than at all of it —
//! and the whole of it can be thrown away and taken again out of what the
//! sessions have already said. `rederive` is that, written down.
//!
//! Which is why it is on this side of the line. `pty` owns processes and
//! nothing else; this follows what they say, through the one seam it offers.
//! The reading is also the part of the app that changes most often — every
//! agent that draws its box a little differently is a change in here — so it
//! is exactly the part that has to be replaceable without a shell noticing.

use std::collections::HashMap;
use std::sync::{Arc, Mutex, MutexGuard};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, Runtime};

use super::{Ask, Reading, Screen, Taking, read};
use crate::pty::{self, Event, PtyState};

/// Carries what a session is asking, and its going away again.
///
/// Sent whether or not a terminal is being drawn for the session: a question is
/// asked of the person at the window, not of the panel, and the graph is where
/// the window has to be able to see it and answer it.
pub const ASK_EVENT: &str = "pty:ask";

/// What a session is asking, or — with nothing in it — that it has stopped.
///
/// Addressed to the session rather than to a terminal: the question belongs to
/// the process, and the marks that draw it are wherever the graph happens to be
/// drawing that process.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Asking {
    id: String,
    ask: Option<Ask>,
}

/// A session's screen, and the question it has on it.
///
/// One of these per running session, fed everything the session says whether or
/// not a terminal is being drawn for it — a question is asked of the person and
/// not of the panel, and a session nobody has opened is exactly the one whose
/// question the graph has to carry.
pub struct Watcher {
    screen: Screen,
    asking: Option<Ask>,
    /// How far into everything the session has said this screen has been fed.
    ///
    /// What it is for is the moment this is rebuilt. The screen is taken from
    /// the backlog in one go, and the runs still arriving live are the same
    /// runs that backlog already holds until the two meet — so a run from
    /// before here is one this screen has had, and drawing it again would draw
    /// it twice. The terminal in the window tells the same thing with the same
    /// two numbers.
    fed: usize,
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
    ///
    /// `None` for output that left the question as it was, which is nearly all
    /// of it: an agent writing a paragraph is a hundred of these, and the graph
    /// should hear about none of them.
    pub fn keep(&mut self, at: usize, data: &str) -> Option<Option<Ask>> {
        if at < self.fed {
            return None;
        }
        self.fed = at + data.len();
        self.screen.feed(data);
        self.settle(read(&self.screen))
    }

    /// Takes a whole backlog at once and stands wherever it leaves the screen.
    ///
    /// Nothing is reported. This is a question that was already being asked,
    /// arrived at a second time, and the window is not to be told a question
    /// changed because the reading of it was rebuilt underneath. A window that
    /// has itself just come up asks instead — see `pty_asking`.
    fn replay(&mut self, text: &str, upto: usize) {
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

    /// Puts the question away once it has been answered.
    ///
    /// The agent will redraw the screen without it a moment later and the
    /// reading would clear itself, but a moment is exactly how long a card that
    /// has been pressed must not stay on the graph. False when it is no longer
    /// the question being asked, which is what refuses an answer meant for
    /// something else.
    pub fn answered(&mut self, seq: u64) -> bool {
        if self.asking.as_ref().is_some_and(|ask| ask.seq == seq) {
            self.asking = None;
            return true;
        }
        false
    }

    /// The reading against what was already being asked.
    fn settle(&mut self, reading: Option<Reading>) -> Option<Option<Ask>> {
        let Some(reading) = reading else {
            return self.asking.take().map(|_| None);
        };

        // The same question with the agent's own cursor on another line is the
        // same question and keeps the same name — the answer somebody is in the
        // middle of giving is not refused because they moved the selection in
        // the terminal — but it is a different drawing of it, and the card
        // follows the agent's own mark.
        let ask = Ask::of(reading);
        if self.asking.as_ref() == Some(&ask) {
            return None;
        }
        self.asking = Some(ask.clone());
        Some(Some(ask))
    }
}

/// One screen per running session, and nothing that is not on one.
#[derive(Default)]
pub struct AskState {
    watching: Mutex<HashMap<String, Watcher>>,
}

impl AskState {
    fn lock(&self) -> MutexGuard<'_, HashMap<String, Watcher>> {
        crate::sync::lock(&self.watching)
    }
}

/// Starts following the sessions, for the life of the app.
///
/// The one place the two sides are joined, and joined this way round on
/// purpose: `pty` is told that something is following and never what it is for.
pub fn attend<R: Runtime>(app: &AppHandle<R>) {
    let handle = app.clone();
    app.state::<PtyState>().follow(Arc::new(move |id, event| {
        let state = handle.state::<AskState>();
        match event {
            Event::Opened { rows, cols } => {
                state
                    .lock()
                    .insert(id.to_string(), Watcher::new(rows, cols));
            }
            Event::Said { data, at } => {
                // Read under the lock and told outside it: telling crosses to
                // the window, and the next run of output a session has must not
                // be waiting behind that.
                let told = state
                    .lock()
                    .get_mut(id)
                    .and_then(|watcher| watcher.keep(at, data));
                if let Some(ask) = told {
                    let _ = handle.emit(
                        ASK_EVENT,
                        Asking {
                            id: id.to_string(),
                            ask,
                        },
                    );
                }
            }
            Event::Resized { rows, cols } => {
                if let Some(watcher) = state.lock().get_mut(id) {
                    watcher.resize(rows, cols);
                }
            }
            Event::Ended => {
                state.lock().remove(id);
            }
        }
    }));
}

/// Throws every screen away and reads them again out of the backlogs.
///
/// What the boundary is for, done. Nothing that was being asked is lost by it:
/// the sessions still hold what they said, the same reading finds the same
/// question in it, and a question is named by what it says — so a card the
/// window drew before this ran is still answerable after it.
///
/// The map is held for the whole of it. A run of output arriving meanwhile
/// waits here rather than landing on a screen that is halfway rebuilt, and by
/// the time it is let through it is a run the backlog already contained, which
/// is what `fed` is for.
pub fn rederive<R: Runtime>(app: &AppHandle<R>) {
    let running = pty::running(app);
    let state = app.state::<AskState>();
    let mut watching = state.lock();
    watching.clear();
    for session in running {
        // Gone between being listed and being read: there is nothing to read.
        let Some(held) = pty::pty_attach(app.clone(), session.id.clone()) else {
            continue;
        };
        let mut watcher = Watcher::new(session.rows, session.cols);
        watcher.replay(&held.text, held.upto);
        watching.insert(session.id, watcher);
    }
}

/// Every question standing right now, for a window that has just come up.
///
/// The event is what carries these from moment to moment; this is the first
/// look, for the same reason the sweep has one — a window that only listened
/// would show nothing until the next time an agent happened to redraw, which
/// for a session sitting on a question is never.
#[tauri::command]
pub fn pty_asking<R: Runtime>(app: AppHandle<R>) -> Vec<Asking> {
    let state = app.state::<AskState>();
    let watching = state.lock();
    watching
        .iter()
        .filter_map(|(id, watcher)| {
            Some(Asking {
                id: id.clone(),
                ask: Some(watcher.asking()?.clone()),
            })
        })
        .collect()
}

/// What is typed at a session to take one of the answers it is offering.
///
/// The keystrokes, rather than the answer: typing at it is the only way a
/// terminal has of being told anything, and the four kinds of question are four
/// different things to type. Three of them are the same keystrokes whenever
/// they are sent, which is what the agents' own keys are for.
///
/// The fourth is not, and is the reason this is worked out here rather than
/// carried in the card. A list drawn with no keys on it can only be answered by
/// walking the agent's own mark down to the line and taking it, and how far to
/// walk is a fact about the screen as it stands at the moment of the press —
/// not about the reading the card was drawn from, which by then is old enough
/// for somebody to have moved the mark in the terminal since.
fn typing(ask: &Ask, key: &str) -> Option<String> {
    let at = ask.choices.iter().position(|choice| choice.key == key)?;
    Some(match ask.taking {
        Taking::Key => ask.choices[at].key.clone(),
        Taking::Line => format!("{}\r", ask.choices[at].key),
        Taking::Walk => {
            let here = ask.choices.iter().position(|choice| choice.selected)?;
            let step = if at > here { "\u{1b}[B" } else { "\u{1b}[A" };
            format!("{}\r", step.repeat(at.abs_diff(here)))
        }
        // Words are written rather than pressed, and go by `pty_reply`.
        Taking::Words => return None,
    })
}

/// Answers the question a session is asking, by typing what takes that answer.
///
/// `seq` is what makes that safe. A card is drawn from a question that was on
/// the screen when it was read, and the one thing that must never happen is a
/// press meant for "may I delete this" arriving at whatever the agent went on
/// to ask instead — so an answer names the question it was given for, and is
/// refused outright if that is no longer the one being asked.
#[tauri::command]
pub fn pty_answer<R: Runtime>(
    app: AppHandle<R>,
    id: String,
    seq: u64,
    key: String,
) -> Result<(), String> {
    let typed = {
        let state = app.state::<AskState>();
        let mut watching = state.lock();
        let watcher = watching.get_mut(&id).ok_or("no-session")?;
        let asking = watcher.asking().ok_or("asking-nothing")?;
        if asking.seq != seq {
            return Err("asking-something-else".to_string());
        }
        let typed = typing(asking, &key).ok_or("no-answer")?;
        // Put away and answered in one go: the question is taken off the graph
        // as the key goes, rather than at a redraw later, because the moment
        // between a press and an agent's next frame is exactly how long a card
        // that has been answered must not still be standing there.
        watcher.answered(seq);
        typed
    };

    pty::pty_write(app.clone(), id.clone(), typed)?;

    // Said outright rather than left to the next reading: whatever else the
    // window is drawing this session as, the question has been answered.
    let _ = app.emit(ASK_EVENT, Asking { id, ask: None });
    Ok(())
}

/// Answers a question that asked to be written at, by writing at it.
///
/// The other half of `pty_answer`, under the same rules: the question names
/// itself, an answer to a question that has moved on is refused, and the card
/// goes as the words do. A return goes with them, because a question waiting on
/// a line is not looking at it until there is one.
///
/// Only what can be typed goes. What is written into a field on a canvas is not
/// always typing — it is as often something pasted from somewhere else — and a
/// return in the middle of it would answer the question half way through, while
/// an escape in it would be read by the agent as a key it was never sent.
#[tauri::command]
pub fn pty_reply<R: Runtime>(
    app: AppHandle<R>,
    id: String,
    seq: u64,
    text: String,
) -> Result<(), String> {
    {
        let state = app.state::<AskState>();
        let mut watching = state.lock();
        let watcher = watching.get_mut(&id).ok_or("no-session")?;
        let asking = watcher.asking().ok_or("asking-nothing")?;
        if asking.seq != seq {
            return Err("asking-something-else".to_string());
        }
        if asking.taking != Taking::Words {
            return Err("asking-for-a-key".to_string());
        }
        watcher.answered(seq);
    }

    let said: String = text.chars().filter(|letter| !letter.is_control()).collect();
    pty::pty_write(app.clone(), id.clone(), format!("{said}\r"))?;

    let _ = app.emit(ASK_EVENT, Asking { id, ask: None });
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::sync::mpsc;
    use std::time::{Duration, Instant};

    use tauri::Listener;
    use tauri::test::{MockRuntime, mock_builder, mock_context, noop_assets};

    use super::*;

    fn mock_app() -> tauri::App<MockRuntime> {
        let app = mock_builder()
            .manage(PtyState::default())
            .manage(AskState::default())
            .build(mock_context(noop_assets()))
            .expect("mock app");
        attend(app.handle());
        app
    }

    /// Answers the one question a shell asks of the terminal it starts in.
    ///
    /// A login shell — zsh, and bash under some settings — asks where the
    /// cursor is before it draws its first prompt, and waits for the answer.
    /// This stands in for the terminal emulator that would reply, because
    /// without a reply the shell never reads the line that was typed at it.
    fn answering(app: &AppHandle<MockRuntime>, id: &str) {
        let handle = app.clone();
        let name = id.to_string();
        app.listen("pty:data", move |event| {
            if let Ok(chunk) = serde_json::from_str::<serde_json::Value>(event.payload())
                && let Some(data) = chunk.get("data").and_then(|value| value.as_str())
                && data.contains("\u{1b}[6n")
            {
                let _ = pty::pty_write(handle.clone(), name.clone(), "\u{1b}[1;1R".to_string());
            }
        });
    }

    /// Draws the box an agent draws, and leaves it standing.
    ///
    /// A question is the last thing on the screen, which is the whole of what
    /// tells one from a list somebody wrote out — so the sleep is what keeps
    /// the shell from printing its next prompt underneath it.
    fn draw_box(app: &AppHandle<MockRuntime>, id: &str) {
        let drawn = [
            "\u{256d}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{256e}\\n",
            "\u{2502} Bash command \u{2502}\\n",
            "\u{2502}              \u{2502}\\n",
            "\u{2502}   ls -la      \u{2502}\\n",
            "\u{2502}              \u{2502}\\n",
            "\u{2502} Proceed?     \u{2502}\\n",
            "\u{2502} \u{276f} 1. Yes     \u{2502}\\n",
            "\u{2502}   2. No      \u{2502}\\n",
            "\u{2570}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{256f}\\n",
        ]
        .concat();
        pty::pty_write(
            app.clone(),
            id.to_string(),
            format!("printf '{drawn}'; sleep 30\n"),
        )
        .expect("the shell takes input");
    }

    /// Waits for a question to reach the window, and hands it over.
    fn wait_asked(rx: &mpsc::Receiver<String>) -> Option<serde_json::Value> {
        wait_for(rx, |_| true)
    }

    /// And for a particular one, for a test that has drawn more than one thing.
    fn wait_for(
        rx: &mpsc::Receiver<String>,
        wanted: impl Fn(&serde_json::Value) -> bool,
    ) -> Option<serde_json::Value> {
        let deadline = Instant::now() + Duration::from_secs(20);
        while Instant::now() < deadline {
            let Ok(payload) = rx.recv_timeout(Duration::from_millis(250)) else {
                continue;
            };
            let said: serde_json::Value = serde_json::from_str(&payload).expect("an ask");
            if said
                .get("ask")
                .is_some_and(|ask| !ask.is_null() && wanted(ask))
            {
                return Some(said);
            }
        }
        None
    }

    /// A list drawn with no keys beside it, with the agent's mark on one line.
    fn walking_box(on: usize) -> String {
        let answers = ["Allow once", "Allow always", "Deny"];
        let mut drawn = String::from("\u{1b}[?1049h\u{1b}[?25l\u{1b}[2J\u{1b}[H");
        drawn.push_str("\u{256d}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{256e}\r\n");
        drawn.push_str("\u{2502} Run this command?  \u{2502}\r\n");
        for (at, answer) in answers.iter().enumerate() {
            let mark = if at == on { '\u{276f}' } else { ' ' };
            drawn.push_str(&format!("\u{2502} {mark} {answer:<14} \u{2502}\r\n"));
        }
        drawn.push_str("\u{2570}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{256f}\r\n");
        drawn
    }

    /// Hands a run to a watcher the way a session does: after everything it has
    /// already been handed.
    fn feed(watcher: &mut Watcher, data: &str) -> Option<Option<Ask>> {
        let at = watcher.fed;
        watcher.keep(at, data)
    }

    /// What an answer is addressed to, and what it is not.
    ///
    /// The same question is the same question every time it is read — a card
    /// somebody is part way through answering is not refused because the agent
    /// redrew the box under it — and anything that changes what the question
    /// says is a different one, which is what an answer meant for one of them
    /// landing on the other would have to get past.
    #[test]
    fn a_question_is_named_by_what_it_says() {
        let mut watcher = Watcher::new(24, 60);

        let first = feed(&mut watcher, &super::super::tests::asking_box())
            .expect("the question is news")
            .expect("and it is being asked");

        // The very same screen again: nothing to say.
        assert!(feed(&mut watcher, "").is_none());

        // Answered, and the agent draws on. The card goes away.
        watcher.screen.feed("\u{1b}[2J\u{1b}[H");
        watcher.screen.feed("⏺ Removed the build directory.\r\n");
        assert_eq!(feed(&mut watcher, ""), Some(None));
        assert!(watcher.asking().is_none());

        // And a question that says something else is something else.
        let second = feed(
            &mut watcher,
            &super::super::tests::asking_box().replace("rm -rf build/", "rm -rf src/"),
        )
        .expect("asked again")
        .expect("and being asked");
        assert_ne!(
            second.seq, first.seq,
            "an answer must not reach the wrong question"
        );
    }

    /// The unit of the claim `rederive` makes: nothing about a question's name
    /// comes from the screen it was read off, so a screen built from scratch
    /// out of the same output finds the same question under the same name.
    #[test]
    fn the_same_question_read_on_another_screen_is_the_same_question() {
        let mut one = Watcher::new(24, 60);
        let mut two = Watcher::new(24, 60);

        let first = feed(&mut one, &super::super::tests::asking_box())
            .unwrap()
            .unwrap();
        // In one go rather than in runs, which is how a backlog arrives.
        let again = feed(&mut two, &super::super::tests::asking_box())
            .unwrap()
            .unwrap();

        assert_eq!(first, again);
    }

    #[test]
    fn a_selection_moving_leaves_the_question_the_one_it_was() {
        let mut watcher = Watcher::new(24, 60);
        let first = feed(&mut watcher, &super::super::tests::asking_box())
            .unwrap()
            .unwrap();

        watcher.screen.feed("\u{1b}[2J\u{1b}[H");
        let moved = feed(
            &mut watcher,
            &super::super::tests::asking_box().replace("│ ❯ 1. Yes", "│   1. Yes"),
        )
        .expect("the cursor moved")
        .expect("and it is still being asked");

        assert_eq!(moved.seq, first.seq, "the answer is still the same answer");
        assert!(!moved.choices[0].selected);
    }

    #[test]
    fn an_answer_to_a_question_that_has_moved_on_is_refused() {
        let mut watcher = Watcher::new(24, 60);
        let ask = feed(&mut watcher, &super::super::tests::asking_box())
            .unwrap()
            .unwrap();

        assert!(!watcher.answered(ask.seq + 1), "not the question on screen");
        assert!(watcher.answered(ask.seq));
        assert!(watcher.asking().is_none(), "and it is put away at once");
    }

    /// A list with no keys on it is answered from where the mark is standing,
    /// and from where it is standing at the moment of the press.
    ///
    /// The card cannot carry the walk: it is drawn from a reading that is
    /// already a moment old, and the mark is the one part of a question that
    /// moves without the question changing — somebody at the terminal walking
    /// the list themselves leaves the card exactly as it was. So the same card,
    /// pressed twice with the mark somewhere else the second time, is two
    /// different walks to the same answer.
    #[test]
    fn a_list_with_no_keys_is_answered_by_walking_the_mark() {
        let mut watcher = Watcher::new(24, 40);
        let ask = feed(&mut watcher, &walking_box(1))
            .expect("the question is news")
            .expect("and it is being asked");

        assert_eq!(ask.taking, Taking::Walk);
        assert_eq!(typing(&ask, "1").as_deref(), Some("\u{1b}[A\r"));
        assert_eq!(typing(&ask, "2").as_deref(), Some("\r"));
        assert_eq!(typing(&ask, "3").as_deref(), Some("\u{1b}[B\r"));
        assert!(typing(&ask, "4").is_none(), "there is no fourth answer");

        let moved = feed(&mut watcher, &walking_box(2))
            .expect("the mark moved")
            .expect("and it is still being asked");
        assert_eq!(moved.seq, ask.seq, "the answer is still the same answer");
        assert_eq!(typing(&moved, "1").as_deref(), Some("\u{1b}[A\u{1b}[A\r"));
    }

    /// A question that wants words, the whole way through.
    ///
    /// The shell asks for something to be typed, the window is told it is being
    /// asked for words rather than for a key, and what is written on the card
    /// is typed at the session with the return that submits it. A press is
    /// refused: there is nothing there to press.
    #[cfg(unix)]
    #[test]
    fn a_question_that_wants_words_is_answered_by_writing_at_it() {
        let app = mock_app();
        let handle = app.handle().clone();
        let id = "writing".to_string();

        answering(&handle, &id);
        let (tx, rx) = mpsc::channel();
        handle.listen(ASK_EVENT, move |event| {
            let _ = tx.send(event.payload().to_string());
        });

        pty::pty_open(
            handle.clone(),
            id.clone(),
            std::env::temp_dir().display().to_string(),
            24,
            80,
            None,
        )
        .expect("the shell starts");
        pty::pty_write(
            handle.clone(),
            id.clone(),
            "printf '\\nWhat shall the branch be called: '; read name; sleep 30\n".to_string(),
        )
        .expect("the shell takes input");

        let Some(said) = wait_for(&rx, |ask| ask["taking"] == "words") else {
            pty::pty_close(handle.clone(), id.clone());
            panic!("the window was never told words were being asked for");
        };
        let ask = &said["ask"];
        assert_eq!(
            ask["question"],
            serde_json::json!("What shall the branch be called:")
        );
        assert_eq!(ask["choices"].as_array().map(Vec::len), Some(0));

        let seq = ask["seq"].as_u64().expect("the question is named");
        assert!(
            pty_answer(handle.clone(), id.clone(), seq, "1".to_string()).is_err(),
            "a question with nothing to press took a press"
        );
        assert!(
            pty_reply(handle.clone(), id.clone(), seq, "alpha".to_string()).is_ok(),
            "the answer was refused"
        );
        // And again, at a question nobody is asking any more.
        assert!(
            pty_reply(handle.clone(), id.clone(), seq, "alpha".to_string()).is_err(),
            "an answer to a question that has been answered went through"
        );

        pty::pty_close(handle.clone(), id.clone());
    }

    fn asking_now(app: &AppHandle<MockRuntime>, id: &str) -> Option<serde_json::Value> {
        let standing = pty_asking(app.clone());
        let found = standing.into_iter().find(|asking| asking.id == id)?;
        serde_json::to_value(found.ask?).ok()
    }

    /// The whole way through, in one go: a shell draws the box an agent draws,
    /// the window is told what is being asked without anybody having opened a
    /// terminal on it, and the answer is typed back at the session.
    ///
    /// The box is printed rather than an agent run, because what is being
    /// tested is the road between the two — the pty, the seam it hands its
    /// output over through, the screen that output is followed into, the event,
    /// and the answer going the other way. What an agent actually draws is the
    /// reading's own business, and is tested beside it.
    #[cfg(unix)]
    #[test]
    fn a_question_drawn_in_a_session_reaches_the_window_and_is_answered() {
        let app = mock_app();
        let handle = app.handle().clone();
        let id = "asking".to_string();

        answering(&handle, &id);
        let (tx, rx) = mpsc::channel();
        handle.listen(ASK_EVENT, move |event| {
            let _ = tx.send(event.payload().to_string());
        });

        pty::pty_open(
            handle.clone(),
            id.clone(),
            std::env::temp_dir().display().to_string(),
            24,
            80,
            None,
        )
        .expect("the shell starts");
        draw_box(&handle, &id);

        let Some(said) = wait_asked(&rx) else {
            pty::pty_close(handle.clone(), id.clone());
            panic!("the window was never told a question was being asked");
        };
        let ask = &said["ask"];
        assert_eq!(said["id"], serde_json::json!(id));
        assert_eq!(ask["question"], serde_json::json!("Proceed?"));
        assert_eq!(ask["choices"][0]["key"], serde_json::json!("1"));
        assert_eq!(ask["choices"][1]["label"], serde_json::json!("No"));
        assert_eq!(ask["choices"].as_array().map(Vec::len), Some(2));

        let seq = ask["seq"].as_u64().expect("the question is named");
        assert!(
            pty_answer(handle.clone(), id.clone(), seq, "1".to_string()).is_ok(),
            "the answer was refused"
        );
        // And the same answer again, which is now for a question nobody is
        // asking: this is what stops a press landing on whatever came next.
        assert!(
            pty_answer(handle.clone(), id.clone(), seq, "1".to_string()).is_err(),
            "an answer to a question that has been answered went through"
        );

        pty::pty_close(handle.clone(), id.clone());
    }

    /// The boundary itself: everything on this side is thrown away while a
    /// session is standing on a question, and nothing is lost by it.
    ///
    /// The session carries on — it was never this side's to end — and the
    /// question comes back out of what that session has already said, under the
    /// same name, so the card the window drew before any of this is still the
    /// card that answers it. That last part is the whole claim. A reading that
    /// came back numbered differently would be a window holding a card it can
    /// no longer press, which is the same thing as having lost the question.
    #[cfg(unix)]
    #[test]
    fn the_reading_can_be_thrown_away_and_taken_again() {
        let app = mock_app();
        let handle = app.handle().clone();
        let id = "rebuilt".to_string();

        answering(&handle, &id);
        let (tx, rx) = mpsc::channel();
        handle.listen(ASK_EVENT, move |event| {
            let _ = tx.send(event.payload().to_string());
        });

        pty::pty_open(
            handle.clone(),
            id.clone(),
            std::env::temp_dir().display().to_string(),
            24,
            80,
            None,
        )
        .expect("the shell starts");
        draw_box(&handle, &id);

        let Some(said) = wait_asked(&rx) else {
            pty::pty_close(handle.clone(), id.clone());
            panic!("the window was never told a question was being asked");
        };
        let before = said["ask"].clone();
        let seq = before["seq"].as_u64().expect("the question is named");

        rederive(&handle);

        let running = pty::running(&handle);
        assert!(
            running.iter().any(|session| session.id == id),
            "the session went with the reading of it"
        );

        let after = asking_now(&handle, &id).expect("the question came back");
        assert_eq!(after, before, "the question came back as a different one");

        // Answered with the number the window has been holding since before any
        // of this, which is the point.
        assert!(
            pty_answer(handle.clone(), id.clone(), seq, "1".to_string()).is_ok(),
            "a card drawn before the rebuild could no longer be answered"
        );

        pty::pty_close(handle.clone(), id.clone());
    }

    /// A window that has come up in front of shells it did not start.
    ///
    /// Nothing about the session is the window's to remember: what is running
    /// is only ever true where the processes are, and what the window wanted
    /// kept beside one comes back exactly as it was left.
    #[cfg(unix)]
    #[test]
    fn what_is_running_is_asked_for_rather_than_remembered() {
        let app = mock_app();
        let handle = app.handle().clone();
        let id = "found".to_string();
        let cwd = std::env::temp_dir().display().to_string();

        pty::pty_open(
            handle.clone(),
            id.clone(),
            cwd.clone(),
            24,
            80,
            Some("{\"branch\":\"main\"}".to_string()),
        )
        .expect("the shell starts");

        let running = pty::running(&handle);
        let found = running
            .iter()
            .find(|session| session.id == id)
            .expect("the session is running");
        assert_eq!(found.cwd, cwd);
        assert_eq!(found.meta.as_deref(), Some("{\"branch\":\"main\"}"));

        pty::pty_close(handle.clone(), id.clone());
    }
}
