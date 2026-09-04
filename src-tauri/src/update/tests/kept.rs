//! What the app remembers about updating itself, remembered by the app.

use crate::update::{Kept, Layer};

use super::TempDir;

#[test]
fn a_row_follows_whatever_is_newest_until_it_is_pointed_somewhere() {
    let kept = Kept::at(None);
    for layer in crate::update::LAYERS {
        assert_eq!(kept.picked(layer), None);
    }
}

#[test]
fn what_a_row_was_left_pointed_at_is_there_after_a_restart() {
    let temp = TempDir::new("kept");
    let at = temp.path().join("update.json");

    let kept = Kept::at(Some(at.clone()));
    kept.pick(Layer::Ephemeral, Some("0.1.7".to_string()));
    kept.pick(Layer::Front, Some("0.2.0".to_string()));

    // Which is the whole of what this is for: the restart at the end of taking
    // a program is the most likely way this app ever closes.
    let after = Kept::at(Some(at));
    assert_eq!(after.picked(Layer::Ephemeral).as_deref(), Some("0.1.7"));
    assert_eq!(after.picked(Layer::Front).as_deref(), Some("0.2.0"));
    assert_eq!(after.picked(Layer::Persistent), None);
}

#[test]
fn a_machine_with_nowhere_to_write_still_remembers_for_as_long_as_it_is_open() {
    let kept = Kept::at(None);
    kept.pick(Layer::Front, Some("0.1.4".to_string()));
    assert_eq!(kept.picked(Layer::Front).as_deref(), Some("0.1.4"));
}

#[test]
fn a_row_an_older_copy_kept_does_not_cost_the_rows_this_one_draws() {
    let temp = TempDir::new("older");
    let at = temp.path().join("update.json");
    // As a copy from before the rows were named this way wrote it: cycles this
    // build no longer has, and rows under names it no longer answers to,
    // beside one it does.
    std::fs::write(
        &at,
        r#"{"cycles":{"front":"front"},"picked":{"core":"0.1.7","app":"0.2.0","front":"0.1.13"}}"#,
    )
    .expect("write what an older copy left");

    let kept = Kept::at(Some(at));
    assert_eq!(kept.picked(Layer::Front).as_deref(), Some("0.1.13"));
    assert_eq!(kept.picked(Layer::Ephemeral), None);
    assert_eq!(kept.picked(Layer::Persistent), None);
}
