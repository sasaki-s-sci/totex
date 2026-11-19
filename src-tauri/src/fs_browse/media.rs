use std::fs::{self, File};
use std::path::Path;

use tauri::scope::fs::Scope;

use super::path::resolve;
use crate::host::Host;

fn supported(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| {
            [
                "mp4", "m4v", "mov", "webm", "ogv", "mp3", "m4a", "aac", "ogg", "oga", "opus",
                "wav", "flac",
            ]
            .iter()
            .any(|kind| extension.eq_ignore_ascii_case(kind))
        })
}

/// Grant one canonical file, never its directory. Remote-only paths keep the bounded IPC reader.
pub fn media_file(raw_path: &str, scope: &Scope) -> Result<Option<String>, String> {
    let (host, path) = resolve(raw_path)?;
    if !supported(&path) {
        return Err("unsupported-media-type".into());
    }
    if matches!(host, Host::Ssh(_)) || (matches!(host, Host::Wsl(_)) && !cfg!(windows)) {
        return Ok(None);
    }
    let canonical = match fs::canonicalize(&path) {
        Ok(path) => path,
        Err(_) if host.is_remote() => return Ok(None),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Err("no-such-file".into());
        }
        Err(error) => return Err(error.to_string()),
    };
    let metadata = match fs::metadata(&canonical) {
        Ok(metadata) => metadata,
        Err(_) if host.is_remote() => return Ok(None),
        Err(error) => return Err(error.to_string()),
    };
    if metadata.is_dir() {
        return Err("is-a-directory".into());
    }
    if !metadata.is_file() {
        return Err("not-a-regular-file".into());
    }
    // A media-named symlink must not expose an HTML or other non-media target.
    if !supported(&canonical) {
        return Err("unsupported-media-type".into());
    }
    match File::open(&canonical) {
        Ok(_) => (),
        Err(_) if host.is_remote() => return Ok(None),
        Err(error) => return Err(error.to_string()),
    }
    let source = canonical
        .to_str()
        .ok_or_else(|| "invalid-media-path".to_string())?;
    scope
        .allow_file(&canonical)
        .map_err(|error| error.to_string())?;
    Ok(Some(source.to_string()))
}
