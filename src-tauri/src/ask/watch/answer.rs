//! The three acts that end a question, and put the card away as they go.
//!
//! `seq` is what makes that safe: an answer names the question it was given
//! for, and is refused outright if that is no longer the one being asked. The
//! card goes at the press rather than at the agent's next frame, because that
//! moment is exactly how long an answered question must not stand on the graph.

use tauri::{AppHandle, Emitter, Manager, Runtime};

use super::super::Taking;
use super::typing::{said, standing, typing};
use super::{ASK_EVENT, AskState, Asking};
use crate::pty;

/// Answers the question a session is asking, by typing what takes that answer.
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
        let asking = standing(&watching, &id, seq)?;
        let typed = typing(asking, &key).ok_or("no-answer")?;
        if let Some(watcher) = watching.get_mut(&id) {
            watcher.answered(seq);
        }
        typed
    };

    pty::pty_write(app.clone(), id.clone(), typed)?;
    told(&app, id);
    Ok(())
}

/// Answers a question that asked to be written at, by writing at it. A return
/// goes with the words, because a question waiting on a line is not looking at
/// it until there is one.
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
        if standing(&watching, &id, seq)?.taking != Taking::Words {
            return Err("asking-for-a-key".to_string());
        }
        if let Some(watcher) = watching.get_mut(&id) {
            watcher.answered(seq);
        }
    }

    pty::pty_write(app.clone(), id.clone(), format!("{}\r", said(&text)))?;
    told(&app, id);
    Ok(())
}

/// Ends the question where it stands, by sending the return that takes it. For
/// the two kinds a key does not answer: a list several answers are picked up
/// from, and a list whose mark stands in a row being written at.
#[tauri::command]
pub fn pty_take<R: Runtime>(app: AppHandle<R>, id: String, seq: u64) -> Result<(), String> {
    {
        let state = app.state::<AskState>();
        let mut watching = state.lock();
        standing(&watching, &id, seq)?;
        if let Some(watcher) = watching.get_mut(&id) {
            watcher.answered(seq);
        }
    }

    pty::pty_write(app.clone(), id.clone(), "\r".to_string())?;
    told(&app, id);
    Ok(())
}

/// Said outright rather than left to the next reading: whatever else the window
/// is drawing this session as, the question has been answered.
fn told<R: Runtime>(app: &AppHandle<R>, id: String) {
    let _ = app.emit(ASK_EVENT, Asking { id, ask: None });
}
