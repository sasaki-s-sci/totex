//! Reading a directory, and reading and writing a file.

use std::path::Path;

use super::model::{Entry, FileData, FileHead, Listing};
use super::path::resolve;
use super::{MAX_ENTRIES, MAX_FILE_DATA, MAX_FILE_HEAD};
use crate::host::Host;

/// Reads `raw_path` and returns its children, sorted directories first.
pub fn read_directory(raw_path: &str, show_hidden: bool) -> Result<Listing, String> {
    let (host, path) = resolve(raw_path)?;
    let children = host.read_dir(&path)?;

    let mut entries = Vec::new();
    let mut truncated = false;
    for child in children {
        let entry = describe(&host, &path, child);
        if !show_hidden && entry.is_hidden {
            continue;
        }
        if entries.len() == MAX_ENTRIES {
            truncated = true;
            break;
        }
        entries.push(entry);
    }
    sort_entries(&mut entries);

    Ok(Listing {
        name: host.name(&path),
        parent: host
            .parent(&path)
            .map(|parent| parent.to_string_lossy().into_owned()),
        distro: host.distro().map(str::to_string),
        path: path.to_string_lossy().into_owned(),
        entries,
        truncated,
    })
}

/// Reads the top of `raw_path`, for a card on the canvas. A directory is a
/// failure here rather than an empty file: the two are different things.
pub fn read_file_head(raw_path: &str) -> Result<FileHead, String> {
    let (host, path) = resolve(raw_path)?;
    let (bytes, size) = host.read_head(&path, MAX_FILE_HEAD)?;
    let truncated = size > bytes.len() as u64;

    Ok(FileHead {
        name: host.name(&path),
        path: path.to_string_lossy().into_owned(),
        text: as_text(&bytes, truncated),
        size,
        truncated,
    })
}

/// Reads the whole of `raw_path`, for a card drawing a picture of it.
///
/// The whole of it, and not the head a reading is given: half a picture is not
/// half drawn, it is not drawn at all. What comes back is base64 because the
/// answer crosses two boundaries as JSON — this layer's pipe and the window's
/// own — and a byte written as a number is four characters where this is one
/// and a third.
///
/// A file past [`MAX_FILE_DATA`] comes back with nothing in it rather than as a
/// failure: the card can then say how large the file is and that it is too
/// large to draw, which is more than it could say about an error.
pub fn read_file_data(raw_path: &str) -> Result<FileData, String> {
    let (host, path) = resolve(raw_path)?;
    let stat = host.stat(&path).ok_or_else(|| "no-such-file".to_string())?;
    if stat.is_dir {
        return Err("is-a-directory".to_string());
    }
    let data = if stat.size > MAX_FILE_DATA {
        None
    } else {
        Some(crate::base64::encode(&host.read(&path)?))
    };

    Ok(FileData {
        name: host.name(&path),
        path: path.to_string_lossy().into_owned(),
        data,
        size: stat.size,
    })
}

/// Writes a card's reading back to the file it came from.
///
/// Only a file the card holds whole may be written, so a reading that stopped at
/// [`MAX_FILE_HEAD`] cannot drop everything past it. `expect_size` is how long
/// the file was when read: a file that is no longer that long has been written
/// by something else since, and that write is the one that would be lost.
///
/// Written in place rather than replaced, so whatever it already is — a symlink,
/// a mode, an owner, a hard link — it stays.
pub fn write_file(raw_path: &str, text: &str, expect_size: u64) -> Result<u64, String> {
    let (host, path) = resolve(raw_path)?;
    let stat = host.stat(&path).ok_or_else(|| "no-such-file".to_string())?;
    if stat.is_dir {
        return Err("is-a-directory".to_string());
    }
    if stat.size > MAX_FILE_HEAD {
        return Err("too-long".to_string());
    }
    if stat.size != expect_size {
        return Err("changed".to_string());
    }

    host.write(&path, text, expect_size)
}

/// The bytes as text, or `None` when they are not text.
///
/// A NUL byte settles it before the decoding does: no text file holds one and
/// most compiled ones open with one. What is left is decided by whether it is
/// UTF-8, with the one allowance that a read stopped at a byte count can have
/// stopped mid-character — that character is dropped rather than sinking the
/// whole reading.
fn as_text(bytes: &[u8], truncated: bool) -> Option<String> {
    if bytes.contains(&0) {
        return None;
    }
    match std::str::from_utf8(bytes) {
        Ok(text) => Some(text.to_string()),
        // `error_len` is `None` for a sequence that simply ran out of bytes.
        Err(error) if truncated && error.error_len().is_none() => {
            std::str::from_utf8(&bytes[..error.valid_up_to()])
                .ok()
                .map(str::to_string)
        }
        Err(_) => None,
    }
}

/// One child of a directory, as a row of the pane.
fn describe(host: &Host, dir: &Path, child: crate::host::Child) -> Entry {
    let path = host.join(dir, &child.name);
    Entry {
        // Dot files are hidden on both sides: WSL trees are browsed from Windows
        // too, and only Windows marks a file hidden any other way.
        is_hidden: child.stat.hidden || child.name.starts_with('.'),
        size: (!child.stat.is_dir).then_some(child.stat.size),
        modified_ms: child.stat.modified_ms,
        name: child.name,
        path: path.to_string_lossy().into_owned(),
        is_dir: child.stat.is_dir,
        is_symlink: child.stat.is_symlink,
    }
}

/// Directories first, then by name. Keyed rather than compared: building the
/// lowercase form inside a comparator builds it again for every pair a sort
/// looks at, which at [`MAX_ENTRIES`] is thousands of allocations.
fn sort_entries(entries: &mut [Entry]) {
    entries
        .sort_by_cached_key(|entry| (!entry.is_dir, entry.name.to_lowercase(), entry.name.clone()));
}
