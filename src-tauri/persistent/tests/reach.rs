//! The program as a release ships it: started by a window as nobody's child,
//! found by the next window, and outliving the one that started it.
//!
//! Everything in `src/tests.rs` holds both ends in one process. This is the one
//! that cannot: what is being checked is that the program comes up on its own,
//! writes where it is, answers a window that was not the one that started it,
//! and goes when it is told to.

use std::path::PathBuf;
use std::time::Duration;

use serde_json::json;
use totex_persistent::talk::{Link, Missing};
use totex_persistent::wire::Address;

/// A temporary directory that removes itself, so a failing test cannot leave
/// an address file behind for a real window to find.
struct TempDir(PathBuf);

impl TempDir {
    fn new(tag: &str) -> Self {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|elapsed| elapsed.as_nanos())
            .unwrap_or_default();
        let path =
            std::env::temp_dir().join(format!("totex-reach-{tag}-{}-{unique}", std::process::id()));
        std::fs::create_dir_all(&path).expect("create temp dir");
        Self(path)
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

/// The program cargo built beside this test.
fn program() -> PathBuf {
    PathBuf::from(env!("CARGO_BIN_EXE_totex-persistent"))
}

#[test]
fn a_window_starts_the_program_and_the_next_window_finds_it() {
    let temp = TempDir::new("start");
    let home = &temp.0;
    assert!(
        matches!(Link::connect(home), Err(Missing::Nobody)),
        "nobody should be there yet"
    );

    let first = Link::reach(home, &program()).expect("the program comes up");
    assert_eq!(first.version(), totex_persistent::VERSION);
    let address = Address::read(home).expect("the address was written");
    assert_ne!(
        address.pid,
        std::process::id(),
        "it is a program of its own"
    );

    // Something for it to hold, so that the first window leaving is not the
    // program's cue to go.
    #[cfg(unix)]
    first
        .ask(
            "open",
            json!({ "id": "held", "cwd": std::env::temp_dir(), "rows": 24, "cols": 80 }),
        )
        .expect("a shell starts");
    first
        .ask("store_put", json!({ "name": "note", "value": "left" }))
        .expect("kept");
    drop(first);

    // The next window, which did not start it, finds the same program.
    let second = Link::reach(home, &program()).expect("the program is found");
    assert_eq!(
        Address::read(home).expect("the address").pid,
        address.pid,
        "a second program was started beside the first"
    );
    assert_eq!(
        second
            .ask("store_get", json!({ "name": "note" }))
            .expect("asked"),
        json!("left")
    );
    #[cfg(unix)]
    {
        let listed = second.ask("sessions", json!({})).expect("asked");
        assert_eq!(
            listed[0]["id"],
            json!("held"),
            "the shell went with the window"
        );
    }

    // Closing the app is what ends it.
    second.stop();
    assert!(
        second.wait_gone(Duration::from_secs(5)),
        "stop did not end it"
    );
    let deadline = std::time::Instant::now() + Duration::from_secs(5);
    while std::time::Instant::now() < deadline {
        if matches!(Link::connect(home), Err(Missing::Nobody)) {
            return;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    panic!("the program is still answering after stop");
}

/// The one press that replaces the program while a window is open: what was
/// running is stopped, shells and all, and the one the window names is
/// started in its place.
#[test]
fn a_window_can_restart_the_program_and_the_shells_go_with_the_old_one() {
    let temp = TempDir::new("restart");
    let home = &temp.0;

    let first = Link::reach(home, &program()).expect("the program comes up");
    let before = Address::read(home).expect("the address").pid;
    #[cfg(unix)]
    first
        .ask(
            "open",
            json!({ "id": "held", "cwd": std::env::temp_dir(), "rows": 24, "cols": 80 }),
        )
        .expect("a shell starts");
    first
        .ask("store_put", json!({ "name": "note", "value": "left" }))
        .expect("kept");

    let second = Link::restart(home, &program()).expect("a program starts in its place");
    assert!(
        first.wait_gone(Duration::from_secs(5)),
        "the first program is still answering the old link"
    );
    let after = Address::read(home).expect("the address").pid;
    assert_ne!(before, after, "the same program is still running");
    let listed = second.ask("sessions", json!({})).expect("asked");
    assert!(
        listed.as_array().is_some_and(Vec::is_empty),
        "a shell came across: {listed}"
    );
    // The store is on disk and not in the program, so it is still there.
    assert_eq!(
        second
            .ask("store_get", json!({ "name": "note" }))
            .expect("asked"),
        json!("left")
    );

    second.stop();
    assert!(
        second.wait_gone(Duration::from_secs(5)),
        "stop did not end it"
    );
}
