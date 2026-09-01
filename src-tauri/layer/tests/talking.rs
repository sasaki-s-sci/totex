//! The two ends of the conversation, run against each other.
//!
//! Everything else about the layer can be tested by calling it. This cannot:
//! what is being checked here is that the program the release ships and the
//! code that asks it things agree — about what a question looks like, about
//! what an answer looks like, and about what happens to a question that is
//! neither. So the program is started, for real, and asked.
//!
//! `CARGO_BIN_EXE_totex-layer` is cargo saying where it put the binary it built
//! for this test, which is why these live out here rather than beside the code.

use std::path::Path;

use serde_json::json;
use totex_layer::{Running, VERSION};

/// The layer as a release ships it, started and shaken hands with.
fn started() -> Running {
    Running::start(Path::new(env!("CARGO_BIN_EXE_totex-layer")), VERSION)
        .expect("the layer this test was built beside")
}

#[test]
fn a_layer_of_its_own_answers_what_the_built_in_copy_answers() {
    let layer = started();
    let temp = std::env::temp_dir().to_string_lossy().into_owned();

    let asked = layer
        .ask(
            "read_directory",
            json!({ "path": temp, "show_hidden": false }),
        )
        .expect("the layer answers to that name")
        .expect("the temporary directory is readable");
    assert!(asked["entries"].is_array());
    assert!(asked["path"].is_string());
}

#[test]
fn a_question_the_layer_does_not_know_comes_back_with_its_arguments() {
    let layer = started();
    let with = json!({ "session": "abc" });
    let handed_back = layer
        .ask("pty_write", with.clone())
        .expect_err("a layer does not run terminals");
    assert_eq!(
        handed_back, with,
        "the arguments come back so the program above can ask itself"
    );
}

#[test]
fn a_question_that_went_wrong_comes_back_as_what_went_wrong() {
    let layer = started();
    let said = layer
        .ask(
            "read_directory",
            json!({ "path": "/no/such/place", "show_hidden": false }),
        )
        .expect("the layer answers to that name");
    assert!(said.is_err(), "there is no such directory");
}

#[test]
fn a_layer_that_says_it_is_something_else_is_not_started() {
    let refused = Running::start(Path::new(env!("CARGO_BIN_EXE_totex-layer")), "9.9.9")
        .expect_err("that is not the version under that name");
    assert!(refused.contains("9.9.9"), "{refused}");
}

#[test]
fn a_program_that_is_not_a_layer_is_not_waited_on_forever() {
    let refused = Running::start(Path::new("/no/such/program"), VERSION)
        .expect_err("there is no such program");
    assert!(!refused.is_empty());
}

#[test]
fn questions_asked_at_once_come_back_to_the_one_that_asked_them() {
    let layer = std::sync::Arc::new(started());
    let asking: Vec<_> = (0..8)
        .map(|which| {
            let layer = std::sync::Arc::clone(&layer);
            std::thread::spawn(move || {
                let name = format!("totex-layer-test-{which}");
                let made = layer
                    .ask(
                        "fs_create_entry",
                        json!({
                            "parent": std::env::temp_dir().to_string_lossy(),
                            "name": name,
                            "directory": true,
                        }),
                    )
                    .expect("the layer answers to that name");
                (which, made)
            })
        })
        .collect();

    for thread in asking {
        let (which, made) = thread.join().expect("the thread finished");
        let made = made.expect("the directory was made");
        let path = made.as_str().expect("a path");
        assert!(
            path.ends_with(&format!("totex-layer-test-{which}")),
            "{which} was answered with {path}"
        );
        let _ = std::fs::remove_dir_all(path);
    }
}

/// A program something else is still holding open for writing.
///
/// The race a layer being taken runs into. The program is written and then run,
/// and everything the app spawned in between — a terminal, a `git` — is a fork
/// that inherited the write handle for as long as it takes to reach its own
/// `exec`. Unix will not run a file in that state, and the state ends without
/// anybody doing anything about it, so the start waits it out instead of
/// turning the layer down for something that is not about the layer.
///
/// Held open here for longer than a start would take, so that a start which did
/// not wait could not pass this by being quick.
#[cfg(unix)]
#[test]
fn a_program_still_held_open_for_writing_is_waited_for_rather_than_refused() {
    use std::os::unix::fs::PermissionsExt as _;

    let copy = std::env::temp_dir().join(format!("totex-layer-busy-{}", std::process::id()));
    std::fs::copy(env!("CARGO_BIN_EXE_totex-layer"), &copy).expect("a copy of the layer");
    std::fs::set_permissions(&copy, std::fs::Permissions::from_mode(0o755)).expect("a program");

    let holding = std::fs::OpenOptions::new()
        .write(true)
        .open(&copy)
        .expect("hold it open for writing");
    let held = std::time::Duration::from_millis(120);
    let letting_go = std::thread::spawn(move || {
        std::thread::sleep(held);
        drop(holding);
    });

    let started = std::time::Instant::now();
    let layer = Running::start(&copy, VERSION).expect("the start waited the handle out");
    let waited = started.elapsed();
    letting_go.join().expect("the thread let go");

    // If it came back before the handle was let go of, the file was never in
    // the way and this test would pass without having asked anything.
    assert!(
        waited >= held,
        "the start returned in {waited:?}, before the write handle was closed"
    );

    // And what it started is a layer, not merely a process that ran.
    let asked = layer
        .ask(
            "read_directory",
            json!({ "path": std::env::temp_dir().to_string_lossy(), "show_hidden": false }),
        )
        .expect("the layer answers to that name")
        .expect("the temporary directory is readable");
    assert!(asked["entries"].is_array());

    let _ = std::fs::remove_file(&copy);
}
