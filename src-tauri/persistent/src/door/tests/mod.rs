//! The road an agent's report travels, from the door to whoever is listening.

mod door;
mod install;
mod restart;
mod shape;

use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpStream;
use std::sync::Arc;

use serde_json::Value;

use super::*;
use crate::Persistent;

pub(super) fn held() -> Arc<Persistent> {
    Persistent::new(None)
}

/// One request at the door, answered the way an agent's client would read it.
///
/// A connection per message rather than one kept open: what is being tested is
/// what comes back, and a client that reconnects is a client the server has to
/// be able to take anyway.
pub(super) fn post(url: &str, message: &Value) -> (String, Value) {
    knock(url, message, None)
}

/// The same, with the session named in the request instead of only in the
/// address — which is the whole of what an agent that could not be given a door
/// of its own has to say who it is with.
pub(super) fn knock(url: &str, message: &Value, bearer: Option<&str>) -> (String, Value) {
    let rest = url.strip_prefix("http://").expect("an http address");
    let (host, path) = rest.split_once('/').expect("a path");
    let body = message.to_string();
    let named = match bearer {
        Some(token) => format!("Authorization: Bearer {token}\r\n"),
        None => String::new(),
    };

    let mut stream = TcpStream::connect(host).expect("the door is open");
    stream
        .write_all(
            format!(
                "POST /{path} HTTP/1.1\r\nHost: {host}\r\n{named}Content-Type: application/json\r\nContent-Length: {}\r\n\r\n{body}",
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
pub(super) fn session(held: &Persistent, id: &str) -> String {
    let cwd = std::env::temp_dir().display().to_string();
    held.sessions
        .open(id, &cwd, 24, 80, None)
        .expect("a shell starts");
    held.door.serve().expect("the server stands up");
    addressed(&held.door, id, &cwd).expect("the session has an address")
}

/// The address a session working in `cwd` would be started with, read out of
/// what it is actually dressed with rather than worked out again beside it.
pub(super) fn addressed(door: &Door, id: &str, cwd: &str) -> Option<String> {
    address::dressing(door, id, cwd)
        .into_iter()
        .find(|(name, _)| name == ADDRESS_VAR)
        .map(|(_, url)| url)
}

pub(super) fn reported(door: &Door, id: &str) -> Option<Report> {
    door.reports()
        .into_iter()
        .find(|said| said.id == id)
        .and_then(|said| said.report)
}
