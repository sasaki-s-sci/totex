//! A report crossing from an agent's door to whoever is listening, and the
//! address it crossed at.

use serde_json::{Value, json};
use std::sync::mpsc;
use std::time::{Duration, Instant};

use super::super::*;
use super::{addressed, keep, knock, post, reported, session};

/// The whole way through: an agent connects at the address its terminal was
/// started with, says what it is doing, and the listener is told — without
/// anything having been read off a screen, and without a terminal having been
/// opened for it.
#[cfg(unix)]
#[test]
fn a_report_travels_from_the_door_to_the_listener() {
    let keep = keep();
    let id = "working";
    let url = session(&keep, id);

    let (tx, rx) = mpsc::channel();
    keep.door.follow(Arc::new(move |reported| {
        let _ = tx.send(serde_json::to_value(reported).expect("json"));
    }));

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

    let said = reported(&keep.door, id).expect("the door holds the report");
    assert_eq!(said.doing, "rewriting the session layout");
    assert_eq!(said.steps.len(), 2);
    assert!(said.steps[0].done);

    let deadline = Instant::now() + Duration::from_secs(5);
    let told = loop {
        assert!(Instant::now() < deadline, "the listener was never told");
        if let Ok(told) = rx.recv_timeout(Duration::from_millis(250)) {
            let told: Value = told;
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
    assert!(reported(&keep.door, id).is_none());

    keep.sessions.close(id);
    keep.door.unserve();
}

/// A report belongs to the session that made it, and a door with no session
/// behind it is not a door at all.
#[cfg(unix)]
#[test]
fn an_address_is_one_session_s_own() {
    let keep = keep();
    let one = "first";
    let two = "second";

    let first = session(&keep, one);
    let cwd = std::env::temp_dir().display().to_string();
    keep.sessions
        .open(two, &cwd, 24, 80, None)
        .expect("a shell starts");
    let second = addressed(&keep.door, two, &cwd).expect("the second has one too");
    assert_ne!(first, second, "two sessions were handed one address");

    let call = json!({"jsonrpc":"2.0","id":1,"method":"tools/call","params":{
        "name":"report","arguments":{"doing":"the first one's work"},
    }});
    post(&first, &call);

    assert_eq!(
        reported(&keep.door, one).map(|said| said.doing),
        Some("the first one's work".to_string())
    );
    assert!(
        reported(&keep.door, two).is_none(),
        "a report landed on the wrong session"
    );

    // And a session that has ended stops answering its own door, without
    // anything having to be told to forget it.
    keep.sessions.close(one);
    let (status, _) = post(&first, &call);
    assert_eq!(status, "HTTP/1.1 404 Not Found");
    assert!(
        reported(&keep.door, one).is_none(),
        "the report outlived it"
    );

    keep.sessions.close(two);
    keep.door.unserve();
}

/// The other way in, for the agent that could not be given a door of its own.
///
/// An address written into that agent's settings is a literal, so it is
/// registered against the one door and hands the token over in the request
/// instead. What it reaches is the same session as the address would have
/// reached — and the door is a door and not an opening: without the token, or
/// with one that is nobody's, there is nothing behind it.
#[cfg(unix)]
#[test]
fn the_one_door_answers_for_the_session_the_request_names() {
    let keep = keep();
    let id = "named-in-the-request";
    let own = session(&keep, id);
    let (host, token) = own
        .strip_prefix("http://")
        .and_then(|rest| rest.split_once("/s/"))
        .expect("a session's own address");
    let door = format!("http://{host}{DOOR_PATH}");

    let call = json!({"jsonrpc":"2.0","id":1,"method":"tools/call","params":{
        "name":"report","arguments":{"doing":"talking through the one door"},
    }});

    let (status, called) = knock(&door, &call, Some(token));
    assert_eq!(status, "HTTP/1.1 200 OK");
    assert!(
        called["result"]["isError"].is_null(),
        "the tool was refused"
    );
    assert_eq!(
        reported(&keep.door, id).map(|said| said.doing),
        Some("talking through the one door".to_string())
    );

    let (status, _) = knock(&door, &call, None);
    assert_eq!(
        status, "HTTP/1.1 404 Not Found",
        "the door answered to nobody in particular"
    );

    let (status, _) = knock(&door, &call, Some("0000000000000000"));
    assert_eq!(
        status, "HTTP/1.1 404 Not Found",
        "the door answered to a token it never handed out"
    );

    keep.sessions.close(id);
    keep.door.unserve();
}
