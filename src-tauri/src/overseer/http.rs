//! Just enough HTTP to be an MCP endpoint, the same way the agents' own door
//! is — see `totex_persistent::door::http`, which this is a smaller copy of
//! because that one belongs to the other program and is not to be reached
//! into.

use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpStream;

use super::rpc::{self, Sight};

/// The one path served.
pub const PATH: &str = "/mcp";

const LINE_LIMIT: u64 = 8 * 1024;
const HEADER_LIMIT: usize = 64;
const BODY_LIMIT: usize = 256 * 1024;

/// What is being asked, out of one request.
pub struct Request {
    pub method: String,
    pub target: String,
    pub bearer: Option<String>,
    /// Whether a browser sent this. Nothing that belongs here ever does: the
    /// overseer is a program, and a page that has been pointed at this
    /// machine's loopback is the one caller a loopback server has to refuse.
    pub from_page: bool,
    pub body: Vec<u8>,
}

pub enum Taken {
    Message(Request),
    /// The read timed out with nothing said, which is not the end of anything.
    Waiting,
    Done,
}

/// Reads one request off the connection.
pub fn take(reading: &mut BufReader<TcpStream>) -> Taken {
    let mut start = String::new();
    match reading.by_ref().take(LINE_LIMIT).read_line(&mut start) {
        Ok(0) => return Taken::Done,
        Ok(_) => {}
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
    let mut bearer = None;
    for _ in 0..HEADER_LIMIT {
        let mut header = String::new();
        match reading.by_ref().take(LINE_LIMIT).read_line(&mut header) {
            Ok(0) | Err(_) => return Taken::Done,
            Ok(_) => {}
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
                bearer,
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
            "authorization" => {
                if let Some((scheme, said)) = value.trim().split_once(' ')
                    && scheme.eq_ignore_ascii_case("bearer")
                {
                    bearer = Some(said.trim().to_string());
                }
            }
            _ => {}
        }
    }

    Taken::Done
}

fn timed_out(error: &std::io::Error) -> bool {
    matches!(
        error.kind(),
        std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
    )
}

/// What one request is answered with.
///
/// A page is refused before anything else is looked at, and a request without
/// the token before anything is read out of it. A GET is a client offering to
/// be pushed to, and there is nothing to push: a change is waited for by
/// asking, see `wait`.
pub fn route(sight: &dyn Sight, token: &str, request: &Request) -> (&'static str, Option<Vec<u8>>) {
    if request.from_page {
        return ("403 Forbidden", None);
    }
    let path = request
        .target
        .split_once('?')
        .map_or(request.target.as_str(), |(path, _)| path);
    if path != PATH {
        return ("404 Not Found", None);
    }
    if !request
        .bearer
        .as_deref()
        .is_some_and(|offered| same(offered, token))
    {
        return ("401 Unauthorized", None);
    }

    match request.method.as_str() {
        "POST" => match rpc::answer(sight, &request.body) {
            None => ("202 Accepted", None),
            Some(said) => ("200 OK", Some(said.to_string().into_bytes())),
        },
        "DELETE" => ("200 OK", None),
        _ => ("405 Method Not Allowed", None),
    }
}

/// Whether the token offered is the one, compared all the way through whatever
/// the answer, so that how long a refusal takes says nothing about how close
/// the guess was.
fn same(offered: &str, token: &str) -> bool {
    let (offered, token) = (offered.as_bytes(), token.as_bytes());
    offered.len() == token.len()
        && offered
            .iter()
            .zip(token)
            .fold(0u8, |differ, (a, b)| differ | (a ^ b))
            == 0
}

pub fn reply(writing: &mut TcpStream, status: &str, body: Option<&[u8]>) -> std::io::Result<()> {
    let body = body.unwrap_or(&[]);
    let head = format!(
        "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: keep-alive\r\n\r\n",
        body.len()
    );
    // One write, so that the head and the body go out together rather than as
    // two packets a client has to put back together.
    let mut whole = head.into_bytes();
    whole.extend_from_slice(body);
    writing.write_all(&whole)?;
    writing.flush()
}
