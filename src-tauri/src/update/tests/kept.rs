//! What the app remembers about updating itself, remembered by the app.

use crate::release::Cycles;
use crate::update::{Kept, Layer};

use super::TempDir;

#[test]
fn a_layer_follows_the_apps_own_cycle_until_it_is_told_otherwise() {
    let kept = Kept::at(None);
    for layer in crate::update::LAYERS {
        assert_eq!(kept.cycle(layer), Cycles::Release);
        assert_eq!(kept.picked(layer), None);
    }
}

#[test]
fn what_a_row_was_left_pointed_at_is_there_after_a_restart() {
    let temp = TempDir::new("kept");
    let at = temp.path().join("update.json");

    let kept = Kept::at(Some(at.clone()));
    kept.pick(Layer::Core, Some("0.1.7".to_string()));
    kept.follow(Layer::Front, Cycles::Front);
    kept.pick(Layer::Front, Some("0.2.0".to_string()));

    // Which is the whole of what this is for: the restart at the end of taking
    // a program is the most likely way this app ever closes.
    let after = Kept::at(Some(at));
    assert_eq!(after.picked(Layer::Core).as_deref(), Some("0.1.7"));
    assert_eq!(after.cycle(Layer::Front), Cycles::Front);
    assert_eq!(after.picked(Layer::Front).as_deref(), Some("0.2.0"));
    assert_eq!(after.cycle(Layer::Core), Cycles::Release);
}

#[test]
fn changing_which_releases_a_row_looks_at_lets_go_of_the_one_it_named() {
    let kept = Kept::at(None);
    kept.pick(Layer::Front, Some("0.1.9".to_string()));
    kept.follow(Layer::Front, Cycles::Front);
    // 0.1.9 of the app's own cycle is not 0.1.9 of the pages', and a row left
    // naming it would take something nobody asked for.
    assert_eq!(kept.picked(Layer::Front), None);
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
    // As a copy that drew a third row wrote it: a layer this build has no name
    // for, on a cycle this build has no name for either.
    std::fs::write(
        &at,
        r#"{"cycles":{"app":"layer","front":"front"},"picked":{"app":"0.2.0","core":"0.1.7"}}"#,
    )
    .expect("write what an older copy left");

    let kept = Kept::at(Some(at));
    assert_eq!(kept.cycle(Layer::Front), Cycles::Front);
    assert_eq!(kept.picked(Layer::Core).as_deref(), Some("0.1.7"));
    assert_eq!(kept.picked(Layer::Front), None);
}
