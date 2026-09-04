//! The release that came down and is waiting for the restart.

use totex_persistent::update::{Install, Kind};

use crate::update::Ready;

fn came_down(version: &str) -> Ready {
    let ready = Ready::default();
    ready.hold(
        version,
        Install {
            kind: Kind::AppImage,
            download: "/nowhere/release.AppImage".into(),
            target: "/nowhere/totex.AppImage".into(),
        },
    );
    ready
}

/// Nothing is held, so there is nothing to put in.
#[test]
fn a_window_that_took_nothing_has_nothing_waiting() {
    let ready = Ready::default();
    assert_eq!(ready.waiting(), None);
    assert!(ready.take().is_none());
}

/// A row moved to another version lets go of the release it had; a row left
/// on `latest` or pointed at the same version again does not.
#[test]
fn moving_the_row_lets_go_of_a_release_it_no_longer_names() {
    let ready = came_down("0.2.0");
    ready.let_go_unless(None);
    assert_eq!(ready.waiting().as_deref(), Some("0.2.0"));
    ready.let_go_unless(Some("0.2.0"));
    assert_eq!(ready.waiting().as_deref(), Some("0.2.0"));
    ready.let_go_unless(Some("0.1.9"));
    assert_eq!(ready.waiting(), None);
}

/// What the restart takes is taken once: a second restart has nothing to put in.
#[test]
fn the_restart_takes_the_release_with_it() {
    let ready = came_down("0.2.0");
    let install = ready.take().expect("a release is waiting");
    assert_eq!(install.kind, Kind::AppImage);
    assert!(ready.take().is_none());
}
