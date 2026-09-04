//! The door an agent reports through, as this window reaches it.
//!
//! What an agent says it is doing arrives through a door of its own rather
//! than out of anything a session drew, and a report is a thing that was said
//! once — so the door and what came through it are held by the program beside
//! this one, see `persistent`, and everything below is one question to it.

use serde_json::json;
use tauri::{AppHandle, Runtime};

pub use totex_persistent::door::{Agent, Reported, Setup};

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

/// What each agent would be set up with, in the words somebody could have typed
/// themselves.
#[tauri::command(async)]
pub fn mcp_setups<R: Runtime>(app: AppHandle<R>) -> Vec<Setup> {
    crate::persistent::link(&app)
        .asked("door_setups", json!({}))
        .unwrap_or_default()
}

/// Registers this server with one coding agent on this machine, once and for
/// all its sessions.
#[tauri::command(async)]
pub fn mcp_install<R: Runtime>(app: AppHandle<R>, agent: Agent) -> Result<String, String> {
    crate::persistent::link(&app).asked("door_install", json!({ "agent": agent }))
}
