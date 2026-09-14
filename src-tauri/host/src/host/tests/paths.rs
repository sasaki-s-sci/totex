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

#[test]
fn an_ssh_url_is_the_machine_it_names() {
    let host = Host::of(Path::new("ssh://box/home/a"));
    assert_eq!(host, Host::Ssh("box".to_string()));
    assert!(host.is_remote());
    assert_eq!(host.distro(), None, "a distribution is the Windows side's");
    assert_eq!(host.remote_name(), Some("box"));
    assert_eq!(host.native(Path::new("ssh://box/home/a")), "/home/a");
    assert_eq!(
        host.canonical("/home/a/repo"),
        PathBuf::from("ssh://box/home/a/repo")
    );
    assert_eq!(host.temp_dir(), PathBuf::from("ssh://box/tmp"));

    let dir = PathBuf::from("ssh://user@box.example/home/a");
    let host = Host::of(&dir);
    assert_eq!(host, Host::Ssh("user@box.example".to_string()));
    assert_eq!(host.join(&dir, "repo"), dir.join("repo"));
    assert_eq!(
        host.parent(&dir),
        Some(PathBuf::from("ssh://user@box.example/home"))
    );
    assert_eq!(host.parent(Path::new("ssh://user@box.example/")), None);
    assert_eq!(host.name(&dir), "a");
    assert_eq!(
        host.name(Path::new("ssh://user@box.example/")),
        "user@box.example"
    );
}

#[test]
fn each_remote_names_itself_and_the_way_there() {
    use crate::remote::Reach;
    assert_eq!(Host::Local.reach(), None);
    assert_eq!(Host::Local.remote_name(), None);
    let wsl = Host::Wsl("Ubuntu".to_string());
    assert_eq!(wsl.reach(), Some(Reach::Wsl("Ubuntu".to_string())));
    assert_eq!(wsl.distro(), Some("Ubuntu"));
    assert_eq!(wsl.remote_name(), Some("Ubuntu"));
    let ssh = Host::Ssh("box".to_string());
    assert_eq!(ssh.reach(), Some(Reach::Ssh("box".to_string())));
}
