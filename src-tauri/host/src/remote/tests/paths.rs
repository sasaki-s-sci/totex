//! Walking a Linux path as a string, which is the same walk on every far
//! machine.

use super::super::path::{clean, join, name, parent};

#[test]
fn walks_up_and_down_without_going_through_path() {
    assert_eq!(join("/home/a", "repo"), "/home/a/repo");
    assert_eq!(join("/", "home"), "/home");
    assert_eq!(
        join("/home/a", "/etc"),
        "/etc",
        "an absolute name replaces the base"
    );
    assert_eq!(parent("/home/a"), Some("/home"));
    assert_eq!(parent("/home"), Some("/"));
    assert_eq!(parent("/"), None);
    assert_eq!(name("/home/a"), Some("a"));
    assert_eq!(name("/"), None);
}

#[test]
fn a_path_that_climbs_is_folded_before_it_is_asked_about() {
    assert_eq!(clean("/a/./b/../c"), "/a/c");
    assert_eq!(clean("/../.."), "/");
    assert_eq!(clean("/home//a/"), "/home/a");
}
