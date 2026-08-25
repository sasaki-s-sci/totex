//! A mock app with sessions in it, and the waiting a live shell needs.

mod backlog;
mod shell;

use std::sync::mpsc;
use std::time::{Duration, Instant};

use tauri::test::{MockRuntime, mock_builder, mock_context, noop_assets};
use tauri::{AppHandle, Runtime};

use super::{PtyState, pty_write};

pub(super) fn mock_app() -> tauri::App<MockRuntime> {
    mock_builder()
        .manage(PtyState::default())
        .build(mock_context(noop_assets()))
        .expect("mock app")
}

/// Collects output until `wanted` shows up, answering the one question a shell
/// asks of the terminal it is starting in: a login shell asks where the cursor
/// is before drawing its first prompt, and without a reply never reads the line
/// that was typed at it.
pub(super) fn wait_answering<R: Runtime>(
    app: &AppHandle<R>,
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
                let _ = pty_write(app.clone(), id.to_string(), "\u{1b}[1;1R".to_string());
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

/// Every run of output a session sends, on a channel.
pub(crate) fn listening<R: Runtime>(app: &AppHandle<R>) -> mpsc::Receiver<String> {
    use tauri::Listener;

    let (tx, rx) = mpsc::channel();
    app.listen(super::DATA_EVENT, move |event| {
        if let Ok(chunk) = serde_json::from_str::<serde_json::Value>(event.payload())
            && let Some(data) = chunk.get("data").and_then(|value| value.as_str())
        {
            let _ = tx.send(data.to_string());
        }
    });
    rx
}
