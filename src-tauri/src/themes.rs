//! User theme files under ~/.totex/themes, read whole for the window to judge.
use std::path::PathBuf;
use tauri_plugin_opener::OpenerExt;
use totex_host::themes::{self, ThemeFile};
fn dir() -> Result<PathBuf, String> {
    dirs::home_dir()
        .map(|home| home.join(".totex").join("themes"))
        .ok_or("Home directory is unavailable".into())
}
#[tauri::command(async)]
pub fn themes_read() -> Result<Vec<ThemeFile>, String> {
    themes::list(&dir()?)
}
// Opened from here: the window's opener permission covers web links only, and a path it
// could name would be any path.
#[tauri::command(async)]
pub fn themes_open(app: tauri::AppHandle) -> Result<String, String> {
    let path = themes::ensure(&dir()?)?;
    app.opener()
        .open_path(&path, None::<&str>)
        .map_err(|e| e.to_string())?;
    Ok(path)
}
