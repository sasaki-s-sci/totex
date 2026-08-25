//! Everything asked of a session once it is running.

use tauri::{AppHandle, Manager, Runtime};

use std::io::Write;

use portable_pty::PtySize;

use super::model::{Held, Running};
use super::{Event, PtyState};

/// Every session that is still running — what a window asks for when it comes up
/// in front of shells it does not know about. A session is a process, so this is
/// the only place the truth about which of them exist has ever been.
#[tauri::command]
pub fn pty_sessions<R: Runtime>(app: AppHandle<R>) -> Vec<Running> {
    running(&app)
}

/// The same thing, for the rest of this side of the app.
pub fn running<R: Runtime>(app: &AppHandle<R>) -> Vec<Running> {
    let state = app.state::<PtyState>();
    let sessions = state.lock();
    sessions
        .iter()
        .map(|(id, session)| Running {
            id: id.clone(),
            cwd: session.cwd.clone(),
            rows: session.rows,
            cols: session.cols,
            meta: session.meta.clone(),
        })
        .collect()
}

/// Everything a session has said that is still kept, for a terminal just built
/// for it. `None` when there is no such session.
///
/// Read alongside the event: a terminal registers for the live output first and
/// asks for this second, so a run that lands between the two arrives twice
/// rather than not at all — and `upto` is how the terminal tells which.
#[tauri::command]
pub fn pty_attach<R: Runtime>(app: AppHandle<R>, id: String) -> Option<Held> {
    let state = app.state::<PtyState>();
    let sessions = state.lock();
    let session = sessions.get(&id)?;
    let said = crate::sync::lock(&session.said);
    Some(Held {
        text: said.text.clone(),
        upto: said.said,
    })
}

/// Sends what was typed. Keystrokes, not lines: the shell does the editing.
#[tauri::command]
pub fn pty_write<R: Runtime>(app: AppHandle<R>, id: String, data: String) -> Result<(), String> {
    let state = app.state::<PtyState>();
    let mut sessions = state.lock();
    let session = sessions.get_mut(&id).ok_or("no-session")?;
    session
        .writer
        .write_all(data.as_bytes())
        .map_err(|error| error.to_string())?;
    session.writer.flush().map_err(|error| error.to_string())
}

/// Tells the shell how much room it has, so that anything full-screen draws to
/// the right size. The screen a question is read off is the shell's own, so the
/// followers are told too.
#[tauri::command]
pub fn pty_resize<R: Runtime>(
    app: AppHandle<R>,
    id: String,
    rows: u16,
    cols: u16,
) -> Result<(), String> {
    let rows = rows.max(1);
    let cols = cols.max(1);
    let state = app.state::<PtyState>();

    {
        let mut sessions = state.lock();
        let Some(session) = sessions.get_mut(&id) else {
            // A resize arriving after the shell exited is not worth an error.
            return Ok(());
        };
        session
            .master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|error| error.to_string())?;
        session.rows = rows;
        session.cols = cols;
    }

    state.tell(&id, Event::Resized { rows, cols });
    Ok(())
}

/// Ends a session. The reader thread stops on its own once the pty is dropped,
/// and it is that thread — not this — which says the session has gone.
#[tauri::command]
pub fn pty_close<R: Runtime>(app: AppHandle<R>, id: String) {
    if let Some(mut session) = app.state::<PtyState>().lock().remove(&id) {
        let _ = session.child.kill();
        let _ = session.child.wait();
    }
}
