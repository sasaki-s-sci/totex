use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use base64::{Engine, engine::general_purpose::STANDARD};
use serde::Deserialize;
use tauri::{
    Manager,
    ipc::{InvokeBody, Request},
};

use crate::{fs_browse, host::Host};

static SERIAL: AtomicU64 = AtomicU64::new(0);

fn stamp() -> String {
    format!(
        "{}-{}",
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis(),
        SERIAL.fetch_add(1, Ordering::Relaxed)
    )
}

#[derive(Deserialize)]
struct Paste {
    mime: String,
    into: Option<String>,
}

fn extension(mime: &str) -> Result<&'static str, String> {
    match mime {
        "image/png" => Ok("png"),
        "image/jpeg" => Ok("jpg"),
        "image/webp" => Ok("webp"),
        "image/gif" => Ok("gif"),
        "image/bmp" => Ok("bmp"),
        "image/avif" => Ok("avif"),
        "video/mp4" => Ok("mp4"),
        "video/webm" => Ok("webm"),
        "video/quicktime" => Ok("mov"),
        _ => Err("unsupported-media".into()),
    }
}

/// Raw bytes avoid expanding recordings into JSON arrays across IPC.
#[tauri::command(async)]
pub fn paste_media(app: tauri::AppHandle, request: Request<'_>) -> Result<String, String> {
    let options = request
        .headers()
        .get("x-totex-paste")
        .ok_or("missing-paste-options")?;
    let decoded = STANDARD
        .decode(options.as_bytes())
        .map_err(|error| error.to_string())?;
    let options: Paste = serde_json::from_slice(&decoded).map_err(|error| error.to_string())?;
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("expected-media-bytes".into());
    };
    if bytes.is_empty() || bytes.len() > 256 * 1024 * 1024 {
        return Err("media-size-limit".into());
    }
    let suffix = extension(&options.mime)?;
    let folder = match options.into {
        Some(into) => fs_browse::resolve_folder(&into)?.path,
        None => {
            let folder = app
                .path()
                .app_cache_dir()
                .map_err(|error| error.to_string())?
                .join("pasted");
            std::fs::create_dir_all(&folder).map_err(|error| error.to_string())?;
            folder.to_string_lossy().into_owned()
        }
    };
    let host = Host::of_str(&folder);
    let path = host.join(
        Path::new(&folder),
        &format!("pasted-{}.{}", stamp(), suffix),
    );
    host.write_new(&path, bytes)?;
    Ok(path.to_string_lossy().into_owned())
}

/// Paths use the terminal's filesystem spelling, including WSL and SSH.
#[tauri::command(async)]
pub fn terminal_paths(paths: Vec<String>, cwd: String) -> Result<Vec<String>, String> {
    let to = Host::of_str(&cwd);
    let mut result = Vec::with_capacity(paths.len());
    let mut staging = None;
    for raw in paths {
        if raw.chars().any(char::is_control) {
            return Err("invalid-path".into());
        }
        let source = Path::new(&raw);
        let from = Host::of(source);
        if from == to {
            result.push(to.native(source));
            continue;
        }
        if cfg!(windows) && to == Host::Local && matches!(from, Host::Wsl(_)) {
            result.push(raw);
            continue;
        }
        if let Host::Wsl(distro) = &to
            && from == Host::Local
            && cfg!(windows)
        {
            let output = crate::wsl::exec(distro, None, &[], &["wslpath", "-u", &raw])?;
            if !output.ok() {
                return Err("path-conversion-failed".into());
            }
            result.push(output.text().trim().into());
            continue;
        }
        let folder = match &staging {
            Some(folder) => folder,
            None => {
                let folder = to.join(&to.temp_dir(), &format!("totex-paste-{}", stamp()));
                to.create_dir(&folder)?;
                staging.insert(folder)
            }
        };
        let copied = fs_browse::copy_into(&[raw], &folder.to_string_lossy())?;
        result.extend(copied.iter().map(|path| to.native(Path::new(path))));
    }
    Ok(result)
}

/// Snipping Tool recordings and Explorer copies can be file-list clipboard items.
#[tauri::command]
pub fn clipboard_files() -> Result<Vec<String>, String> {
    #[cfg(windows)]
    unsafe {
        use windows_sys::Win32::{
            System::DataExchange::{CloseClipboard, GetClipboardData, OpenClipboard},
            UI::Shell::DragQueryFileW,
        };
        if OpenClipboard(std::ptr::null_mut()) == 0 {
            return Err(std::io::Error::last_os_error().to_string());
        }
        let files = GetClipboardData(15); // CF_HDROP
        let mut paths = Vec::new();
        if !files.is_null() {
            let count = DragQueryFileW(files, u32::MAX, std::ptr::null_mut(), 0);
            for index in 0..count {
                let length = DragQueryFileW(files, index, std::ptr::null_mut(), 0);
                let mut buffer = vec![0; length as usize + 1];
                let read = DragQueryFileW(files, index, buffer.as_mut_ptr(), length + 1);
                paths.push(String::from_utf16_lossy(&buffer[..read as usize]));
            }
        }
        CloseClipboard();
        Ok(paths)
    }
    #[cfg(not(windows))]
    Ok(Vec::new())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn media_types_only_choose_known_extensions() {
        assert_eq!(extension("image/png").unwrap(), "png");
        assert_eq!(extension("video/mp4").unwrap(), "mp4");
        assert!(extension("../../script.exe").is_err());
        assert_ne!(stamp(), stamp());
    }

    #[test]
    fn terminal_paths_keep_local_names_and_reject_control_bytes() {
        assert_eq!(
            terminal_paths(vec!["/tmp/a b.png".into()], "/tmp".into()).unwrap(),
            ["/tmp/a b.png"]
        );
        assert!(terminal_paths(vec!["/tmp/a\ncommand".into()], "/tmp".into()).is_err());
    }
}
