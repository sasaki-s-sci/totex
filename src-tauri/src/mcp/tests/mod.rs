//! The road an agent's report travels, from the door to the window.

mod door;
mod install;
mod restart;
mod shape;

use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpStream;

use serde_json::Value;
use tauri::AppHandle;
use tauri::test::{MockRuntime, mock_builder, mock_context, noop_assets};

use super::*;
use crate::pty::{self, PtyState};

pub(super) fn mock_app() -> tauri::App<MockRuntime> {
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
pub(super) fn post(url: &str, message: &Value) -> (String, Value) {
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
pub(super) fn session(app: &AppHandle<MockRuntime>, id: &str) -> String {
    let cwd = std::env::temp_dir().display().to_string();
    pty::spawn::pty_open(app.clone(), id.to_string(), cwd.clone(), 24, 80, None)
        .expect("a shell starts");
    serve(app).expect("the server stands up");
    address(app, id, &cwd).expect("the session has an address")
}

pub(super) fn reported(app: &AppHandle<MockRuntime>, id: &str) -> Option<Report> {
    reports(app)
        .into_iter()
        .find(|said| said.id == id)
        .and_then(|said| said.report)
}
