//! Putting a copy of what a row names where this machine keeps its downloads.
//!
//! The window is not a browser and a row is not a link, so what the menu calls
//! a download is a copy of something already on a disk, put where the machine
//! running the window puts what it is given. That is worth having for a local
//! file and it is the whole point for a remote one: a path inside a WSL
//! distribution is on the far side of a share nothing else on the desktop knows
//! about, and the copy lands in the Windows downloads folder, which every
//! program on the host can open.
//!
//! So the destination is always this machine, whatever the source was, and
//! where the copy is put is not a question at all. How it is made is one, and
//! it is [`super::copy`]'s: a folder inside a distribution comes across by the
//! distribution copying it onto the disk it already has mounted, rather than
//! every byte of it being read up into this program first.

use std::path::{Path, PathBuf};

use super::copy::{copy_tree, sweep};
use super::operate::unused_name;
use super::path::{home_dir, resolve};
use crate::host::Host;

/// Copies one file or folder into this machine's downloads folder, and answers
/// with where it went.
pub fn download(raw_path: &str) -> Result<String, String> {
    let (host, path) = resolve(raw_path)?;
    let stat = host.stat(&path).ok_or_else(|| "no-such-file".to_string())?;
    let name = host.name(&path);
    if name.is_empty() {
        return Err("no-name".to_string());
    }

    // Made if it is not there: a machine that has never been given anything
    // still has somewhere for this to go.
    let into = downloads_dir()?;
    std::fs::create_dir_all(&into).map_err(|error| error.to_string())?;
    let target = unused_name(&Host::Local, &into, &name)?;

    match copy_tree(&host, &path, &stat, &Host::Local, &target) {
        Ok(()) => Ok(target.to_string_lossy().into_owned()),
        Err(error) => {
            // Nothing half copied is left in the folder: the error is the
            // download that did not happen, not the tidying after it.
            sweep(&Host::Local, &target);
            Err(error)
        }
    }
}

/// The folder this machine keeps what it is given in.
///
/// Both platforms let it be moved and each writes down where to in its own way,
/// so the name under the home directory is the fallback rather than the answer.
pub(super) fn downloads_dir() -> Result<PathBuf, String> {
    let home = home_dir().ok_or_else(|| "no-home".to_string())?;
    Ok(named_downloads(&home).unwrap_or_else(|| home.join("Downloads")))
}

/// Where Windows says the folder is, which is under an id rather than a name:
/// Explorer knows it by that, and moving the folder rewrites the value without
/// touching anything else. `reg` is asked rather than the API, because this
/// crate is built for two platforms and links nothing belonging to either.
#[cfg(windows)]
fn named_downloads(home: &Path) -> Option<PathBuf> {
    let output = Host::Local
        .exec(
            None,
            &[],
            &[
                "reg",
                "query",
                r"HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders",
                "/v",
                DOWNLOADS_ID,
            ],
        )
        .ok()?;
    if !output.ok() {
        return None;
    }
    let value = read_registry_value(&String::from_utf8_lossy(&output.stdout), DOWNLOADS_ID)?;
    Some(PathBuf::from(expand_windows_vars(&value, home)))
}

/// Where the desktops on this side say it is: the environment first, and then
/// the file `xdg-user-dirs` writes, which is what a file manager reads.
#[cfg(not(windows))]
fn named_downloads(home: &Path) -> Option<PathBuf> {
    if let Some(named) = std::env::var_os("XDG_DOWNLOAD_DIR").filter(|named| !named.is_empty()) {
        return Some(PathBuf::from(named));
    }
    let config = std::env::var_os("XDG_CONFIG_HOME")
        .filter(|config| !config.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| home.join(".config"));
    let text = std::fs::read_to_string(config.join("user-dirs.dirs")).ok()?;
    let named = read_user_dir(&text, "XDG_DOWNLOAD_DIR")?;
    Some(PathBuf::from(expand_home(&named, home)))
}

/// The id Explorer keeps the downloads folder under.
#[cfg_attr(not(windows), allow(dead_code))]
const DOWNLOADS_ID: &str = "{374DE290-123F-4565-9164-39C4925E467B}";

/// The path out of what `reg query` printed: the name, the type it was kept as,
/// and then the rest of the line, which is allowed to hold spaces.
#[cfg_attr(not(windows), allow(dead_code))]
pub(super) fn read_registry_value(text: &str, name: &str) -> Option<String> {
    for line in text.lines() {
        let Some(rest) = line.trim().strip_prefix(name) else {
            continue;
        };
        let (_kind, value) = rest.trim_start().split_once(char::is_whitespace)?;
        let value = value.trim();
        if !value.is_empty() {
            return Some(value.to_string());
        }
    }
    None
}

/// `%USERPROFILE%`, which is how the folder is written down while it is still
/// where Windows put it.
#[cfg_attr(not(windows), allow(dead_code))]
pub(super) fn expand_windows_vars(value: &str, home: &Path) -> String {
    value.replace("%USERPROFILE%", &home.to_string_lossy())
}

/// The path out of one line of `user-dirs.dirs`, which is a shell fragment:
/// `XDG_DOWNLOAD_DIR="$HOME/Downloads"`.
#[cfg_attr(windows, allow(dead_code))]
pub(super) fn read_user_dir(text: &str, name: &str) -> Option<String> {
    for line in text.lines() {
        let line = line.trim();
        if line.starts_with('#') {
            continue;
        }
        let Some(rest) = line.strip_prefix(name) else {
            continue;
        };
        let Some(rest) = rest.trim_start().strip_prefix('=') else {
            continue;
        };
        let value = rest.trim().trim_matches('"');
        if !value.is_empty() {
            return Some(value.to_string());
        }
    }
    None
}

/// `$HOME` at the front of what one of those lines said, which is how
/// `xdg-user-dirs` writes a folder that is under it.
#[cfg_attr(windows, allow(dead_code))]
pub(super) fn expand_home(value: &str, home: &Path) -> String {
    let home = home.to_string_lossy();
    if value == "$HOME" {
        return home.into_owned();
    }
    match value.strip_prefix("$HOME/") {
        Some(rest) => format!("{}/{rest}", home.trim_end_matches('/')),
        None => value.to_string(),
    }
}
