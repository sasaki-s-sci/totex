//! The release that came down and is waiting for the app to be closed.
//!
//! Only the half of it that is this app's own. What actually puts a release in
//! is the updater plugin, given an archive it handed back itself, and there is
//! no way to make one of those here that is not a signed release — which is
//! what `whole.rs` is for. What is left is the file: whether one is there, and
//! whether one that nothing is pointed at any more is still there.

use crate::update::Waiting;

use super::TempDir;

/// Nothing is held, so there is nothing to put in, and saying so is the whole
/// of what a copy that was never pressed has to do on the way out.
#[test]
fn an_app_that_took_nothing_puts_nothing_in_on_the_way_out() {
    let temp = TempDir::new("waiting-none");
    Waiting::at(temp.path().join("waiting")).go_in();
}

/// A release still sitting there is one from a run that was killed rather than
/// closed. Nothing is pointed at it any more — what knew how to put it in went
/// with the process — so it is the size of an installer and nothing else.
#[test]
fn a_release_nobody_put_in_is_not_left_lying_about() {
    let temp = TempDir::new("waiting-stale");
    let at = temp.path().join("waiting");
    std::fs::write(&at, b"the installer of a run that was killed").expect("a release to leave");

    let waiting = Waiting::at(at.clone());

    assert!(!at.exists(), "the release was left behind");
    // And there is still nothing to put in, which is the other half of it: a
    // file on its own is not a release this app can do anything with.
    waiting.go_in();
}

/// Somewhere to keep one is made rather than assumed. The cache directory has
/// nothing of this app's in it until something puts something there.
#[test]
fn there_is_somewhere_to_keep_one_before_one_arrives() {
    let temp = TempDir::new("waiting-home");
    let at = temp.path().join("not-made-yet").join("waiting");
    Waiting::at(at.clone());
    assert!(!at.exists());
}
