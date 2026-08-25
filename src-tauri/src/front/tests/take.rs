//! What a press decides: which release the pages come from, and whether it is
//! signed by this app.

use super::super::fetch::{ours, unpack};
use super::super::take::{Found, choose};
use super::{TempDir, at, packed};

#[test]
fn a_press_takes_the_pages_before_the_program() {
    let built = at("0.1.2");
    let release = at("0.1.3");

    // The first press: the cheap half of the release, which costs a redraw.
    assert_eq!(
        choose(&release, Some(1), &built, &built, 1, true),
        Found::Front
    );
    // The second, with the pages already taken: what is left is the program.
    assert_eq!(
        choose(&release, Some(1), &release, &built, 1, true),
        Found::Whole
    );
    // And on a copy that cannot replace itself, that is the end of it.
    assert_eq!(
        choose(&release, Some(1), &release, &built, 1, false),
        Found::Held
    );
}

#[test]
fn the_newest_release_is_nothing_to_do() {
    let built = at("0.1.3");
    for release in ["0.1.3", "0.1.2", "0.0.9"] {
        assert_eq!(
            choose(&at(release), Some(1), &built, &built, 1, true),
            Found::Current,
            "{release} is not newer than {built}"
        );
    }
}

#[test]
fn pages_that_need_a_newer_program_are_left_alone() {
    let built = at("0.1.2");
    let release = at("0.1.3");

    // The release's pages talk to a program this one is not: taking them would
    // be a window drawn against commands that are not there.
    assert_eq!(
        choose(&release, Some(2), &built, &built, 1, true),
        Found::Whole
    );
    assert_eq!(
        choose(&release, Some(2), &built, &built, 1, false),
        Found::Held
    );
    // A release that names no front at all is the same answer.
    assert_eq!(
        choose(&release, None, &built, &built, 1, true),
        Found::Whole
    );
    assert_eq!(
        choose(&release, None, &built, &built, 1, false),
        Found::Held
    );
}

#[test]
fn a_front_is_the_contents_of_dist_and_has_to_have_a_page() {
    let temp = TempDir::new("unpack");
    let whole = packed(&[
        ("./index.html", b"<!doctype html>"),
        ("./assets/app.js", b"nothing"),
    ]);

    let unpacked = unpack(temp.path(), &at("0.1.3"), &whole).expect("a front with a page in it");
    assert_eq!(unpacked.dir, temp.path().join("0.1.3"));
    assert!(unpacked.dir.join("index.html").is_file());
    assert!(unpacked.dir.join("assets").join("app.js").is_file());

    let partial = packed(&[("./assets/app.js", b"nothing")]);
    assert!(
        unpack(temp.path(), &at("0.1.4"), &partial).is_err(),
        "a front with no page is not a front"
    );
    assert!(
        !temp.path().join("0.1.4").exists(),
        "and it is not left under a version number"
    );
}

/// A front of five bytes and the signature `tauri signer sign` wrote for it,
/// under a key made for this test and thrown away — [`KEY`] is its public half.
///
/// What is held to here is a shape rather than a key. The release manifest
/// carries base64 around a minisign block and `tauri.conf.json` carries base64
/// around the other half of the same pair; these are what the release job
/// actually writes, so this is what says the two are read back the way they
/// were written.
const SIGNED: &[u8] = b"pages";
const SIGNATURE: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBmcm9tIHRhdXJpIHNlY3JldCBrZXkKUlVSYnl2SzBhb0g3aGdGR1A2Rzhzc1RCMHBvVWo2bzlFQlBicTRwUDIxejFrVkEvMStiWGkwOVNaQW1JZ2ZSdDFESC91UmlnYmhKUjJLTVBSYWJRbURrQy81Qk1yMHZCMndZPQp0cnVzdGVkIGNvbW1lbnQ6IHRpbWVzdGFtcDoxNzg3NTA5MTc0CWZpbGU6ZnJvbnQudGFyLmd6CkgrMGlvb0k0eEtPU0JkOWFxRXhLcGhqWk90RkFaK3J2V2pwN2hhaGU5OTBqQ093QnYxQ0hGZ3IxZlBFV2VyZGR4QlJlSmNWaDRYT0FZWmN1ejd2akFRPT0K";
const KEY: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDg2RkI4MTZBQjRGMkNBNUIKUldSYnl2SzBhb0g3aGwzS1ZPY04wenRUdmdnSW5EdnlEMVpMYy8zRnNCb1hwRENvUzVGRllKeUkK";

#[test]
fn a_front_signed_with_the_apps_key_is_the_one_that_is_taken() {
    ours(SIGNED, SIGNATURE, KEY).expect("the signature the signer wrote for it");
    assert!(
        ours(b"other pages", SIGNATURE, KEY).is_err(),
        "the signature is of the front, not of the fact that there is one"
    );
}

#[test]
fn a_front_that_is_not_signed_with_the_apps_key_is_not_taken() {
    assert!(ours(SIGNED, "not base64", KEY).is_err());
    // Well-formed base64 around something that is not a minisign block.
    assert!(ours(SIGNED, "aGVsbG8=", KEY).is_err());
    assert!(ours(SIGNED, SIGNATURE, "aGVsbG8=").is_err());
}
