//! The three rows, asked for the way the window asks for them.

use crate::release::Cycles;
use crate::update::Layer;

use super::{TempDir, asked, window};

/// The names the settings page sends -- see `src/lib/update` and
/// `src/components/settings/UpdateSection.tsx`.
pub(super) const SENT: [&str; 6] = [
    "update_standing",
    "update_take",
    "update_pick",
    "update_follow",
    "update_choices",
    "confirm_front",
];

/// That the app is built to answer every one of them.
///
/// The list a window sends and the list an app is built with are two lists, and
/// nothing between them is checked by anything: a command written, exported and
/// never added to the second list is a row that draws, presses, and is never
/// answered. Everything else in this file asks through a list of its own, so
/// this is the one check that the app's own list is a superset of it -- read out
/// of the source, because the list is a macro and there is nothing else of it
/// left to ask at runtime.
#[test]
fn every_command_a_row_sends_is_one_the_app_answers() {
    let built = include_str!("../../lib.rs");
    let handler = built
        .split_once("tauri::generate_handler![")
        .expect("the app is built with a list of commands")
        .1;
    let handler = handler.split_once("])").expect("the end of the list").0;
    for command in SENT {
        assert!(
            handler.lines().any(|line| {
                let named = line.trim().trim_end_matches(',');
                named == command || named.ends_with(&format!("::{command}"))
            }),
            "the window sends {command} and the app is not built to answer it"
        );
    }
}

#[test]
fn a_window_is_told_about_three_layers_and_what_each_is_at() {
    let temp = TempDir::new("rows");
    let (_app, view) = window(temp.path());

    let rungs = asked(&view, "update_standing", serde_json::json!({}))
        .expect("the rows the settings page draws");
    let rungs = rungs.as_array().expect("one entry per layer");
    assert_eq!(rungs.len(), 3);
    assert_eq!(rungs[0]["layer"], "front");
    assert_eq!(rungs[1]["layer"], "app");
    assert_eq!(rungs[2]["layer"], "core");

    // What is in place. The layer's is the one that can move without a reload
    // or a restart, so it is the one worth reading off a row at all.
    assert_eq!(rungs[1]["at"], totex_layer::VERSION);
    assert_eq!(rungs[2]["at"], env!("CARGO_PKG_VERSION"));
    assert_eq!(rungs[1]["protocol"], totex_layer::PROTOCOL);
    assert_eq!(rungs[2]["protocol"], totex_layer::PROTOCOL);
    assert_eq!(rungs[2]["frontContract"], crate::front::take::contract());
    for rung in rungs {
        assert_eq!(
            rung["cycle"], "release",
            "every row starts on the app's own"
        );
        assert_eq!(rung["picked"], serde_json::Value::Null);
        assert!(rung["can"].is_boolean());
    }
}

#[test]
fn what_a_row_is_pointed_at_is_asked_for_and_answered_by_name() {
    let temp = TempDir::new("pointed");
    let (_app, view) = window(temp.path());

    asked(
        &view,
        "update_pick",
        serde_json::json!({ "layer": Layer::App, "version": "0.2.0" }),
    )
    .expect("a row can be pointed at a version");
    asked(
        &view,
        "update_follow",
        serde_json::json!({ "layer": Layer::App, "cycle": Cycles::Layer }),
    )
    .expect("and at a cycle of releases");

    let rungs = asked(&view, "update_standing", serde_json::json!({})).expect("the rows again");
    let app_row = &rungs.as_array().expect("three rows")[1];
    assert_eq!(app_row["cycle"], "layer");
    // Moving a row to another cycle lets go of the version it was naming: 0.2.0
    // of one cycle is not 0.2.0 of another.
    assert_eq!(app_row["picked"], serde_json::Value::Null);
}

#[test]
fn a_press_reaches_the_layer_it_names() {
    let temp = TempDir::new("press");
    let (_app, view) = window(temp.path());

    // The endpoint this app is built with is a port nothing is listening on,
    // so what comes back is the release page not answering -- which is the
    // press having reached the backend, been dispatched to the right layer,
    // and got as far as the network.
    for layer in ["front", "app", "core"] {
        let answered = asked(
            &view,
            "update_take",
            serde_json::json!({ "layer": layer, "version": "0.1.9", "coming": "__CHANNEL__:1" }),
        );
        match answered {
            Err(said) => assert!(
                said.as_str().is_some_and(|said| said.contains("127.0.0.1")
                    || said.contains("did not answer")
                    || said.contains("release page")),
                "{layer}: {said}"
            ),
            // A copy that cannot take that layer at all says so without asking
            // anybody anything, which is the other right answer here.
            Ok(took) => assert_eq!(took, "held", "{layer}"),
        }
    }
}

#[test]
fn compatible_choices_are_asked_for_in_one_go() {
    let temp = TempDir::new("versions");
    let (_app, view) = window(temp.path());

    // Nothing answers the listing here, and the answer to that is an empty
    // list rather than a failure: a pull-down that cannot be filled is a row
    // that still works, pointed at whatever the release page says is newest.
    let found = asked(
        &view,
        "update_choices",
        serde_json::json!({ "cycles": ["release", "layer"] }),
    )
    .expect("asking is not a failure");
    assert!(found.as_array().is_some_and(|found| found.is_empty()));
}
