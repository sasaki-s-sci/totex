//! The passwords kept for machines. The store is the whole process's, so every
//! test here uses a host no other test does.

use super::super::secrets::{forget, known, remember};

#[test]
fn a_password_is_kept_until_it_is_forgotten() {
    let host = "a@secrets-test-kept:2222";
    assert_eq!(known(host), None);
    remember(host, "first");
    assert_eq!(known(host).as_deref(), Some("first"));
    remember(host, "second");
    assert_eq!(known(host).as_deref(), Some("second"));
    forget(host);
    assert_eq!(known(host), None);
}

#[test]
fn the_host_is_taken_exactly_as_spelled() {
    let host = "a@secrets-test-spelled";
    remember(host, "it");
    assert_eq!(known("secrets-test-spelled"), None);
    assert_eq!(known("a@secrets-test-spelled:22"), None);
    forget(host);
}
