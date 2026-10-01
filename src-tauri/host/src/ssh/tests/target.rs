//! A port read off the end of the host's spelling, and everything that is not
//! one left alone.

use super::super::{Location, locate, target};

fn split(host: &str) -> (String, Option<String>) {
    target(host)
}

fn with(destination: &str, port: &str) -> (String, Option<String>) {
    (destination.to_string(), Some(port.to_string()))
}

fn alone(host: &str) -> (String, Option<String>) {
    (host.to_string(), None)
}

#[test]
fn a_trailing_port_is_read_off() {
    assert_eq!(split("a@10.0.0.2:2222"), with("a@10.0.0.2", "2222"));
    assert_eq!(split("10.0.0.2:2222"), with("10.0.0.2", "2222"));
    assert_eq!(split("box.example.com:22"), with("box.example.com", "22"));
}

#[test]
fn a_host_with_no_port_is_left_as_it_is() {
    assert_eq!(split("box"), alone("box"));
    assert_eq!(split("a@box"), alone("a@box"));
    assert_eq!(split("a@10.0.0.2"), alone("a@10.0.0.2"));
}

#[test]
fn what_follows_a_colon_has_to_be_a_port() {
    assert_eq!(split("box:"), alone("box:"));
    assert_eq!(split("box:ssh"), alone("box:ssh"));
    assert_eq!(split("box:+22"), alone("box:+22"));
    assert_eq!(split("box:70000"), alone("box:70000"));
    assert_eq!(split(":22"), alone(":22"));
    assert_eq!(split("a@:22"), alone("a@:22"));
}

#[test]
fn a_bare_ipv6_address_is_never_read_as_carrying_a_port() {
    assert_eq!(split("::1"), alone("::1"));
    assert_eq!(split("fe80::1:22"), alone("fe80::1:22"));
    assert_eq!(split("a@fe80::1:22"), alone("a@fe80::1:22"));
}

#[test]
fn a_bracketed_ipv6_address_carries_a_port_and_loses_the_brackets() {
    assert_eq!(split("[fe80::1]:2222"), with("fe80::1", "2222"));
    assert_eq!(split("a@[::1]:22"), with("a@::1", "22"));
    // Brackets with no port after them are not this reading's to undo.
    assert_eq!(split("[::1]"), alone("[::1]"));
    assert_eq!(split("[]:22"), alone("[]:22"));
}

/// The url spelling carries the port in the host, all the way round.
#[test]
fn a_path_on_a_port_reads_and_spells_back_the_same() {
    let location = locate("ssh://a@10.0.0.2:2222/home/a").expect("an ssh path");
    assert_eq!(
        location,
        Location {
            host: "a@10.0.0.2:2222".to_string(),
            path: "/home/a".to_string(),
        }
    );
    assert_eq!(location.url(), "ssh://a@10.0.0.2:2222/home/a");
    let root = locate("ssh://a@10.0.0.2:2222").expect("the root");
    assert_eq!(root.path, "/");
    assert_eq!(root.name(), "a@10.0.0.2:2222");
}
