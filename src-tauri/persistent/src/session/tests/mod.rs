//! Sessions with nothing at the other end, and the waiting a live shell needs.

mod backlog;
mod shell;

use std::sync::Arc;
use std::sync::mpsc;
use std::time::{Duration, Instant};

use super::{Event, Sessions};

pub(crate) fn sessions() -> Arc<Sessions> {
    Arc::new(Sessions::default())
}

/// Collects output until `wanted` shows up, answering the one question a shell
/// asks of the terminal it is starting in: a login shell asks where the cursor
/// is before drawing its first prompt, and without a reply never reads the line
/// that was typed at it.
pub(super) fn wait_answering(
    sessions: &Sessions,
    id: &str,
    rx: &mpsc::Receiver<String>,
    wanted: &str,
) -> String {
    let deadline = Instant::now() + Duration::from_secs(20);
    let mut seen = String::new();
    let mut asked = 0usize;
    while Instant::now() < deadline {
        if let Ok(chunk) = rx.recv_timeout(Duration::from_millis(250)) {
            seen.push_str(&chunk);
            let asks = seen.matches("\u{1b}[6n").count();
            while asked < asks {
                asked += 1;
                let _ = sessions.write(id, "\u{1b}[1;1R");
            }
            if seen.contains(wanted) {
                return seen;
            }
        }
    }
    seen
}

/// Collects output until `wanted` shows up, or gives up.
#[cfg(unix)]
pub(crate) fn wait_for(rx: &mpsc::Receiver<String>, wanted: &str) -> String {
    let deadline = Instant::now() + Duration::from_secs(10);
    let mut seen = String::new();
    while Instant::now() < deadline {
        if let Ok(chunk) = rx.recv_timeout(Duration::from_millis(250)) {
            seen.push_str(&chunk);
            if seen.contains(wanted) {
                return seen;
            }
        }
    }
    seen
}

/// Every run of output the sessions say, on a channel.
pub(crate) fn listening(sessions: &Sessions) -> mpsc::Receiver<String> {
    let (tx, rx) = mpsc::channel();
    sessions.follow(Arc::new(move |_, event| {
        if let Event::Said { data, .. } = event {
            let _ = tx.send(data.to_string());
        }
    }));
    rx
}
