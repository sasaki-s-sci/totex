//! Which machine a path names, and walking it there.

use std::path::{Path, PathBuf};

use super::super::Host;

#[test]
fn a_windows_path_is_this_machine() {
    assert_eq!(Host::of(Path::new(r"C:\Users\a")), Host::Local);
    assert_eq!(Host::of(Path::new("/home/a")), Host::Local);
}

#[test]
fn a_share_path_is_the_distribution_it_names() {
    let host = Host::of(Path::new(r"\\wsl.localhost\Ubuntu\home\a"));
    assert_eq!(host, Host::Wsl("Ubuntu".to_string()));
    assert_eq!(
        host.native(Path::new(r"\\wsl.localhost\Ubuntu\home\a")),
        "/home/a"
    );
    assert_eq!(
        host.canonical("/home/a/repo"),
        PathBuf::from(r"\\wsl.localhost\Ubuntu\home\a\repo")
    );
}

/// The reason these are asked of the host: on a Linux build `Path` reads none of
/// it, and this is the build the tests run in.
#[test]
fn walks_a_remote_path_without_going_through_path() {
    let host = Host::Wsl("Ubuntu".to_string());
    let dir = PathBuf::from(r"\\wsl.localhost\Ubuntu\home\a");
    assert_eq!(
        host.join(&dir, "repo"),
        PathBuf::from(r"\\wsl.localhost\Ubuntu\home\a\repo")
    );
    assert_eq!(
        host.parent(&dir),
        Some(PathBuf::from(r"\\wsl.localhost\Ubuntu\home"))
    );
    assert_eq!(host.name(&dir), "a");
    assert_eq!(host.name(Path::new(r"\\wsl.localhost\Ubuntu")), "Ubuntu");
}
