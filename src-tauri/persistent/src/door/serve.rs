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

use super::http::{Taken, reply, route, take};
use super::{Door, LOOPBACK, Standing};

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

/// Binds the registered port, failing rather than leaving clients at an old address.
pub fn listen(door: Arc<Door>, wanted: u16) -> Result<Standing, String> {
    // Concurrent unit tests use private ports without taking the running app's port.
    let port = if cfg!(test) { wanted } else { super::DOOR };
    let listener = bind(port)?;
    let port = listener
        .local_addr()
        .map_err(|error| error.to_string())?
        .port();
    listener
        .set_nonblocking(true)
        .map_err(|error| error.to_string())?;

    let stopping = Arc::new(AtomicBool::new(false));
    let watching = Arc::clone(&stopping);
    std::thread::spawn(move || accept(door, listener, watching));

    Ok(Standing { port, stopping })
}

/// A recently stopped listener gets time to release this same port.
fn bind(port: u16) -> Result<TcpListener, String> {
    let deadline = std::time::Instant::now() + HANDOVER;
    loop {
        match TcpListener::bind((LOOPBACK, port)) {
            Ok(listener) => return Ok(listener),
            Err(error)
                if error.kind() == std::io::ErrorKind::AddrInUse
                    && std::time::Instant::now() < deadline => {}
            Err(error) => {
                return Err(format!(
                    "Could not start totex MCP at http://{LOOPBACK}:{port}/mcp: {error}"
                ));
            }
        }
        std::thread::sleep(HANDOVER_PAUSE);
    }
}

/// Takes connections until the server is taken down.
fn accept(door: Arc<Door>, listener: TcpListener, stopping: Arc<AtomicBool>) {
    while !stopping.load(Ordering::Relaxed) {
        match listener.accept() {
            Ok((stream, _)) => {
                let door = Arc::clone(&door);
                let watching = Arc::clone(&stopping);
                std::thread::spawn(move || {
                    let _ = talk(door, stream, watching);
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
fn talk(door: Arc<Door>, stream: TcpStream, stopping: Arc<AtomicBool>) -> std::io::Result<()> {
    stream.set_nonblocking(false)?;
    stream.set_read_timeout(Some(LISTEN_FOR))?;
    let mut writing = stream.try_clone()?;
    let mut reading = BufReader::new(stream);

    loop {
        match take(&mut reading) {
            Taken::Message(request) => {
                let (status, body) = route(&door, &request);
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_occupied_port_is_an_error_not_another_address() {
        let occupied = TcpListener::bind((LOOPBACK, 0)).expect("test listener");
        let port = occupied.local_addr().unwrap().port();
        let error = bind(port).expect_err("must not open a different port");
        assert!(error.contains(&format!("http://{LOOPBACK}:{port}/mcp")));
    }

    #[test]
    fn a_released_port_is_reused_during_handover() {
        let occupied = TcpListener::bind((LOOPBACK, 0)).expect("test listener");
        let port = occupied.local_addr().unwrap().port();
        let releasing = std::thread::spawn(move || {
            std::thread::sleep(HANDOVER_PAUSE * 2);
            drop(occupied);
        });
        let listener = bind(port).expect("reuse the released port");
        releasing.join().unwrap();
        assert_eq!(listener.local_addr().unwrap().port(), port);
    }
}
