//! Application preferences in the user's home, shared by the form and file editor.
use serde_json::Value;
use std::{path::PathBuf, sync::Mutex};
use totex_host::app_settings::{self, Document};
static WRITES: Mutex<()> = Mutex::new(());
fn path() -> Result<PathBuf, String> {
    dirs::home_dir()
        .map(|home| home.join(".totex").join("totex.json"))
        .ok_or("Home directory is unavailable".into())
}
#[tauri::command(async)]
pub fn app_settings_read(initial: Value) -> Result<Document, String> {
    let _guard = WRITES.lock().map_err(|e| e.to_string())?;
    app_settings::read(&path()?, &initial)
}
#[tauri::command(async)]
pub fn app_settings_patch(patch: Value) -> Result<Document, String> {
    let _guard = WRITES.lock().map_err(|e| e.to_string())?;
    app_settings::patch(&path()?, &patch)
}
#[tauri::command(async)]
pub fn app_settings_write(text: String, expected: String) -> Result<Document, String> {
    let _guard = WRITES.lock().map_err(|e| e.to_string())?;
    app_settings::write(&path()?, &text, &expected)
}
