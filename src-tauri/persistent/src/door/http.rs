//! Just enough HTTP to be an MCP endpoint: one request read off a socket, and
//! one answer written back.

use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpStream;
use totex_host::sync::lock;

use super::{Door, rpc};

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
    /// The token an agent that was registered against the one door names its
    /// own session with, where it sent one. An agent registered against a door
    /// of its own has said the same thing in `target` instead.
    pub bearer: Option<String>,
    /// Whether a browser sent this.
    ///
    /// Nothing that belongs here ever sets it: an agent is a program with an
    /// address, not a page somebody was shown. A page that has been told this
    /// machine's name resolves somewhere else and then talks to the loopback
    /// server behind it is the one attack a loopback door is open to, and
    /// refusing everything that carries this is the whole of the defence
    /// against it.
    pub from_page: bool,
    pub local_host: bool,
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
    let mut local_host = false;
    let mut has_host = false;
    let mut bearer = None;
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
                bearer,
                from_page,
                local_host,
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
            "origin" => from_page |= !value.trim().is_empty(),
            "host" => {
                if has_host {
                    return Taken::Done;
                }
                has_host = true;
                local_host = loopback_host(value.trim());
            }
            "authorization" => {
                // The scheme and the token, and nothing done about a header
                // that is neither: what is not a bearer token is not a name
                // for a session, and the door answers the same way to both.
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

pub(super) fn timed_out(error: &std::io::Error) -> bool {
    matches!(
        error.kind(),
        std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
    )
}

/// What one request is answered with.
///
/// Whichever way in was used, what is behind it is one session, and the only
/// thing that happens there is a message being answered. A GET is what a client
/// offers to be pushed to down, and there is nothing to push.
pub(super) fn route(door: &Door, request: &Request) -> (&'static str, Option<Vec<u8>>) {
    if request.from_page || !request.local_host {
        return ("403 Forbidden", None);
    }

    let target = request.target.split('?').next().unwrap_or("");
    let shared = target
        .strip_prefix("/mcp/")
        .is_some_and(|token| lock(&door.credential).as_deref() == Some(token));
    let id = if shared && door.serving().is_some() {
        None
    } else {
        let Some(id) = named(request).and_then(|token| super::report::session_of(door, token))
        else {
            return ("404 Not Found", None);
        };
        Some(id)
    };

    match request.method.as_str() {
        "POST" => match rpc::answer(door, id.as_deref(), &request.body) {
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

fn loopback_host(value: &str) -> bool {
    let (host, port) = value
        .split_once(':')
        .map_or((value, None), |(host, port)| (host, Some(port)));
    (host == "127.0.0.1" || host.eq_ignore_ascii_case("localhost"))
        && port.is_none_or(|port| port.parse::<u16>().is_ok_and(|port| port != 0))
}

/// Which session was knocked on for, however the agent was able to say it.
///
/// Two ways in, and one of them is not this side's choice: an agent that
/// expands a variable into an address is handed a door of its own and names the
/// session in the path, and an agent that can only be given a literal address
/// is handed the one door and names it in the request instead. What is behind
/// them is the same session, and the token is the same token.
fn named(request: &Request) -> Option<&str> {
    // Nothing here reads a query, and an agent that appends one is asking for
    // the same door it was given.
    let target = request
        .target
        .split_once('?')
        .map_or(request.target.as_str(), |(path, _)| path);
    if let Some(token) = target.strip_prefix("/s/") {
        return Some(token);
    }
    if target == super::DOOR_PATH {
        return request.bearer.as_deref();
    }
    None
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpListener;

    fn request(headers: &str) -> Request {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let mut client = TcpStream::connect(listener.local_addr().unwrap()).unwrap();
        client
            .write_all(
                format!("POST /mcp HTTP/1.1\r\n{headers}Content-Length: 0\r\n\r\n").as_bytes(),
            )
            .unwrap();
        let (server, _) = listener.accept().unwrap();
        let Taken::Message(request) = take(&mut BufReader::new(server)) else {
            panic!("request was not parsed")
        };
        request
    }

    #[test]
    fn browser_origin_and_non_loopback_hosts_are_rejected() {
        let door = Door::new(std::sync::Arc::new(crate::session::Sessions::default()));
        for headers in [
            "Host: localhost:26374\r\nOrigin: https://example.com\r\nOrigin: \r\n",
            "Host: attacker.example:26374\r\n",
            "Host: localhost.attacker.example:26374\r\n",
            "Host: localhost:invalid\r\n",
            "",
        ] {
            assert_eq!(
                route(&door, &request(headers)).0,
                "403 Forbidden",
                "{headers}"
            );
        }
        for host in ["localhost:26374", "127.0.0.1:26374", "LOCALHOST"] {
            let request = request(&format!("Host: {host}\r\n"));
            assert!(request.local_host && !request.from_page);
        }
    }
}
