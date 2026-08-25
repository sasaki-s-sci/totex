//! Reading what `find` printed, and what this machine's own filesystem says.

use std::path::Path;
use std::time::UNIX_EPOCH;

use super::{Child, Stat};

/// `%y \t %Y \t %s \t %T@` — the four fields every one of the scripts prints.
pub(super) fn parse_stat(fields: &str) -> Option<Stat> {
    let mut parts = fields.split('\t');
    let kind = parts.next()?;
    let target = parts.next()?;
    let size = parts.next()?.trim().parse().unwrap_or(0);
    let modified_ms = parts.next().and_then(epoch_ms);
    Some(Stat {
        is_dir: target == "d",
        is_symlink: kind == "l",
        // Nothing in a Linux filesystem marks a file hidden.
        hidden: false,
        size,
        modified_ms,
    })
}

/// `find`'s `%T@`: seconds since the epoch, with a fraction.
fn epoch_ms(value: &str) -> Option<u64> {
    let seconds: f64 = value.trim().parse().ok()?;
    if seconds < 0.0 {
        return None;
    }
    Some((seconds * 1_000.0) as u64)
}

/// The records of a listing: each one a stat and the full path it is of, which
/// is what says which of the directories asked about it belongs to.
pub(super) fn parse_children(stdout: &[u8]) -> Vec<(String, Child)> {
    let mut found = Vec::new();
    for record in stdout.split(|byte| *byte == 0) {
        if record.is_empty() {
            continue;
        }
        let text = String::from_utf8_lossy(record);
        // The path is last because it is the one field allowed to hold a tab.
        let mut fields = text.splitn(5, '\t');
        let head: Vec<&str> = (&mut fields).take(4).collect();
        let (Some(path), 4) = (fields.next(), head.len()) else {
            continue;
        };
        let Some(stat) = parse_stat(&head.join("\t")) else {
            continue;
        };
        let (parent, name) = match path.rfind('/') {
            Some(0) => ("/".to_string(), path[1..].to_string()),
            Some(cut) => (path[..cut].to_string(), path[cut + 1..].to_string()),
            None => continue,
        };
        found.push((parent, Child { name, stat }));
    }
    found
}

pub(super) fn local_stat(path: &Path) -> Option<Stat> {
    let link = std::fs::symlink_metadata(path).ok();
    let metadata = std::fs::metadata(path).ok().or_else(|| link.clone())?;
    Some(Stat {
        is_dir: metadata.is_dir(),
        is_symlink: link.map(|link| link.is_symlink()).unwrap_or(false),
        hidden: marked_hidden(&metadata),
        size: metadata.len(),
        modified_ms: metadata
            .modified()
            .ok()
            .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
            .map(|since| since.as_millis() as u64),
    })
}

/// Whether the filesystem itself calls this file hidden, which only Windows has
/// an answer to.
fn marked_hidden(metadata: &std::fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        const FILE_ATTRIBUTE_HIDDEN: u32 = 0x0000_0002;
        const FILE_ATTRIBUTE_SYSTEM: u32 = 0x0000_0004;
        metadata.file_attributes() & (FILE_ATTRIBUTE_HIDDEN | FILE_ATTRIBUTE_SYSTEM) != 0
    }
    #[cfg(not(windows))]
    {
        let _ = metadata;
        false
    }
}

pub(super) fn local_child(entry: &std::fs::DirEntry) -> Option<Child> {
    let file_type = entry.file_type().ok()?;
    let is_symlink = file_type.is_symlink();
    // `DirEntry::file_type` never follows a link, so a link to a directory needs
    // the target's own metadata to be shown as one.
    let is_dir = if is_symlink {
        std::fs::metadata(entry.path())
            .map(|meta| meta.is_dir())
            .unwrap_or(false)
    } else {
        file_type.is_dir()
    };
    let metadata = entry.metadata().ok();
    Some(Child {
        name: entry.file_name().to_string_lossy().into_owned(),
        stat: Stat {
            is_dir,
            is_symlink,
            hidden: metadata.as_ref().is_some_and(marked_hidden),
            size: metadata.as_ref().map(|meta| meta.len()).unwrap_or(0),
            modified_ms: metadata
                .as_ref()
                .and_then(|meta| meta.modified().ok())
                .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
                .map(|since| since.as_millis() as u64),
        },
    })
}
