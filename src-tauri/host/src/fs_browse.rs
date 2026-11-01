//! The home directory shared by shell startup and the window.

use std::path::PathBuf;

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
