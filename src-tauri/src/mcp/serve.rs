//! The door itself: one loopback listener, and a thread per agent talking
//! through it.
//!
//! Enough HTTP to be an MCP endpoint and no more. What arrives is a POST with a
//! JSON-RPC message in it and what goes back is one with the answer, which is
//! the whole of the traffic — the other half of the transport, the stream a
//! server pushes to a client down, is not built because nothing here has
//! anything to push: the window is where the agent's work is shown, and the
//! agent is the one doing the telling.
//!
//! A thread per connection rather than anything cleverer. The connections are
//! one per running agent, they are open for as long as that agent is, and they
//! say something every few minutes at most: this is a handful of threads asleep
//! on a socket, which is what they are for.

use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use tauri::{AppHandle, Runtime};

use super::{LOOPBACK, Standing, rpc};

/// How long a connection waits to be spoken to before it looks up.
///
/// An agent thinking for ten minutes is a connection saying nothing for ten
/// minutes, so this is not a deadline on the conversation — it is how often the
/// thread wakes to ask whether the server is still meant to be standing. The
/// socket is left exactly as it was; nothing at the other end can tell.
const LISTEN_FOR: Duration = Duration::from_secs(30);

/// How often the listener looks up between connections, for the same reason.
const ACCEPT_PAUSE: Duration = Duration::from_millis(50);

/// How long a port that was ours a moment ago is waited for.
///
/// A listener is let go of by the thread that was accepting on it, and that
/// thread finds out it is finished the next time it looks up — so a server
/// stood again straight after being taken down is asking for a port that is
/// still, for another instant, held by the loop that is winding down. Waiting
/// out that instant is what keeps every terminal opened before the switch was
/// touched pointing at a door that is still there.
const HANDOVER: Duration = Duration::from_millis(400);
const HANDOVER_PAUSE: Duration = Duration::from_millis(20);

/// The longest a request line or a header may be.
const LINE_LIMIT: u64 = 8 * 1024;

/// How many headers are read before the request is refused.
const HEADER_LIMIT: usize = 64;

/// The most a message may be.
///
/// A report is a sentence and a short list. Anything a hundred times that size
/// is not a report, and reading it into memory because somebody said it was
/// coming is the one thing a listener must not do.
const BODY_LIMIT: usize = 256 * 1024;

/// Binds the loopback listener and leaves it accepting.
///
/// `wanted` is the port a server that stood here before took, or nought. The
/// same door is asked for so that a terminal holding an address from before the
/// server was last switched off is holding the right one — and where the
/// machine has since given that port to somebody else, the next free one is
/// taken and the terminals from before are the ones that lose out.
pub fn listen<R: Runtime>(app: AppHandle<R>, wanted: u16) -> Result<Standing, String> {
    let listener = match again(wanted) {
        Some(listener) => listener,
        None => TcpListener::bind((LOOPBACK, 0)).map_err(|error| error.to_string())?,
    };
    let port = listener
        .local_addr()
        .map_err(|error| error.to_string())?
        .port();
    listener
        .set_nonblocking(true)
        .map_err(|error| error.to_string())?;

    let stopping = Arc::new(AtomicBool::new(false));
    let watching = Arc::clone(&stopping);
    std::thread::spawn(move || accept(app, listener, watching));

    Ok(Standing { port, stopping })
}

/// The same door as last time, if it can be had.
fn again(wanted: u16) -> Option<TcpListener> {
    if wanted == 0 {
        return None;
    }
    let deadline = std::time::Instant::now() + HANDOVER;
    loop {
        if let Ok(listener) = TcpListener::bind((LOOPBACK, wanted)) {
            return Some(listener);
        }
        if std::time::Instant::now() >= deadline {
            // Somebody else has it now. The next free port is taken instead,
            // and the terminals holding the old address are the ones that lose
            // out — which is the honest end of a port this app never owned.
            return None;
        }
        std::thread::sleep(HANDOVER_PAUSE);
    }
}

/// Takes connections until the server is taken down.
fn accept<R: Runtime>(app: AppHandle<R>, listener: TcpListener, stopping: Arc<AtomicBool>) {
    while !stopping.load(Ordering::Relaxed) {
        match listener.accept() {
            Ok((stream, _)) => {
                let handle = app.clone();
                let watching = Arc::clone(&stopping);
                std::thread::spawn(move || {
                    let _ = talk(handle, stream, watching);
                });
            }
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(ACCEPT_PAUSE);
            }
            // The listener itself is gone. Nothing here can put it back, and a
            // loop that cannot accept is a loop that only spins.
            Err(_) => break,
        }
    }
}

/// One connection, for as long as the agent at the other end keeps it.
fn talk<R: Runtime>(
    app: AppHandle<R>,
    stream: TcpStream,
    stopping: Arc<AtomicBool>,
) -> std::io::Result<()> {
    stream.set_nonblocking(false)?;
    stream.set_read_timeout(Some(LISTEN_FOR))?;
    let mut writing = stream.try_clone()?;
    let mut reading = BufReader::new(stream);

    loop {
        match take(&mut reading) {
            Taken::Message(request) => {
                let (status, body) = route(&app, &request);
                reply(&mut writing, status, body.as_deref())?;
            }
            // Nothing said yet. The agent is thinking, or is between turns.
            Taken::Waiting => {
                if stopping.load(Ordering::Relaxed) {
                    return Ok(());
                }
            }
            Taken::Done => return Ok(()),
        }
    }
}

/// What is being asked, out of one request.
struct Request {
    method: String,
    target: String,
    /// Whether a browser sent this.
    ///
    /// Nothing that belongs here ever sets it: an agent is a program with an
    /// address, not a page somebody was shown. A page that has been told this
    /// machine's name resolves somewhere else and then talks to the loopback
    /// server behind it is the one attack a loopback door is open to, and
    /// refusing everything that carries this is the whole of the defence
    /// against it.
    from_page: bool,
    body: Vec<u8>,
}

enum Taken {
    Message(Request),
    /// The read timed out with nothing said, which is not the end of anything.
    Waiting,
    /// The connection is finished, or was never going to be understood.
    Done,
}

/// Reads one request off the connection.
fn take(reading: &mut BufReader<TcpStream>) -> Taken {
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

fn timed_out(error: &std::io::Error) -> bool {
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
fn route<R: Runtime>(app: &AppHandle<R>, request: &Request) -> (&'static str, Option<Vec<u8>>) {
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

fn reply(writing: &mut TcpStream, status: &str, body: Option<&[u8]>) -> std::io::Result<()> {
    let body = body.unwrap_or(&[]);
    let head = format!(
        "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: keep-alive\r\n\r\n",
        body.len()
    );
    writing.write_all(head.as_bytes())?;
    writing.write_all(body)?;
    writing.flush()
}
