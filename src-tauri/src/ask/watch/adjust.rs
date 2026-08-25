//! The three acts on a question that leave it standing: every one of them is a
//! keystroke somebody would otherwise have gone to the terminal to send.

use tauri::{AppHandle, Manager, Runtime};

use super::AskState;
use super::typing::{answer_at, said, standing, walking};
use crate::pty;

/// Walks the agent's own mark to one of the answers and leaves it there.
/// Nothing is said back — the agent redraws with its mark somewhere else, and
/// that reading comes through the ordinary way.
#[tauri::command]
pub fn pty_point<R: Runtime>(
    app: AppHandle<R>,
    id: String,
    seq: u64,
    key: String,
) -> Result<(), String> {
    let typed = {
        let state = app.state::<AskState>();
        let watching = state.lock();
        let asking = standing(&watching, &id, seq)?;
        let at = answer_at(asking, &key)?;
        walking(asking, at).ok_or("nowhere-to-walk")?
    };

    pty::pty_write(app, id, typed)
}

/// Walks to one of the answers and presses the space that picks it up, for the
/// lists that take several. The question is not over: answers go on being
/// picked up and put down until the return that `pty_take` sends.
#[tauri::command]
pub fn pty_pick<R: Runtime>(
    app: AppHandle<R>,
    id: String,
    seq: u64,
    key: String,
) -> Result<(), String> {
    let typed = {
        let state = app.state::<AskState>();
        let watching = state.lock();
        let asking = standing(&watching, &id, seq)?;
        if !asking.picking {
            return Err("asking-for-one".to_string());
        }
        let at = answer_at(asking, &key)?;
        format!("{} ", walking(asking, at).ok_or("nowhere-to-walk")?)
    };

    pty::pty_write(app, id, typed)
}

/// Writes at the answer the mark is standing in, without ending the question:
/// the "and tell it what to do instead" every agent offers. No return goes with
/// it, because the return is the answer and the answer is a separate press.
#[tauri::command]
pub fn pty_compose<R: Runtime>(
    app: AppHandle<R>,
    id: String,
    seq: u64,
    text: String,
) -> Result<(), String> {
    {
        let state = app.state::<AskState>();
        let watching = state.lock();
        let asking = standing(&watching, &id, seq)?;
        if !asking.writing {
            return Err("nowhere-to-write".to_string());
        }
    }

    pty::pty_write(app, id, said(&text))
}
