//! The three acts that end a question, and put the card away as they go.
//!
//! `seq` is what makes that safe: an answer names the question it was given
//! for, and is refused outright if that is no longer the one being asked. The
//! card goes at the press rather than at the agent's next frame, because that
//! moment is exactly how long an answered question must not stand on the graph.
//!
//! Which leaves one thing to be careful about, and it is what `look_again` is
//! for: a card taken away at the press comes back only when the agent draws
//! again, so a press the agent does nothing about would take a question off the
//! graph and leave it standing at the terminal, where nobody can see it.

use std::thread;
use std::time::Duration;

use tauri::{AppHandle, Manager, Runtime};

use super::super::Taking;
use super::typing::{said, typing};
use super::{AskState, pressed, say};
use crate::pty;

/// How long a press is given to be worth something before the screen it landed
/// on is read again. Long enough that an agent taking an answer has redrawn
/// without it — a tenth of that is the usual — and short enough that a press
/// which did nothing has not yet been given up on.
const GRACE: Duration = Duration::from_millis(600);

/// Answers the question a session is asking, by typing what takes that answer.
#[tauri::command]
pub fn pty_answer<R: Runtime>(
    app: AppHandle<R>,
    id: String,
    seq: u64,
    key: String,
) -> Result<(), String> {
    let (asking, drawn) = pressed(&app, &id, seq)?;
    let typed = typing(&asking, &key).ok_or("no-answer")?;

    taken(&app, &id, seq);
    pty::pty_write(app.clone(), id.clone(), typed)?;
    told(&app, id.clone());
    look_again(&app, id, drawn);
    Ok(())
}

/// Answers a question by writing at it, which two of the four shapes are: one
/// that is nothing but a line to type at, and one whose mark is standing in a
/// row to type in — the "and tell it what to do instead" every agent offers.
///
/// Both are answered the same way, and in one act: the words, and the return
/// that ends the question. One act because a question is one turn — words
/// written at a session and left there are an answer half given, and the return
/// that would finish it is a second press against a question the words have
/// already changed the look of.
#[tauri::command]
pub fn pty_reply<R: Runtime>(
    app: AppHandle<R>,
    id: String,
    seq: u64,
    text: String,
) -> Result<(), String> {
    let (asking, drawn) = pressed(&app, &id, seq)?;
    if asking.taking != Taking::Words && !asking.writing {
        return Err("nowhere-to-write".to_string());
    }

    taken(&app, &id, seq);
    pty::pty_write(app.clone(), id.clone(), format!("{}\r", said(&text)))?;
    told(&app, id.clone());
    look_again(&app, id, drawn);
    Ok(())
}

/// Ends the question where it stands, by sending the return that takes it. For
/// the kind a key does not answer: a list several answers are picked up from.
#[tauri::command]
pub fn pty_take<R: Runtime>(app: AppHandle<R>, id: String, seq: u64) -> Result<(), String> {
    let (_, drawn) = pressed(&app, &id, seq)?;

    taken(&app, &id, seq);
    pty::pty_write(app.clone(), id.clone(), "\r".to_string())?;
    told(&app, id.clone());
    look_again(&app, id, drawn);
    Ok(())
}

/// Puts the question away on this side, so that a reading arriving between the
/// press and the agent's next frame is not the question that was just answered.
fn taken<R: Runtime>(app: &AppHandle<R>, id: &str, seq: u64) {
    let state = app.state::<AskState>();
    let mut watching = state.lock();
    if let Some(watcher) = watching.get_mut(id) {
        watcher.answered(seq);
    }
}

/// Said outright rather than left to the next reading: whatever else the window
/// is drawing this session as, the question has been answered.
fn told<R: Runtime>(app: &AppHandle<R>, id: String) {
    say(app, id, None);
}

/// Puts a question back on the graph if the press did nothing at all.
///
/// What brings a card back is the agent drawing again, and an agent that did not
/// take the press draws nothing: a key it does not read, a row it will not be
/// answered from, an answer it wants a return after. The question then goes on
/// standing at the terminal with no card anywhere, and a question nobody can see
/// is a turn nobody can take.
///
/// So a press the session has said nothing at all about is looked at again: the
/// screen is read as it stands, and if the same question is still drawn there
/// the window is told it. Anything the session did draw in the meantime is the
/// agent answering, however it answered, and is left to the ordinary reading.
fn look_again<R: Runtime>(app: &AppHandle<R>, id: String, drawn: usize) {
    let app = app.clone();
    thread::spawn(move || {
        thread::sleep(GRACE);
        let told = {
            let state = app.state::<AskState>();
            let mut watching = state.lock();
            match watching.get_mut(&id) {
                // Drawn since: the agent had something to say about the press.
                Some(watcher) if watcher.drawn() == drawn => watcher.again(),
                _ => None,
            }
        };
        if let Some(standing) = told {
            say(&app, id, standing);
        }
    });
}
