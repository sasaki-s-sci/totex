//! A temp directory on this machine, and one inside a distribution.

mod copy;
mod download;
mod operate;
mod path;
mod read;
mod remote;
mod roots;

use std::fs;
use std::path::PathBuf;

use crate::host::Host;

pub(super) fn temp_dir(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("totex-test-{name}-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).expect("temp dir");
    dir
}

/// A folder on every far machine there is to reach, named the way the window
/// names it — the same path string the picker hands back is the one that comes
/// back in here. See `crate::host::tests::reachable` for which machines.
pub(super) fn remote_dirs(name: &str) -> Vec<(Host, String)> {
    crate::host::tests::reachable()
        .into_iter()
        .map(|host| {
            let dir = crate::host::tests::scratch(&host, &format!("browse-{name}"));
            (host, dir.to_string_lossy().into_owned())
        })
        .collect()
}
