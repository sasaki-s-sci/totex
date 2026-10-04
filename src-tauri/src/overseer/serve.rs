//! The overseer's listener: one loopback socket, and a thread per connection.
//!
//! Stood up the first time an overseer is started and left standing for the
//! life of the window. There is one overseer, it holds one or two connections,
//! and the thread on the far side of a `wait` is asleep for minutes at a time —
//! which is what a thread is for.

use std::io::BufReader;
use std::net::{Ipv4Addr, TcpListener, TcpStream};
use std::sync::Arc;

use super::http::{Taken, reply, route, take};
use super::rpc::Sight;

/// The port asked for when nothing else has been taken before. Beside the
/// agents' own door (26374), and fixed for the same reason: the address is
/// written into a file the overseer reads once as it starts, and a window
/// coming up again has to stand at the address that file still names.
pub const PORT: u16 = 26375;

/// Binds the first of `wanted` that can be had, or any free port where none
/// can, leaves it accepting, and says which port it took.
pub fn listen(sight: Arc<dyn Sight>, token: String, wanted: &[u16]) -> Result<u16, String> {
    let listener = wanted
        .iter()
        .filter(|port| **port != 0)
        .find_map(|port| TcpListener::bind((Ipv4Addr::LOCALHOST, *port)).ok());
    let listener = match listener {
        Some(listener) => listener,
        None => TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).map_err(|error| error.to_string())?,
    };
    let port = listener
        .local_addr()
        .map_err(|error| error.to_string())?
        .port();

    let token = Arc::new(token);
    std::thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(stream) = stream else { continue };
            let sight = Arc::clone(&sight);
            let token = Arc::clone(&token);
            std::thread::spawn(move || {
                let _ = talk(sight.as_ref(), &token, stream);
            });
        }
    });

    Ok(port)
}

/// One connection, for as long as the client keeps it.
fn talk(sight: &dyn Sight, token: &str, stream: TcpStream) -> std::io::Result<()> {
    let mut writing = stream.try_clone()?;
    let mut reading = BufReader::new(stream);
    loop {
        match take(&mut reading) {
            Taken::Message(request) => {
                let (status, body) = route(sight, token, &request);
                reply(&mut writing, status, body.as_deref())?;
            }
            Taken::Waiting => {}
            Taken::Done => return Ok(()),
        }
    }
}
