//! Reading a share path apart, and putting it back together.

use super::super::{clean, join, locate};

#[test]
fn reads_a_distribution_out_of_the_share() {
    let found = locate(r"\\wsl.localhost\Ubuntu\home\a\repo").expect("a wsl path");
    assert_eq!(found.distro, "Ubuntu");
    assert_eq!(found.path, "/home/a/repo");
}

#[test]
fn reads_the_spelling_older_builds_publish() {
    let found = locate(r"\\wsl$\Ubuntu-24.04\srv").expect("a wsl path");
    assert_eq!(found.distro, "Ubuntu-24.04");
    assert_eq!(found.path, "/srv");
}

#[test]
fn the_share_itself_is_the_root_of_the_distribution() {
    let found = locate(r"\\wsl.localhost\Ubuntu").expect("a wsl path");
    assert_eq!(found.path, "/");
    assert_eq!(found.parent(), None);
}

#[test]
fn a_local_path_is_not_one() {
    assert_eq!(locate(r"C:\Users\a"), None);
    assert_eq!(locate("/home/a"), None);
    assert_eq!(locate(r"\\server\share\dir"), None);
}

#[test]
fn the_unc_spelling_survives_the_round_trip() {
    let raw = r"\\wsl.localhost\Ubuntu\home\a\repo";
    assert_eq!(locate(raw).expect("a wsl path").unc(), raw);
}

#[test]
fn the_legacy_spelling_is_written_back_as_the_current_one() {
    let found = locate(r"\\wsl$\Ubuntu\home").expect("a wsl path");
    assert_eq!(found.unc(), r"\\wsl.localhost\Ubuntu\home");
}

#[test]
fn walks_up_and_down_without_leaving_the_distribution() {
    let found = locate(r"\\wsl.localhost\Ubuntu\home\a").expect("a wsl path");
    assert_eq!(found.at(&join(&found.path, "repo")).path, "/home/a/repo");
    assert_eq!(found.parent().expect("a parent").path, "/home");
    assert_eq!(found.name(), "a");
    let root = found.at("/");
    assert_eq!(root.name(), "Ubuntu");
}

#[test]
fn a_path_that_climbs_is_folded_before_it_is_asked_about() {
    assert_eq!(clean("/a/./b/../c"), "/a/c");
    assert_eq!(clean("/../.."), "/");
    assert_eq!(clean("/home//a/"), "/home/a");
}
