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

use std::io::BufReader;
use std::net::{TcpListener, TcpStream};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use tauri::{AppHandle, Runtime};

use super::http::{Taken, reply, route, take};
use super::{LOOPBACK, Standing};

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

/// Binds the loopback listener and leaves it accepting.
///
/// `wanted` is the port a server that stood here before took, or nought. The
/// same door is asked for so that a terminal holding an address from before the
/// server was last switched off is holding the right one — and where the
/// machine has since given that port to somebody else, the next free one is
/// taken and the terminals from before are the ones that lose out.
///
/// With nothing to go back to it is `DOOR` that is asked for, which is the
/// number written into the settings of an agent that can only be registered
/// against a literal address. That registration is made once and read every
/// time the agent starts, so the same port is asked for every time the server
/// is stood — and where it cannot be had, any free one is taken and the agents
/// registered against the number are the ones that lose out.
pub fn listen<R: Runtime>(app: AppHandle<R>, wanted: u16) -> Result<Standing, String> {
    let listener = match again(wanted) {
        Some(listener) => listener,
        None => match TcpListener::bind((LOOPBACK, super::DOOR)) {
            Ok(listener) => listener,
            Err(_) => TcpListener::bind((LOOPBACK, 0)).map_err(|error| error.to_string())?,
        },
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
