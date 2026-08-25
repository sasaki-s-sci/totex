//! A temp directory on this machine, and one inside a distribution.

mod path;
mod read;
mod roots;
mod wsl;

use std::fs;
use std::path::PathBuf;

pub(super) fn temp_dir(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("totex-test-{name}-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).expect("temp dir");
    dir
}

/// A folder inside a distribution, named the way the window names it — the same
/// path string the picker hands back is the one that comes back in here.
/// `None` where there is no WSL to reach, which is every CI machine.
pub(super) fn wsl_dir(name: &str) -> Option<String> {
    let distro = crate::wsl::distros().into_iter().next()?;
    let path = format!("/tmp/totex-browse-test/{name}");
    crate::wsl::exec(
        &distro,
        None,
        &[],
        &[
            "sh",
            "-c",
            &format!("rm -rf {0}; mkdir -p {0}", crate::wsl::shell::quote(&path)),
        ],
    )
    .ok()?;
    Some(crate::wsl::unc(&distro, &path))
}
