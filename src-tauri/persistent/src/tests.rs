//! Both ends of the socket in one process, which is the one arrangement where a
//! test can hold the program and the window at once.

use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::time::Duration;

use serde_json::json;

use crate::session::Event;
use crate::talk::Link;
use crate::wire::Address;
use crate::{Persistent, serve};

/// A temporary directory that removes itself, so a failing test cannot leave
/// an address file behind for a real window to find.
pub(crate) struct TempDir(PathBuf);

impl TempDir {
    pub(crate) fn new(tag: &str) -> Self {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|elapsed| elapsed.as_nanos())
            .unwrap_or_default();
        let path = std::env::temp_dir().join(format!(
            "totex-persistent-{tag}-{}-{unique}",
            std::process::id()
        ));
        std::fs::create_dir_all(&path).expect("create temp dir");
        Self(path)
    }

    pub(crate) fn path(&self) -> &std::path::Path {
        &self.0
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

/// A program standing in a temporary home, and whether it has been ended.
pub(crate) fn standing(
    tag: &str,
) -> (
    TempDir,
    Arc<Persistent>,
    Arc<serve::Serving>,
    Arc<AtomicBool>,
) {
    let temp = TempDir::new(tag);
    let program = Persistent::new(Some(temp.path().to_path_buf()));
    let ended = Arc::new(AtomicBool::new(false));
    let flag = Arc::clone(&ended);
    let serving = serve::stand(
        Arc::clone(&program),
        temp.path(),
        Box::new(move || flag.store(true, Ordering::Relaxed)),
    )
    .expect("the program stands");
    (temp, program, serving, ended)
}

#[test]
fn a_window_finds_the_program_by_the_address_it_wrote() {
    let (temp, _keep, serving, _) = standing("address");
    let address = Address::read(temp.path()).expect("the address was written");
    assert_eq!(address.port, serving.port());
    assert_eq!(address.line, crate::LINE);
    assert_eq!(address.version, crate::VERSION);

    let link = Link::connect(temp.path()).expect("the window connects");
    assert_eq!(link.version(), crate::VERSION);
    assert_eq!(link.line(), crate::LINE);
    assert_eq!(serving.clients(), 1);

    let listed = link.ask("sessions", json!({})).expect("asked");
    assert_eq!(listed, json!([]));
}

#[test]
fn a_window_without_the_token_is_not_a_window() {
    let (temp, _keep, serving, _) = standing("token");
    let mut address = Address::read(temp.path()).expect("the address was written");
    address.token = "not it".to_string();
    assert!(Link::connect_to(&address).is_err());
    assert_eq!(serving.clients(), 0);
}

#[test]
fn a_question_the_program_was_never_taught_is_said_to_be_none_of_its() {
    let (temp, _keep, _serving, _) = standing("unknown");
    let link = Link::connect(temp.path()).expect("the window connects");
    let refused = link
        .ask("pty_dance", json!({}))
        .expect_err("not a question");
    assert!(refused.contains("pty_dance"), "{refused}");
}

#[test]
fn what_the_window_keeps_is_there_for_the_next_window() {
    let (temp, _keep, _serving, _) = standing("store");
    let link = Link::connect(temp.path()).expect("the window connects");
    link.ask("store_put", json!({ "name": "folders", "value": ["/a"] }))
        .expect("kept");
    drop(link);

    let next = Link::connect(temp.path()).expect("the next window connects");
    assert_eq!(
        next.ask("store_get", json!({ "name": "folders" }))
            .expect("asked"),
        json!(["/a"])
    );
    assert_eq!(
        next.ask("store_list", json!({})).expect("asked"),
        json!(["folders"])
    );
}

/// The whole reason for the arrangement: the window goes and comes back, and
/// the shell never finds out.
#[cfg(unix)]
#[test]
fn a_window_replaced_under_a_running_shell_is_a_shell_that_never_finds_out() {
    let (temp, program, serving, ended) = standing("sessions");
    let cwd = std::env::temp_dir().display().to_string();

    let first = Link::connect(temp.path()).expect("the first window connects");
    let (tx, rx) = mpsc::channel();
    first.follow(Arc::new(move |id, event| {
        if let Event::Said { data, .. } = event {
            let _ = tx.send((id.to_string(), data.to_string()));
        }
    }));
    first
        .ask(
            "open",
            json!({ "id": "kept-open", "cwd": cwd, "rows": 24, "cols": 80, "meta": "left" }),
        )
        .expect("the shell starts");
    first
        .ask(
            "write",
            json!({ "id": "kept-open", "data": "echo before-the-swap\n" }),
        )
        .expect("the shell takes input");
    assert!(
        wait_for(&rx, "before-the-swap"),
        "the shell was not answering to begin with"
    );

    // The window goes. Not `stop`: that is somebody closing the app.
    drop(first);
    let deadline = std::time::Instant::now() + Duration::from_secs(5);
    while serving.clients() > 0 && std::time::Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(20));
    }
    assert_eq!(serving.clients(), 0);
    assert!(
        !ended.load(Ordering::Relaxed),
        "the program went with the window"
    );
    assert_eq!(
        program.sessions.count(),
        1,
        "the shell went with the window"
    );

    // And the next window finds the same shell, with what it said and what
    // was left beside it.
    let second = Link::connect(temp.path()).expect("the next window connects");
    let (tx, rx) = mpsc::channel();
    second.follow(Arc::new(move |id, event| {
        if let Event::Said { data, .. } = event {
            let _ = tx.send((id.to_string(), data.to_string()));
        }
    }));
    let listed = second.ask("sessions", json!({})).expect("asked");
    assert_eq!(listed[0]["id"], json!("kept-open"));
    assert_eq!(listed[0]["meta"], json!("left"));
    let held = second
        .ask("attach", json!({ "id": "kept-open" }))
        .expect("asked");
    assert!(
        held["text"]
            .as_str()
            .is_some_and(|text| text.contains("before-the-swap")),
        "what the shell said before the swap was not kept: {held}"
    );
    second
        .ask(
            "write",
            json!({ "id": "kept-open", "data": "echo after-the-swap\n" }),
        )
        .expect("the shell still takes input");
    assert!(
        wait_for(&rx, "after-the-swap"),
        "the shell stopped answering when the window was replaced"
    );

    // Closing the app is what ends it.
    second.stop();
    assert!(second.wait_gone(Duration::from_secs(5)));
    assert!(
        ended.load(Ordering::Relaxed),
        "stop did not end the program"
    );
    assert_eq!(program.sessions.count(), 0);
}

#[test]
fn a_program_holding_nothing_goes_when_the_last_window_does() {
    let (temp, _keep, serving, ended) = standing("empty");
    let link = Link::connect(temp.path()).expect("the window connects");
    assert_eq!(serving.clients(), 1);
    drop(link);
    let deadline = std::time::Instant::now() + Duration::from_secs(5);
    while !ended.load(Ordering::Relaxed) && std::time::Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(20));
    }
    assert!(
        ended.load(Ordering::Relaxed),
        "the program stayed with nothing to hold"
    );
}

/// Waits for a run of output containing `wanted`.
#[cfg(unix)]
fn wait_for(rx: &mpsc::Receiver<(String, String)>, wanted: &str) -> bool {
    let deadline = std::time::Instant::now() + Duration::from_secs(10);
    let mut seen = String::new();
    while std::time::Instant::now() < deadline {
        if let Ok((_, chunk)) = rx.recv_timeout(Duration::from_millis(250)) {
            seen.push_str(&chunk);
            if seen.contains(wanted) {
                return true;
            }
        }
    }
    false
}
