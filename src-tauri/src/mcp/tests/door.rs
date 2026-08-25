//! A report crossing from an agent's door to the window, and the address it
//! crossed at.

use serde_json::{Value, json};
use std::sync::mpsc;
use std::time::{Duration, Instant};
use tauri::Listener;

use super::super::*;
use super::{mock_app, post, reported, session};
use crate::pty;

/// The whole way through: an agent connects at the address its terminal was
/// started with, says what it is doing, and the window is told — without
/// anything having been read off a screen, and without a terminal having been
/// opened for it.
#[cfg(unix)]
#[test]
fn a_report_travels_from_the_door_to_the_window() {
    let app = mock_app();
    let handle = app.handle().clone();
    let id = "working".to_string();
    let url = session(&handle, &id);

    let (tx, rx) = mpsc::channel();
    handle.listen(REPORT_EVENT, move |event| {
        let _ = tx.send(event.payload().to_string());
    });

    let (status, hello) = post(
        &url,
        &json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18"}}),
    );
    assert_eq!(status, "HTTP/1.1 200 OK");
    assert_eq!(hello["result"]["serverInfo"]["name"], json!("totex"));
    assert!(
        hello["result"]["instructions"].is_string(),
        "an agent is told what the server is for"
    );

    let (_, listed) = post(&url, &json!({"jsonrpc":"2.0","id":2,"method":"tools/list"}));
    assert_eq!(listed["result"]["tools"][0]["name"], json!("report"));

    let (_, called) = post(
        &url,
        &json!({"jsonrpc":"2.0","id":3,"method":"tools/call","params":{
            "name":"report",
            "arguments":{"doing":"rewriting the session layout","steps":[
                {"title":"read the layout","done":true},
                {"title":"move the stack","done":false},
            ]},
        }}),
    );
    assert!(
        called["result"]["isError"].is_null(),
        "the tool was refused"
    );

    let said = reported(&handle, &id).expect("the window holds the report");
    assert_eq!(said.doing, "rewriting the session layout");
    assert_eq!(said.steps.len(), 2);
    assert!(said.steps[0].done);

    let deadline = Instant::now() + Duration::from_secs(5);
    let told = loop {
        assert!(Instant::now() < deadline, "the window was never told");
        if let Ok(payload) = rx.recv_timeout(Duration::from_millis(250)) {
            let told: Value = serde_json::from_str(&payload).expect("an event");
            if told["report"].is_object() {
                break told;
            }
        }
    };
    assert_eq!(told["id"], json!(id));
    assert_eq!(
        told["report"]["doing"],
        json!("rewriting the session layout")
    );

    // Nothing to show is a card taken away, rather than an empty one left
    // standing.
    post(
        &url,
        &json!({"jsonrpc":"2.0","id":4,"method":"tools/call","params":{
            "name":"report","arguments":{"doing":""},
        }}),
    );
    assert!(reported(&handle, &id).is_none());

    pty::control::pty_close(handle.clone(), id);
    unserve(&handle);
}

/// A report belongs to the session that made it, and a door with no session
/// behind it is not a door at all.
#[cfg(unix)]
#[test]
fn an_address_is_one_session_s_own() {
    let app = mock_app();
    let handle = app.handle().clone();
    let one = "first".to_string();
    let two = "second".to_string();

    let first = session(&handle, &one);
    let cwd = std::env::temp_dir().display().to_string();
    pty::spawn::pty_open(handle.clone(), two.clone(), cwd.clone(), 24, 80, None)
        .expect("a shell starts");
    let second = address(&handle, &two, &cwd).expect("the second has one too");
    assert_ne!(first, second, "two sessions were handed one address");

    let call = json!({"jsonrpc":"2.0","id":1,"method":"tools/call","params":{
        "name":"report","arguments":{"doing":"the first one's work"},
    }});
    post(&first, &call);

    assert_eq!(
        reported(&handle, &one).map(|said| said.doing),
        Some("the first one's work".to_string())
    );
    assert!(
        reported(&handle, &two).is_none(),
        "a report landed on the wrong session"
    );

    // And a session that has ended stops answering its own door, without
    // anything having to be told to forget it.
    pty::control::pty_close(handle.clone(), one.clone());
    let (status, _) = post(&first, &call);
    assert_eq!(status, "HTTP/1.1 404 Not Found");
    assert!(reported(&handle, &one).is_none(), "the report outlived it");

    pty::control::pty_close(handle.clone(), two);
    unserve(&handle);
}
