//! Turning what somebody typed into a settled path on a named machine.

use std::ffi::OsStr;
use std::path::{Component, Path, PathBuf};

use super::model::Place;
use crate::host::Host;
use crate::wsl;

/// The user's home directory, read from the environment so that no platform
/// specific crate is needed.
pub fn home_dir() -> Option<PathBuf> {
    let raw = if cfg!(windows) {
        std::env::var_os("USERPROFILE")
    } else {
        std::env::var_os("HOME")
    }?;
    if raw.is_empty() {
        return None;
    }
    Some(PathBuf::from(raw))
}

/// Expands a leading `~` so the path bar accepts what a shell would accept.
pub(super) fn expand_user_path(input: &str) -> PathBuf {
    let trimmed = input.trim();
    let Some(home) = home_dir() else {
        return PathBuf::from(trimmed);
    };
    if trimmed == "~" {
        return home;
    }
    for prefix in ["~/", "~\\"] {
        if let Some(rest) = trimmed.strip_prefix(prefix) {
            return home.join(rest);
        }
    }
    PathBuf::from(trimmed)
}

/// What follows a leading `~` in a path inside a distribution, or `None` when
/// the path does not begin with one. `~` alone answers with nothing after it.
///
/// Its own rule rather than a `starts_with`, because a directory whose name
/// merely begins with a tilde is a directory: only `~` on its own, or `~` and a
/// separator, is the home somebody meant.
pub(super) fn home_tail(path: &str) -> Option<&str> {
    let rest = path.strip_prefix("/~")?;
    (rest.is_empty() || rest.starts_with('/')).then_some(rest)
}

/// Expands a leading `~` in a path inside a distribution, by asking the
/// distribution where home is.
///
/// Asked of it rather than worked out here: the account a distribution runs as
/// is its own, and nothing on the Windows side of the share knows which
/// directory under `/home` belongs to whoever opened the app — or that it is
/// under `/home` at all. Only a path that says `~` is asked about, so the rail
/// can offer a distribution's home without starting the distribution; starting
/// it is what picking that row does, the same as picking its root does.
fn expand_remote_home(host: &Host, path: &str) -> String {
    let Some(tail) = home_tail(path) else {
        return path.to_string();
    };
    // A distribution that will not say leaves the path as it was, which is a
    // directory called `~` that is almost certainly not there — refused where
    // it was asked for, like any other path that names nothing.
    let Some(home) = host.home() else {
        return path.to_string();
    };
    format!("{}{tail}", host.native(&home))
}

/// The path with the home directory written `~`, the way a shell writes it. A
/// path that is not under it is left exactly as it was, and the separator is
/// whichever one the path is already using.
pub(super) fn shorten_home(path: &str, home: Option<&Path>) -> String {
    let Some(home) = home else {
        return path.to_string();
    };
    let home = home.to_string_lossy();
    // A home that is the root of the disk shortens everything on it, which is
    // the whole filesystem renamed rather than a shorter spelling of anything.
    let home = home.trim_end_matches(['/', '\\']);
    if home.is_empty() {
        return path.to_string();
    }
    if path == home {
        return "~".to_string();
    }
    for separator in ['/', '\\'] {
        if let Some(rest) = path.strip_prefix(&format!("{home}{separator}")) {
            return format!("~{separator}{rest}");
        }
    }
    path.to_string()
}

/// One settled path, as the row that offers it needs it.
fn describe_place(host: &Host, path: &Path) -> Place {
    let spelled = path.to_string_lossy().into_owned();
    Place {
        label: host.name(path),
        display: shorten_home(&spelled, home_dir().as_deref()),
        path: spelled,
    }
}

/// Settles one typed path into a place to keep, or says why it is not one. The
/// disk is asked once and here, so a path that is a file — or nothing at all —
/// is refused where it was typed rather than at the pane that could not open it.
pub fn resolve_folder(raw: &str) -> Result<Place, String> {
    let (host, path) = resolve(raw)?;
    if !host.is_dir(&path) {
        return Err("no-such-folder".to_string());
    }
    Ok(describe_place(&host, &path))
}

/// Spells out the folders that were kept, without asking the disk about any.
///
/// What is stored is the paths alone, so this runs every time a menu is opened.
/// Nothing here touches a file: a folder inside a WSL distribution is stat'd by
/// starting a process in it, and a handful of kept folders would be a handful of
/// processes started to draw a menu.
pub fn describe_folders(paths: &[String]) -> Vec<Place> {
    paths
        .iter()
        .filter_map(|raw| {
            let (host, path) = resolve(raw).ok()?;
            Some(describe_place(&host, &path))
        })
        .collect()
}

/// Folds `.` and `..` lexically. Unlike `fs::canonicalize` this keeps UNC paths
/// as typed instead of rewriting them to their `\\?\` verbatim form.
pub(super) fn clean_path(path: &Path) -> PathBuf {
    let mut root = PathBuf::new();
    let mut rooted = false;
    let mut parts: Vec<&OsStr> = Vec::new();

    for component in path.components() {
        match component {
            Component::Prefix(prefix) => root.push(prefix.as_os_str()),
            Component::RootDir => {
                root.push(component.as_os_str());
                rooted = true;
            }
            Component::CurDir => {}
            Component::ParentDir => match parts.last() {
                Some(last) if *last != OsStr::new("..") => {
                    parts.pop();
                }
                // `/..` is `/`; a relative path keeps climbing instead.
                _ if rooted => {}
                _ => parts.push(OsStr::new("..")),
            },
            Component::Normal(part) => parts.push(part),
        }
    }

    let mut cleaned = root;
    for part in parts {
        cleaned.push(part);
    }
    if cleaned.as_os_str().is_empty() {
        PathBuf::from(".")
    } else {
        cleaned
    }
}

/// What was typed, as the machine holding it and a settled path on it — the one
/// door every command here goes through. A WSL path is folded as the
/// distribution would fold it rather than as this platform's `Path` would: on a
/// Linux build a backslash is an ordinary letter, and the answer has to be the
/// same in both builds.
pub(super) fn resolve(raw: &str) -> Result<(Host, PathBuf), String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("empty-path".to_string());
    }
    match wsl::locate(trimmed) {
        Some(found) => {
            let host = Host::Wsl(found.distro.clone());
            let inside = expand_remote_home(&host, &found.path);
            let path = wsl::unc(&found.distro, &wsl::clean(&inside));
            Ok((host, PathBuf::from(path)))
        }
        None => Ok((Host::Local, clean_path(&expand_user_path(trimmed)))),
    }
}
