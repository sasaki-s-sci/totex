//! Explicit operations requested from a file row's context menu.

use super::path::resolve;

/// Reads a complete file for copying or downloading.
pub fn read_file(raw_path: &str) -> Result<Vec<u8>, String> {
    let (host, path) = resolve(raw_path)?;
    let stat = host.stat(&path).ok_or_else(|| "no-such-file".to_string())?;
    if stat.is_dir {
        return Err("is-a-directory".to_string());
    }
    host.read(&path)
}

/// Creates an empty file or directory directly inside `raw_parent`.
pub fn create_entry(raw_parent: &str, raw_name: &str, directory: bool) -> Result<String, String> {
    let name = valid_name(raw_name)?;
    let (host, parent) = resolve(raw_parent)?;
    if !host.is_dir(&parent) {
        return Err("no-such-folder".to_string());
    }
    let path = host.join(&parent, name);
    if host.exists(&path) {
        return Err("already-exists".to_string());
    }
    if directory {
        host.create_dir(&path)?;
    } else {
        host.create_file(&path)?;
    }
    Ok(path.to_string_lossy().into_owned())
}

/// Copies a file beside itself, choosing the first unused `copy` name.
pub fn duplicate_file(raw_path: &str) -> Result<String, String> {
    let (host, path) = resolve(raw_path)?;
    let stat = host.stat(&path).ok_or_else(|| "no-such-file".to_string())?;
    if stat.is_dir {
        return Err("is-a-directory".to_string());
    }
    let parent = host.parent(&path).ok_or_else(|| "no-parent".to_string())?;
    let name = host.name(&path);
    for number in 1..=10_000 {
        let candidate = host.join(&parent, &copy_name(&name, number));
        if !host.exists(&candidate) {
            host.copy_file(&path, &candidate)?;
            return Ok(candidate.to_string_lossy().into_owned());
        }
    }
    Err("no-copy-name".to_string())
}

/// Gives one file another name in the same directory.
pub fn rename_file(raw_path: &str, raw_name: &str) -> Result<String, String> {
    let name = valid_name(raw_name)?;
    let (host, path) = resolve(raw_path)?;
    let stat = host.stat(&path).ok_or_else(|| "no-such-file".to_string())?;
    if stat.is_dir {
        return Err("is-a-directory".to_string());
    }
    let parent = host.parent(&path).ok_or_else(|| "no-parent".to_string())?;
    let destination = host.join(&parent, name);
    if destination == path {
        return Ok(path.to_string_lossy().into_owned());
    }
    if host.exists(&destination) {
        return Err("already-exists".to_string());
    }
    host.rename(&path, &destination)?;
    Ok(destination.to_string_lossy().into_owned())
}

/// Removes exactly one file. Directories are deliberately refused here.
pub fn delete_file(raw_path: &str) -> Result<(), String> {
    let (host, path) = resolve(raw_path)?;
    let stat = host.stat(&path).ok_or_else(|| "no-such-file".to_string())?;
    if stat.is_dir {
        return Err("is-a-directory".to_string());
    }
    host.remove_file(&path)
}

fn valid_name(raw: &str) -> Result<&str, String> {
    let name = raw.trim();
    if name.is_empty()
        || matches!(name, "." | "..")
        || name.contains('/')
        || name.contains('\\')
        || name.contains('\0')
    {
        return Err("invalid-name".to_string());
    }
    Ok(name)
}

fn copy_name(name: &str, number: usize) -> String {
    let suffix = if number == 1 {
        " copy".to_string()
    } else {
        format!(" copy {number}")
    };
    match name.rsplit_once('.') {
        Some((stem, extension)) if !stem.is_empty() => format!("{stem}{suffix}.{extension}"),
        _ => format!("{name}{suffix}"),
    }
}
