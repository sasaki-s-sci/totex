//! The road an agent's report travels, from the door to the window.

use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpStream;
use std::sync::mpsc;
use std::time::{Duration, Instant};

use serde_json::{Value, json};
use tauri::test::{MockRuntime, mock_builder, mock_context, noop_assets};
use tauri::{AppHandle, Listener};

use super::*;

fn mock_app() -> tauri::App<MockRuntime> {
    let app = mock_builder()
        .manage(PtyState::default())
        .manage(McpState::default())
        .build(mock_context(noop_assets()))
        .expect("mock app");
    attend(app.handle());
    app
}

/// One request at the door, answered the way an agent's client would read it.
///
/// A connection per message rather than one kept open: what is being tested is
/// what comes back, and a client that reconnects is a client the server has to
/// be able to take anyway.
fn post(url: &str, message: &Value) -> (String, Value) {
    let rest = url.strip_prefix("http://").expect("an http address");
    let (host, path) = rest.split_once('/').expect("a path");
    let body = message.to_string();

    let mut stream = TcpStream::connect(host).expect("the door is open");
    stream
        .write_all(
            format!(
                "POST /{path} HTTP/1.1\r\nHost: {host}\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{body}",
                body.len()
            )
            .as_bytes(),
        )
        .expect("the request goes");

    let mut reading = BufReader::new(stream);
    let mut status = String::new();
    reading.read_line(&mut status).expect("an answer");

    let mut length = 0usize;
    loop {
        let mut header = String::new();
        reading.read_line(&mut header).expect("a header");
        let header = header.trim_end();
        if header.is_empty() {
            break;
        }
        if let Some((name, value)) = header.split_once(':')
            && name.trim().eq_ignore_ascii_case("content-length")
        {
            length = value.trim().parse().expect("a length");
        }
    }

    let mut said = vec![0; length];
    reading.read_exact(&mut said).expect("the whole answer");
    let said = if said.is_empty() {
        Value::Null
    } else {
        serde_json::from_slice(&said).expect("json")
    };
    (status.trim().to_string(), said)
}

/// Opens a shell and hands back the address its agent would be given.
#[cfg(unix)]
fn session(app: &AppHandle<MockRuntime>, id: &str) -> String {
    let cwd = std::env::temp_dir().display().to_string();
    pty::pty_open(app.clone(), id.to_string(), cwd.clone(), 24, 80, None).expect("a shell starts");
    serve(app).expect("the server stands up");
    address(app, id, &cwd).expect("the session has an address")
}

fn reported(app: &AppHandle<MockRuntime>, id: &str) -> Option<Report> {
    reports(app)
        .into_iter()
        .find(|said| said.id == id)
        .and_then(|said| said.report)
}

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

    pty::pty_close(handle.clone(), id);
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
    pty::pty_open(handle.clone(), two.clone(), cwd.clone(), 24, 80, None).expect("a shell starts");
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
    pty::pty_close(handle.clone(), one.clone());
    let (status, _) = post(&first, &call);
    assert_eq!(status, "HTTP/1.1 404 Not Found");
    assert!(reported(&handle, &one).is_none(), "the report outlived it");

    pty::pty_close(handle.clone(), two);
    unserve(&handle);
}

/// What is kept is what a card can draw: one line, and a list that is a list.
#[test]
fn what_arrives_is_cut_to_what_is_shown() {
    let app = mock_app();
    let handle = app.handle().clone();

    let answer = rpc::answer(
        &handle,
        "nobody",
        json!({"jsonrpc":"2.0","id":1,"method":"tools/call","params":{
            "name":"report",
            "arguments":{
                "doing":"  reading   the layout\n  and moving it  ",
                "steps":[{"title":"one","done":true},{"title":"   ","done":false}],
            },
        }})
        .to_string()
        .as_bytes(),
    )
    .expect("a call is answered");
    assert!(answer["result"]["isError"].is_null());

    let said = reported(&handle, "nobody").expect("it was kept");
    assert_eq!(said.doing, "reading the layout and moving it");
    assert_eq!(said.steps.len(), 1, "a step with no title is not a step");

    // A message with no id is a client telling rather than asking, and there is
    // nothing to send back.
    assert!(
        rpc::answer(
            &handle,
            "nobody",
            br#"{"jsonrpc":"2.0","method":"notifications/initialized"}"#,
        )
        .is_none()
    );

    // The door is shut, and nothing is left standing that cannot be corrected.
    unserve(&handle);
    assert!(reported(&handle, "nobody").is_none());
}

/// The switch is a switch, and not a way of cutting off every agent that is
/// already running.
///
/// A terminal is handed its address as it starts and never again, so an address
/// has to go on meaning the same thing for as long as the terminal does. Off
/// and on again is the whole of the test: the same door, in the same wall, with
/// the same name on it.
#[cfg(unix)]
#[test]
fn switching_the_server_off_and_on_leaves_the_addresses_where_they_were() {
    let app = mock_app();
    let handle = app.handle().clone();
    let id = "kept".to_string();
    let cwd = std::env::temp_dir().display().to_string();
    let before = session(&handle, &id);

    unserve(&handle);
    serve(&handle).expect("the server stands again");

    let after = address(&handle, &id, &cwd).expect("the session still has one");
    assert_eq!(
        before, after,
        "a terminal was left holding the wrong address"
    );

    let (status, called) = post(
        &before,
        &json!({"jsonrpc":"2.0","id":1,"method":"tools/call","params":{
            "name":"report","arguments":{"doing":"still here"},
        }}),
    );
    assert_eq!(status, "HTTP/1.1 200 OK");
    assert!(called["result"]["isError"].is_null());
    assert_eq!(
        reported(&handle, &id).map(|said| said.doing),
        Some("still here".to_string())
    );

    pty::pty_close(handle.clone(), id);
    unserve(&handle);
}

/// The registration reaches the agent as an address and not as a quoted one.
///
/// The line is handed to a shell to be run, and the two shells it is run
/// through do not read the same quotes: a POSIX shell takes the single ones off
/// and leaves the variable for the agent to expand, and `cmd` has none — it
/// would hand the agent the quotes as part of the address, which is a
/// registration that can only ever fail to connect.
#[test]
fn the_registration_is_quoted_the_way_the_shell_running_it_reads() {
    let posix = install::line('\'');
    assert!(
        posix.ends_with(&format!("'${{{ADDRESS_VAR}}}'")),
        "a POSIX shell was handed {posix}"
    );

    let windows = install::line('"');
    assert!(
        windows.ends_with(&format!("\"${{{ADDRESS_VAR}}}\"")),
        "cmd was handed {windows}"
    );
}
