//! Just enough HTTP to be an MCP endpoint: one request read off a socket, and
//! one answer written back.

use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpStream;

use tauri::{AppHandle, Runtime};

use super::rpc;

/// The longest a request line or a header may be.
const LINE_LIMIT: u64 = 8 * 1024;

/// How many headers are read before the request is refused.
const HEADER_LIMIT: usize = 64;

/// The most a message may be. A report is a sentence and a short list, and
/// reading a hundred times that into memory because somebody said it was coming
/// is the one thing a listener must not do.
const BODY_LIMIT: usize = 256 * 1024;

/// What is being asked, out of one request.
pub(super) struct Request {
    pub method: String,
    pub target: String,
    /// Whether a browser sent this.
    ///
    /// Nothing that belongs here ever sets it: an agent is a program with an
    /// address, not a page somebody was shown. A page that has been told this
    /// machine's name resolves somewhere else and then talks to the loopback
    /// server behind it is the one attack a loopback door is open to, and
    /// refusing everything that carries this is the whole of the defence
    /// against it.
    pub from_page: bool,
    pub body: Vec<u8>,
}

pub(super) enum Taken {
    Message(Request),
    /// The read timed out with nothing said, which is not the end of anything.
    Waiting,
    /// The connection is finished, or was never going to be understood.
    Done,
}

/// Reads one request off the connection.
pub(super) fn take(reading: &mut BufReader<TcpStream>) -> Taken {
    let mut start = String::new();
    match reading.by_ref().take(LINE_LIMIT).read_line(&mut start) {
        Ok(0) => return Taken::Done,
        Ok(_) => {}
        // A timeout on an empty line is a connection nobody is using yet; the
        // same error part way through a request is a request that will never
        // arrive, and the bytes already read cannot be put back.
        Err(error) if timed_out(&error) && start.is_empty() => return Taken::Waiting,
        Err(_) => return Taken::Done,
    }

    let mut words = start.split_whitespace();
    let (Some(method), Some(target)) = (words.next(), words.next()) else {
        return Taken::Done;
    };
    let method = method.to_string();
    let target = target.to_string();

    let mut length = 0usize;
    let mut from_page = false;
    for _ in 0..HEADER_LIMIT {
        let mut header = String::new();
        match reading.by_ref().take(LINE_LIMIT).read_line(&mut header) {
            Ok(0) => return Taken::Done,
            Ok(_) => {}
            Err(_) => return Taken::Done,
        }
        let header = header.trim_end();
        if header.is_empty() {
            let mut body = vec![0; length.min(BODY_LIMIT)];
            if length > BODY_LIMIT || reading.read_exact(&mut body).is_err() {
                return Taken::Done;
            }
            return Taken::Message(Request {
                method,
                target,
                from_page,
                body,
            });
        }
        let Some((name, value)) = header.split_once(':') else {
            return Taken::Done;
        };
        match name.trim().to_ascii_lowercase().as_str() {
            "content-length" => match value.trim().parse() {
                Ok(said) => length = said,
                Err(_) => return Taken::Done,
            },
            "origin" => from_page = !value.trim().is_empty(),
            _ => {}
        }
    }

    Taken::Done
}

pub(super) fn timed_out(error: &std::io::Error) -> bool {
    matches!(
        error.kind(),
        std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
    )
}

/// What one request is answered with.
///
/// The only door is a session's own — `/s/` and the address it was handed — and
/// the only thing that happens at it is a message being answered. A GET is what
/// a client offers to be pushed to down, and there is nothing to push.
pub(super) fn route<R: Runtime>(
    app: &AppHandle<R>,
    request: &Request,
) -> (&'static str, Option<Vec<u8>>) {
    if request.from_page {
        return ("403 Forbidden", None);
    }

    let Some(token) = request.target.strip_prefix("/s/") else {
        return ("404 Not Found", None);
    };
    // A door with nothing behind it any more: the session ended while its agent
    // still had the connection open.
    let Some(id) = super::session_of(app, token) else {
        return ("404 Not Found", None);
    };

    match request.method.as_str() {
        "POST" => match rpc::answer(app, &id, &request.body) {
            // A notification: there is nothing to answer, and saying so is the
            // whole of the reply.
            None => ("202 Accepted", None),
            Some(said) => ("200 OK", Some(said.to_string().into_bytes())),
        },
        "DELETE" => ("200 OK", None),
        "GET" => ("405 Method Not Allowed", None),
        _ => ("405 Method Not Allowed", None),
    }
}

pub(super) fn reply(
    writing: &mut TcpStream,
    status: &str,
    body: Option<&[u8]>,
) -> std::io::Result<()> {
    let body = body.unwrap_or(&[]);
    let head = format!(
        "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: keep-alive\r\n\r\n",
        body.len()
    );
    writing.write_all(head.as_bytes())?;
    writing.write_all(body)?;
    writing.flush()
}
