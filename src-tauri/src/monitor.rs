//! The Monitor service lives beside terminal sessions in the persistent runtime.

use serde_json::{Value, json};
use tauri::{AppHandle, Runtime};

#[tauri::command(async)]
pub fn monitor_configure<R: Runtime>(app: AppHandle<R>, config: Value) -> Result<(), String> {
    crate::persistent::link(&app)
        .ask("monitor_configure", json!({ "config": config }))
        .map(|_| ())
}

#[tauri::command(async)]
pub fn monitor_snapshots<R: Runtime>(app: AppHandle<R>) -> Result<Value, String> {
    crate::persistent::link(&app).asked("monitor_snapshots", json!({}))
}

/// The models an agent offers, from the first host that can list them.
#[tauri::command(async)]
pub fn monitor_models<R: Runtime>(
    app: AppHandle<R>,
    agent: String,
    command: String,
    args: Vec<String>,
) -> Result<Value, String> {
    crate::persistent::link(&app).asked(
        "monitor_models",
        json!({ "agent": agent, "command": command, "args": args }),
    )
}

/// Which sessions are running a coding agent, as the screen reading has them.
#[tauri::command(async)]
pub fn monitor_agents<R: Runtime>(app: AppHandle<R>, ids: Vec<String>) -> Result<(), String> {
    crate::persistent::link(&app)
        .ask("monitor_agents", json!({ "ids": ids }))
        .map(|_| ())
}

#[tauri::command(async)]
pub fn monitor_refresh<R: Runtime>(app: AppHandle<R>, id: String) -> Result<(), String> {
    crate::persistent::link(&app)
        .ask("monitor_refresh", json!({ "id": id }))
        .map(|_| ())
}
