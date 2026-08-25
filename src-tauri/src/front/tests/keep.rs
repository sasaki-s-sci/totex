//! What an earlier run left behind, and which of it a window opens on.

use std::fs;

use tauri::utils::assets::AssetKey;

use super::super::serving::{keep, read_under};
use super::{TempDir, at, lay};

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
        keep(kept.path(), &built).is_some(),
        "a confirmed newer front is what the window opens on"
    );

    // One that has never drawn a window is one that has had its chance.
    let unconfirmed = TempDir::new("unconfirmed");
    lay(unconfirmed.path(), "0.1.3", false);
    assert!(keep(unconfirmed.path(), &built).is_none());
    assert!(
        !unconfirmed.path().exists(),
        "and it is not left lying there"
    );

    // One the binary has caught up with is one the binary already carries.
    let overtaken = TempDir::new("overtaken");
    lay(overtaken.path(), "0.1.2", true);
    assert!(keep(overtaken.path(), &built).is_none());
    assert!(!overtaken.path().exists());
}

#[test]
fn opening_on_a_front_clears_away_the_ones_before_it() {
    let temp = TempDir::new("clears");
    lay(temp.path(), "0.1.3", true);
    lay(temp.path(), "0.1.4", true);

    let kept = keep(temp.path(), &at("0.1.2")).expect("the newest of them");
    assert_eq!(kept.version, at("0.1.4"));
    assert!(kept.dir.is_dir());
    assert!(
        !temp.path().join("0.1.3").exists(),
        "the one it overtook goes with it"
    );
}
