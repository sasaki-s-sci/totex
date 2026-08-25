//! What an earlier run left behind, and which of it a window opens on.

use std::fs;

use tauri::utils::assets::AssetKey;

use super::super::serving::{keep, read_under};
use super::serve::serving;
use super::{TempDir, at, lay, needing, pinning};

#[test]
fn a_page_can_only_ask_for_what_is_under_the_front() {
    let temp = TempDir::new("under");
    let front = temp.path().join("0.1.3");
    fs::create_dir_all(front.join("assets")).expect("lay a front");
    fs::write(front.join("assets").join("app.js"), b"there").expect("lay a file");
    fs::write(temp.path().join("secret"), b"not there").expect("lay a file");

    assert_eq!(
        read_under(&front, &AssetKey::from("/assets/app.js")).as_deref(),
        Some(&b"there"[..])
    );
    assert_eq!(read_under(&front, &AssetKey::from("/../secret")), None);
    assert_eq!(read_under(&front, &AssetKey::from("/assets/gone.js")), None);
}

#[test]
fn only_a_confirmed_front_newer_than_the_binary_is_opened_on() {
    let built = at("0.1.2");

    let kept = TempDir::new("kept");
    lay(kept.path(), "0.1.3", true);
    assert!(
        keep(kept.path(), &built, 1).is_some(),
        "a confirmed newer front is what the window opens on"
    );

    // One that has never drawn a window is one that has had its chance.
    let unconfirmed = TempDir::new("unconfirmed");
    lay(unconfirmed.path(), "0.1.3", false);
    assert!(keep(unconfirmed.path(), &built, 1).is_none());
    assert!(
        !unconfirmed.path().exists(),
        "and it is not left lying there"
    );

    // One the binary has caught up with is one the binary already carries.
    let overtaken = TempDir::new("overtaken");
    lay(overtaken.path(), "0.1.2", true);
    assert!(keep(overtaken.path(), &built, 1).is_none());
    assert!(!overtaken.path().exists());
}

#[test]
fn a_front_the_program_underneath_it_cannot_answer_is_dropped() {
    // The step backwards: pages taken onto one program, and an older program
    // put under them afterwards by naming a version. What they were checked
    // against at the time is not what they would be served by now.
    let ahead = TempDir::new("ahead");
    needing(ahead.path(), "0.1.4", 2, true);
    assert!(keep(ahead.path(), &at("0.1.2"), 1).is_none());
    assert!(!ahead.path().exists(), "and it is not left lying there");

    // The same front on the program it was taken onto is served as before.
    let matched = TempDir::new("matched");
    needing(matched.path(), "0.1.4", 2, true);
    assert!(keep(matched.path(), &at("0.1.2"), 2).is_some());
}

#[test]
fn taking_the_program_leaves_the_release_that_was_asked_for_standing() {
    // What the program row says before it downloads anything: the front over
    // the top of it is not part of the release being asked for. Said rather
    // than deleted, because the window on the screen is still drawn out of it.
    let temp = TempDir::new("dropped");
    lay(temp.path(), "0.1.3", true);
    let serving = serving(temp.path(), "0.1.2", Some("0.1.3"));

    serving.drop_front();
    assert!(
        temp.path().join("0.1.3").is_dir(),
        "the window on the screen is still being served out of it"
    );
    assert!(keep(temp.path(), &at("0.1.2"), 1).is_none());
    assert!(!temp.path().exists(), "and the next start clears it away");
}

#[test]
fn a_front_somebody_named_is_opened_on_however_old_it_is() {
    // The way back to an older release, which is a front behind the program
    // rather than in front of it -- see `Taken::pinned`.
    let pinned = TempDir::new("pinned");
    pinning(pinned.path(), "0.1.1", 1, true, true);
    let kept = keep(pinned.path(), &at("0.1.2"), 1).expect("the one that was named");
    assert_eq!(kept.version, at("0.1.1"));

    // And taking the program is still what clears one away: the release the
    // program came out of carries its own pages, and those are the ones that
    // release means.
    let serving = serving(pinned.path(), "0.1.2", Some("0.1.1"));
    serving.drop_front();
    assert!(keep(pinned.path(), &at("0.1.2"), 1).is_none());
}

#[test]
fn opening_on_a_front_clears_away_the_ones_before_it() {
    let temp = TempDir::new("clears");
    lay(temp.path(), "0.1.3", true);
    lay(temp.path(), "0.1.4", true);

    let kept = keep(temp.path(), &at("0.1.2"), 1).expect("the newest of them");
    assert_eq!(kept.version, at("0.1.4"));
    assert!(kept.dir.is_dir());
    assert!(
        !temp.path().join("0.1.3").exists(),
        "the one it overtook goes with it"
    );
}
