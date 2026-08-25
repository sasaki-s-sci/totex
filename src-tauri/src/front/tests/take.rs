//! What a press decides: which half of a release this copy can take, and
//! whether what came back is signed by this app.

use super::super::take::{choose, ours, unpack};
use super::{TempDir, at, packed};
use crate::update::Took;

#[test]
fn the_pages_of_a_newer_release_are_this_half_to_take() {
    let built = at("0.1.2");
    let release = at("0.1.3");

    // Nothing taken yet: the window is drawn out of what the program carries.
    assert_eq!(
        choose(&release, Some(1), &built, &built, 1, false),
        Took::Taken
    );
    // And once they are taken, this row has nothing left to do about them.
    assert_eq!(
        choose(&release, Some(1), &release, &built, 1, false),
        Took::Current
    );
}

#[test]
fn the_release_the_window_is_already_drawn_from_is_nothing_to_do() {
    let built = at("0.1.3");
    assert_eq!(
        choose(&built, Some(1), &built, &built, 1, false),
        Took::Current
    );
}

#[test]
fn pages_behind_the_program_are_the_program_to_bring() {
    let built = at("0.1.3");
    // A press that means "bring me up to date" and finds pages older than the
    // program has found nothing worth doing: what would be drawn is the
    // program's own pages either way.
    for release in ["0.1.2", "0.0.9"] {
        assert_eq!(
            choose(&at(release), Some(1), &built, &built, 1, false),
            Took::Held,
            "{release} is behind {built}"
        );
    }
}

#[test]
fn pages_somebody_named_are_taken_whichever_way_they_are() {
    let built = at("0.1.3");
    // The same pages, asked for by name. Choosing the release you were on last
    // week is the whole of what choosing is for -- see `choose`.
    for release in ["0.1.2", "0.0.9", "0.1.4"] {
        assert_eq!(
            choose(&at(release), Some(1), &built, &built, 1, true),
            Took::Taken,
            "{release} was named"
        );
    }
    // But not pages that talk to a program this one is not, however they were
    // asked for: that is a window calling commands that are not there.
    assert_eq!(
        choose(&at("0.1.4"), Some(2), &built, &built, 1, true),
        Took::Held
    );
    // And not the ones already on the screen.
    assert_eq!(
        choose(&built, Some(1), &built, &built, 1, true),
        Took::Current
    );
}

#[test]
fn pages_that_need_a_newer_program_are_left_alone() {
    let built = at("0.1.2");
    let release = at("0.1.3");

    // The release's pages talk to a program this one is not: taking them would
    // be a window drawn against commands that are not there.
    assert_eq!(
        choose(&release, Some(2), &built, &built, 1, false),
        Took::Held
    );
    // A release that names no front at all is the same answer.
    assert_eq!(choose(&release, None, &built, &built, 1, false), Took::Held);
}

#[test]
fn a_front_is_the_contents_of_dist_and_has_to_have_a_page() {
    let temp = TempDir::new("unpack");
    let whole = packed(&[
        ("./index.html", b"<!doctype html>"),
        ("./assets/app.js", b"nothing"),
    ]);

    let unpacked =
        unpack(temp.path(), &at("0.1.3"), 1, false, &whole).expect("a front with a page in it");
    assert_eq!(unpacked.dir, temp.path().join("0.1.3"));
    assert!(unpacked.dir.join("index.html").is_file());
    assert!(unpacked.dir.join("assets").join("app.js").is_file());

    let partial = packed(&[("./assets/app.js", b"nothing")]);
    assert!(
        unpack(temp.path(), &at("0.1.4"), 1, false, &partial).is_err(),
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
