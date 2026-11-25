//! The door an agent reports through, as this window reaches it.
//!
//! What an agent says it is doing arrives through a door of its own rather
//! than out of anything a session drew, and a report is a thing that was said
//! once — so the door and what came through it are held by the program beside
//! this one, see `persistent`, and everything below is one question to it.

use serde_json::json;
use tauri::{AppHandle, Runtime};

mod probe;
mod register;
mod setup;

pub fn register_codex(args: &[String]) -> Result<(), String> {
    register::run(args)
}

pub use totex_persistent::door::Reported;

/// Carries what a session says it is doing, and its going away again. Sent
/// whether or not a terminal is being drawn for it: the panel is only one of the
/// places what is happening in there can be seen.
pub const REPORT_EVENT: &str = "mcp:report";

/// The port the server is on, or nothing when it is not standing.
#[tauri::command(async)]
pub fn mcp_serving<R: Runtime>(app: AppHandle<R>) -> Option<u16> {
    crate::persistent::link(&app)
        .asked("door_serving", json!({}))
        .unwrap_or(None)
}

/// Prepare the selected terminal's registration command without registering an agent.
#[tauri::command]
pub async fn mcp_setup<R: Runtime>(
    app: AppHandle<R>,
    cwd: Option<String>,
) -> Result<Option<setup::Prepared>, String> {
    let port = crate::persistent::link(&app).asked("door_serve", json!({}))?;
    probe::ready(&totex_persistent::door::connection::url()?).await?;
    setup::prepare(cwd.as_deref().unwrap_or(""), port).map(Some)
}

/// Stands it up, and says which port it took.
#[tauri::command(async)]
pub fn mcp_serve<R: Runtime>(app: AppHandle<R>) -> Result<u16, String> {
    crate::persistent::link(&app).asked("door_serve", json!({}))
}

/// Takes it down.
#[tauri::command(async)]
pub fn mcp_stop<R: Runtime>(app: AppHandle<R>) {
    let _ = crate::persistent::link(&app).ask("door_stop", json!({}));
}

/// Everything being worked on right now.
#[tauri::command(async)]
pub fn mcp_reports<R: Runtime>(app: AppHandle<R>) -> Vec<Reported> {
    crate::persistent::link(&app)
        .asked("door_reports", json!({}))
        .unwrap_or_default()
}

#[tauri::command(async)]
pub fn canvas_open<R: Runtime>(
    app: AppHandle<R>,
    id: String,
    cwd: String,
) -> Result<totex_persistent::door::canvas::Canvas, String> {
    crate::persistent::link(&app).asked("canvas_open", json!({ "id": id, "cwd": cwd }))
}

#[tauri::command(async)]
pub fn canvas_close<R: Runtime>(app: AppHandle<R>, id: String) -> Result<(), String> {
    crate::persistent::link(&app).asked("canvas_close", json!({ "id": id }))
}

#[tauri::command(async)]
pub fn canvas_read<R: Runtime>(
    app: AppHandle<R>,
) -> Result<Vec<totex_persistent::door::canvas::Canvas>, String> {
    crate::persistent::link(&app).asked("canvas_read", json!({}))
}

#[tauri::command(async)]
pub fn canvas_write<R: Runtime>(
    app: AppHandle<R>,
    id: String,
    panes: Vec<totex_persistent::door::canvas::Pane>,
    revision: u64,
) -> Result<totex_persistent::door::canvas::Canvas, String> {
    crate::persistent::link(&app).asked(
        "canvas_write",
        json!({ "id": id, "panes": panes, "revision": revision }),
    )
}
