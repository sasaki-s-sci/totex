//! The sessions, as this window reaches them.
//!
//! A shell is a process with a history nobody else has a copy of, and this
//! window is the half of the app that is replaced — so the shells are not here.
//! They are held by the program beside this one, see `keep`, and everything
//! below is one question to it. What the sessions are and do is the program's
//! to say: the shapes here are the program's own, linked rather than copied.

use serde_json::json;
use tauri::{AppHandle, Runtime};

pub use totex_keep::session::{Event, Held, Running, Said, shell};

/// Carries a run of a session's output to the pages.
pub const DATA_EVENT: &str = "pty:data";
/// Carries the session that has ended, so the pages can say so.
pub const EXIT_EVENT: &str = "pty:exit";

/// Starts a shell in `cwd` under the name `id`, and leaves it running.
#[tauri::command(async)]
pub fn pty_open<R: Runtime>(
    app: AppHandle<R>,
    id: String,
    cwd: String,
    rows: u16,
    cols: u16,
    meta: Option<String>,
) -> Result<(), String> {
    let link = crate::keep::link(&app);
    link.ask(
        "open",
        json!({ "id": id, "cwd": cwd, "rows": rows, "cols": cols, "meta": meta }),
    )?;
    // Known from here, so that the program going away reads as this session
    // ending even to a window that was never told it opened.
    link.know(&id);
    Ok(())
}

/// Every session that is still running — what a window asks for when it comes
/// up in front of shells it does not know about.
#[tauri::command(async)]
pub fn pty_sessions<R: Runtime>(app: AppHandle<R>) -> Vec<Running> {
    running(&app)
}

/// The same thing, for the rest of this side of the app.
pub fn running<R: Runtime>(app: &AppHandle<R>) -> Vec<Running> {
    let link = crate::keep::link(app);
    let found: Vec<Running> = link.asked("sessions", json!({})).unwrap_or_default();
    for session in &found {
        link.know(&session.id);
    }
    found
}

/// Everything a session has said that is still kept, for a terminal just built
/// for it. `None` when there is no such session.
#[tauri::command(async)]
pub fn pty_attach<R: Runtime>(app: AppHandle<R>, id: String) -> Option<Held> {
    crate::keep::link(&app)
        .asked("attach", json!({ "id": id }))
        .unwrap_or(None)
}

/// Sends what was typed. Keystrokes, not lines: the shell does the editing.
#[tauri::command(async)]
pub fn pty_write<R: Runtime>(app: AppHandle<R>, id: String, data: String) -> Result<(), String> {
    crate::keep::link(&app)
        .ask("write", json!({ "id": id, "data": data }))
        .map(|_| ())
}

/// Tells the shell how much room it has, so that anything full-screen draws to
/// the right size.
#[tauri::command(async)]
pub fn pty_resize<R: Runtime>(
    app: AppHandle<R>,
    id: String,
    rows: u16,
    cols: u16,
) -> Result<(), String> {
    crate::keep::link(&app)
        .ask("resize", json!({ "id": id, "rows": rows, "cols": cols }))
        .map(|_| ())
}

/// Ends a session.
#[tauri::command(async)]
pub fn pty_close<R: Runtime>(app: AppHandle<R>, id: String) {
    let _ = crate::keep::link(&app).ask("close", json!({ "id": id }));
}
