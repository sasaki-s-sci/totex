//! The sessions, as this window reaches them.
//!
//! A shell is a process with a history nobody else has a copy of, and this
//! window is the half of the app that is replaced — so the shells are not here.
//! They are held by the persistent half, see `persistent`, and everything
//! below is one question to it. What the sessions are and do is the program's
//! to say: the shapes here are the program's own, linked rather than copied.

use serde::Serialize;
use serde_json::json;
use tauri::{AppHandle, Runtime};

pub use totex_persistent::session::{Event, Held, Running, Said, shell};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Attached {
    #[serde(flatten)]
    pub held: Held,
    #[serde(skip_serializing_if = "Option::is_none")]
    windows_pty: Option<WindowsPty>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WindowsPty {
    backend: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    build_number: Option<u32>,
}

fn windows_pty() -> Option<WindowsPty> {
    #[cfg(windows)]
    {
        use windows_sys::Wdk::System::SystemServices::RtlGetVersion;
        use windows_sys::Win32::System::SystemInformation::OSVERSIONINFOW;

        let mut version = OSVERSIONINFOW {
            dwOSVersionInfoSize: std::mem::size_of::<OSVERSIONINFOW>() as u32,
            ..Default::default()
        };
        // The PTY is local ConPTY even when its child runs WSL or SSH.
        let build_number =
            (unsafe { RtlGetVersion(&mut version) } >= 0).then_some(version.dwBuildNumber);
        Some(WindowsPty {
            backend: "conpty",
            build_number,
        })
    }
    #[cfg(not(windows))]
    None
}

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
    let link = crate::persistent::link(&app);
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
pub fn pty_sessions<R: Runtime>(app: AppHandle<R>) -> Result<Vec<Running>, String> {
    let link = crate::persistent::link(&app);
    let found: Vec<Running> = link.asked("sessions", json!({}))?;
    for session in &found {
        link.know(&session.id);
    }
    Ok(found)
}

/// The same thing, for read-only status displays on this side of the app.
pub fn running<R: Runtime>(app: &AppHandle<R>) -> Vec<Running> {
    pty_sessions(app.clone()).unwrap_or_default()
}

/// Everything a session has said that is still kept, for a terminal just built
/// for it. `None` when there is no such session.
#[tauri::command(async)]
pub fn pty_attach<R: Runtime>(app: AppHandle<R>, id: String) -> Result<Option<Attached>, String> {
    let held: Option<Held> = crate::persistent::link(&app).asked("attach", json!({ "id": id }))?;
    Ok(held.map(|held| Attached {
        held,
        windows_pty: windows_pty(),
    }))
}

/// Sends what was typed. Keystrokes, not lines: the shell does the editing.
#[tauri::command(async)]
pub fn pty_write<R: Runtime>(app: AppHandle<R>, id: String, data: String) -> Result<(), String> {
    crate::ask::watch::keyed(&app, &id, &data);
    crate::persistent::link(&app)
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
    crate::persistent::link(&app)
        .ask("resize", json!({ "id": id, "rows": rows, "cols": cols }))
        .map(|_| ())
}

/// Ends a session.
#[tauri::command(async)]
pub fn pty_close<R: Runtime>(app: AppHandle<R>, id: String) -> Result<(), String> {
    crate::persistent::link(&app)
        .ask("close", json!({ "id": id }))
        .map(|_| ())
}
