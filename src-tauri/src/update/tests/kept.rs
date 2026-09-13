//! What the app remembers about updating itself, remembered by the app.

use crate::update::Kept;

use super::TempDir;

#[test]
fn the_row_follows_whatever_is_newest_until_it_is_pointed_somewhere() {
    let kept = Kept::at(None);
    assert_eq!(kept.picked(), None);
}

#[test]
fn what_the_row_was_left_pointed_at_is_there_after_a_restart() {
    let temp = TempDir::new("kept");
    let at = temp.path().join("update.json");

    let kept = Kept::at(Some(at.clone()));
    kept.pick(Some("0.1.7".to_string()));

    // Which is the whole of what this is for: the restart at the end of taking
    // a program is the most likely way this app ever closes.
    let after = Kept::at(Some(at.clone()));
    assert_eq!(after.picked().as_deref(), Some("0.1.7"));

    after.pick(None);
    assert_eq!(Kept::at(Some(at)).picked(), None);
}

#[test]
fn a_machine_with_nowhere_to_write_still_remembers_for_as_long_as_it_is_open() {
    let kept = Kept::at(None);
    kept.pick(Some("0.1.4".to_string()));
    assert_eq!(kept.picked().as_deref(), Some("0.1.4"));
}

#[test]
fn a_pin_an_older_copy_kept_per_layer_is_read_as_the_one_pin() {
    let temp = TempDir::new("older");
    let at = temp.path().join("update.json");
    // As a copy from before the rows were one row wrote it: cycles this build
    // no longer has, rows under names it no longer answers to, and a version
    // per layer it does. The pages' pin is the one that carries over.
    std::fs::write(
        &at,
        r#"{"cycles":{"front":"front"},"picked":{"core":"0.1.7","app":"0.2.0","persistent":"0.2.0","ephemeral":"0.1.13"}}"#,
    )
    .expect("write what an older copy left");

    let kept = Kept::at(Some(at.clone()));
    assert_eq!(kept.picked().as_deref(), Some("0.1.13"));

    // And once pointed somewhere by this copy, the older entries are gone
    // rather than waiting to come back after the pin is let go.
    kept.pick(Some("0.3.0".to_string()));
    kept.pick(None);
    assert_eq!(Kept::at(Some(at)).picked(), None);
}

#[test]
fn a_program_pin_alone_from_an_older_copy_stands_in() {
    let temp = TempDir::new("program");
    let at = temp.path().join("update.json");
    std::fs::write(&at, r#"{"picked":{"persistent":"0.2.0"}}"#).expect("write an older pin");
    assert_eq!(Kept::at(Some(at)).picked().as_deref(), Some("0.2.0"));
}
