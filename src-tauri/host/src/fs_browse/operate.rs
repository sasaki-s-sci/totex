//! Explicit operations on what a path names: the ones a file row's context
//! menu offers, and the one a folder is asked for by being dropped on.

use std::path::{Path, PathBuf};

use super::copy::{copy_tree, sweep};
use super::path::resolve;
use crate::host::Host;

/// Reads a complete file for copying or downloading.
pub fn read_file(raw_path: &str) -> Result<Vec<u8>, String> {
    let (host, path) = resolve_file(raw_path)?;
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
    let (host, path) = resolve_file(raw_path)?;
    let parent = host.parent(&path).ok_or_else(|| "no-parent".to_string())?;
    let name = host.name(&path);
    let candidate = unused_name(&host, &parent, &name)?;
    host.copy_file(&path, &candidate)?;
    Ok(candidate.to_string_lossy().into_owned())
}

/// The first spelling of `name` that nothing in `parent` is already using.
///
/// The name itself where it is free, and the same name with a copy number after
/// it where it is not — so a file that lands beside one it is named after is
/// told from it by the way a copy is always told from an original here. Shared
/// with [`copy_into`] and [`super::download`], which are the other two things
/// that have to put something somewhere without replacing what is there.
pub(super) fn unused_name(host: &Host, parent: &Path, name: &str) -> Result<PathBuf, String> {
    let first = host.join(parent, name);
    if !host.exists(&first) {
        return Ok(first);
    }
    for number in 1..=10_000 {
        let candidate = host.join(parent, &copy_name(name, number));
        if !host.exists(&candidate) {
            return Ok(candidate);
        }
    }
    Err("no-copy-name".to_string())
}

/// Copies everything in `raw_sources` into `raw_into`, and answers with where
/// each of them landed.
///
/// What a drop on a folder is, and it is a copy every time: what was dropped
/// stays where it was, and nothing already in the folder is replaced — a file
/// landing beside one of its own name is told from it by the same `copy` name a
/// duplicate gets. Which machines the two ends are on is not the drop's
/// business; that is [`super::copy`]'s, and dragging something out of Explorer
/// onto a folder inside a distribution is the ordinary case it is there for.
///
/// One at a time, and it stops at the first that will not go. A drop is usually
/// one thing, and where it is several, a half-done copy standing in the folder
/// with an error beside it is worse than a short one: what did land is named in
/// the answer, and what did not is the error.
pub fn copy_into(raw_sources: &[String], raw_into: &str) -> Result<Vec<String>, String> {
    let (to, into) = resolve(raw_into)?;
    if !to.is_dir(&into) {
        return Err("no-such-folder".to_string());
    }
    let mut landed = Vec::with_capacity(raw_sources.len());
    for raw in raw_sources {
        landed.push(copy_one(raw, &to, &into)?);
    }
    Ok(landed)
}

/// One of them, into a folder that has already been settled.
fn copy_one(raw_source: &str, to: &Host, into: &Path) -> Result<String, String> {
    let (from, source) = resolve(raw_source)?;
    let stat = from
        .stat(&source)
        .ok_or_else(|| "no-such-file".to_string())?;
    let name = from.name(&source);
    if name.is_empty() {
        return Err("no-name".to_string());
    }
    // A folder cannot be dropped into itself, or into anything it holds: the
    // copy would be inside what is being copied, and the walk would keep finding
    // more of it to do.
    if stat.is_dir && &from == to && holds(to, &source, into) {
        return Err("into-itself".to_string());
    }
    let target = unused_name(to, into, &name)?;
    match copy_tree(&from, &source, &stat, to, &target) {
        Ok(()) => Ok(target.to_string_lossy().into_owned()),
        Err(error) => {
            sweep(to, &target);
            Err(error)
        }
    }
}

/// Whether `path` is `folder` itself or something under it, as the machine
/// holding both of them spells them.
fn holds(host: &Host, folder: &Path, path: &Path) -> bool {
    let separator = if host.is_remote() || !cfg!(windows) {
        '/'
    } else {
        '\\'
    };
    let folder = host.native(folder);
    let folder = folder.trim_end_matches(separator);
    let path = host.native(path);
    path == folder || path.starts_with(&format!("{folder}{separator}"))
}

/// Gives one file another name in the same directory.
pub fn rename_file(raw_path: &str, raw_name: &str) -> Result<String, String> {
    let name = valid_name(raw_name)?;
    let (host, path) = resolve_file(raw_path)?;
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

/// Removes exactly one file. Directories are refused here — see
/// [`delete_folder`], which is the name the other one is asked for by.
pub fn delete_file(raw_path: &str) -> Result<(), String> {
    let (host, path) = resolve_file(raw_path)?;
    host.remove_file(&path)
}

/// Removes one folder and everything under it. Files are refused here.
///
/// A name of its own rather than [`delete_file`] taught to take a directory,
/// and the two are apart for what is under the folder: a file is the whole of
/// what removing a file takes away, and a folder is a tree nobody can see the
/// end of from the row they right-clicked. So it is asked for deliberately,
/// answered deliberately, and the window says which of the two it is about to
/// ask for before it asks.
///
/// A link to a folder is a name and nothing else: the name goes, and the folder
/// on the far side of it stays where it was. A root has no parent, and emptying
/// a disk is not one of the things a row in a listing offers.
pub fn delete_folder(raw_path: &str) -> Result<(), String> {
    let (host, path) = resolve(raw_path)?;
    let stat = host
        .stat(&path)
        .ok_or_else(|| "no-such-folder".to_string())?;
    if !stat.is_dir {
        return Err("not-a-directory".to_string());
    }
    if host.parent(&path).is_none() {
        return Err("no-parent".to_string());
    }
    if stat.is_symlink {
        return host.remove_link(&path);
    }
    host.remove_dir_all(&path)
}

/// Resolves a file operation's path, preserving the same refusals for each verb.
fn resolve_file(raw: &str) -> Result<(Host, PathBuf), String> {
    let (host, path) = resolve(raw)?;
    let stat = host.stat(&path).ok_or_else(|| "no-such-file".to_string())?;
    if stat.is_dir {
        return Err("is-a-directory".to_string());
    }
    Ok((host, path))
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
