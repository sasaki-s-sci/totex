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

#[tauri::command(async)]
pub fn monitor_refresh<R: Runtime>(app: AppHandle<R>, id: String) -> Result<(), String> {
    crate::persistent::link(&app)
        .ask("monitor_refresh", json!({ "id": id }))
        .map(|_| ())
}
