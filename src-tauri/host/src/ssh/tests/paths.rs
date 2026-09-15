//! Reading an `ssh://` path apart, and putting it back together.

use super::super::{locate, url};

#[test]
fn reads_a_machine_out_of_the_url() {
    let found = locate("ssh://box/home/a/repo").expect("an ssh path");
    assert_eq!(found.host, "box");
    assert_eq!(found.path, "/home/a/repo");
    let found = locate("ssh://user@box.example.com/srv").expect("an ssh path");
    assert_eq!(found.host, "user@box.example.com");
    assert_eq!(found.path, "/srv");
}

#[test]
fn the_host_alone_is_the_root_of_the_machine() {
    for spelling in ["ssh://box", "ssh://box/", "ssh://box//"] {
        let found = locate(spelling).expect("an ssh path");
        assert_eq!(found.host, "box", "{spelling}");
        assert_eq!(found.path, "/");
        assert_eq!(found.parent(), None);
        assert_eq!(found.name(), "box");
        assert_eq!(found.url(), "ssh://box/");
    }
}

#[test]
fn a_path_that_is_not_one_is_not_one() {
    assert_eq!(locate("/home/a"), None);
    assert_eq!(locate(r"C:\Users\a"), None);
    assert_eq!(locate(r"\\wsl.localhost\Ubuntu\home"), None);
    assert_eq!(locate("ssh:/box/home"), None);
    assert_eq!(locate("ssh:///home/a"), None, "a machine has to be named");
    assert_eq!(locate("ssh://"), None);
    assert_eq!(
        locate("SSH://box/home"),
        None,
        "the scheme is written one way"
    );
}

#[test]
fn doubled_separators_are_folded_and_the_rest_is_left_alone() {
    let found = locate("ssh://box//home//a/").expect("an ssh path");
    assert_eq!(found.path, "/home/a");
    // `.` and `..` are settled later, and `~` is a marker the machine answers.
    assert_eq!(
        locate("ssh://box/home/a/../b").expect("one").path,
        "/home/a/../b"
    );
    assert_eq!(locate("ssh://box/~").expect("one").path, "/~");
    assert_eq!(locate("ssh://box/~/repo").expect("one").path, "/~/repo");
}

#[test]
fn the_url_spelling_survives_the_round_trip() {
    for raw in [
        "ssh://box/home/a/repo",
        "ssh://user@box/",
        "ssh://box/~/repo",
        "ssh://box/a dir/with spaces",
    ] {
        let found = locate(raw).expect("an ssh path");
        assert_eq!(found.url(), raw);
        assert_eq!(url(&found.host, &found.path), raw);
        assert_eq!(locate(&found.url()), Some(found), "{raw}");
    }
    assert_eq!(url("box", "/"), "ssh://box/");
    assert_eq!(url("box", ""), "ssh://box/");
    assert_eq!(url("box", "home/a"), "ssh://box/home/a");
}

#[test]
fn walks_up_and_down_without_leaving_the_machine() {
    let found = locate("ssh://box/home/a").expect("an ssh path");
    assert_eq!(found.at("/home/a/repo").url(), "ssh://box/home/a/repo");
    assert_eq!(found.parent().expect("a parent").path, "/home");
    assert_eq!(found.parent().expect("a parent").host, "box");
    assert_eq!(found.name(), "a");
}
