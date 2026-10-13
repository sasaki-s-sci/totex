//! What the sessions are driven with: a mock app, a program holding shells
//! at the other end of a real socket, and the boxes an agent draws.

mod naming;
mod session;
mod typing;

use std::path::PathBuf;
use std::sync::Arc;
use std::sync::mpsc;
use std::time::{Duration, Instant};

use tauri::AppHandle;
use tauri::Listener;
use tauri::test::{MockRuntime, mock_builder, mock_context, noop_assets};

use totex_persistent::talk::Link;
use totex_persistent::{Persistent, serve};

use super::super::Ask;
use super::{AskState, Watcher, attend, pty_asking};
use crate::pty;

/// A temporary directory that removes itself, so a failing test cannot leave
/// an address file behind for a real window to find.
struct Home(PathBuf);

impl Drop for Home {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

/// An app with a program holding shells beside it, both in this process and
/// joined by the same socket a real window uses.
pub(super) fn mock_app() -> tauri::App<MockRuntime> {
    let unique = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_nanos())
        .unwrap_or_default();
    let home = std::env::temp_dir().join(format!("totex-ask-{}-{unique}", std::process::id()));
    std::fs::create_dir_all(&home).expect("create temp dir");

    let keep = Persistent::new(None);
    let serving =
        serve::stand(Arc::clone(&keep), &home, Box::new(|| {})).expect("the program stands");
    let link = Arc::new(Link::connect(&home).expect("the window connects"));

    let app = mock_builder()
        .manage(crate::persistent::Reached::holding(link))
        .manage(AskState::default())
        // Held for the life of the app, which is the life of the test.
        .manage(keep)
        .manage(serving)
        .manage(Home(home))
        .build(mock_context(noop_assets()))
        .expect("mock app");
    attend(app.handle());
    crate::persistent::deliver(app.handle());
    app
}

/// Answers the one question a shell asks of the terminal it starts in: a login
/// shell asks where the cursor is before drawing its first prompt and waits for
/// the answer, and without a reply never reads the line typed at it.
pub(super) fn answering(app: &AppHandle<MockRuntime>, id: &str) {
    let handle = app.clone();
    let name = id.to_string();
    app.listen("pty:data", move |event| {
        if let Ok(chunk) = serde_json::from_str::<serde_json::Value>(event.payload())
            && let Some(data) = chunk.get("data").and_then(|value| value.as_str())
            && data.contains("\u{1b}[6n")
        {
            let _ = pty::pty_write(handle.clone(), name.clone(), "\u{1b}[1;1R".to_string());
        }
    });
}

/// Draws the box an agent draws and leaves it standing. The sleep is what keeps
/// the shell from printing its next prompt underneath it, which would make the
/// box a list somebody wrote rather than a question.
pub(super) fn draw_box(app: &AppHandle<MockRuntime>, id: &str) {
    let drawn = [
        "\u{256d}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{256e}\\n",
        "\u{2502} Bash command \u{2502}\\n",
        "\u{2502}              \u{2502}\\n",
        "\u{2502}   ls -la      \u{2502}\\n",
        "\u{2502}              \u{2502}\\n",
        "\u{2502} Proceed?     \u{2502}\\n",
        "\u{2502} \u{276f} 1. Yes     \u{2502}\\n",
        "\u{2502}   2. No      \u{2502}\\n",
        "\u{2570}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{256f}\\n",
    ]
    .concat();
    pty::pty_write(
        app.clone(),
        id.to_string(),
        format!("printf '{drawn}'; sleep 30\n"),
    )
    .expect("the shell takes input");
}

/// Waits for a question to reach the window, and hands it over.
pub(super) fn wait_asked(rx: &mpsc::Receiver<String>) -> Option<serde_json::Value> {
    wait_for(rx, |_| true)
}

/// And for a particular one, for a test that has drawn more than one thing.
pub(super) fn wait_for(
    rx: &mpsc::Receiver<String>,
    wanted: impl Fn(&serde_json::Value) -> bool,
) -> Option<serde_json::Value> {
    let deadline = Instant::now() + Duration::from_secs(20);
    while Instant::now() < deadline {
        let Ok(payload) = rx.recv_timeout(Duration::from_millis(250)) else {
            continue;
        };
        let said: serde_json::Value = serde_json::from_str(&payload).expect("an ask");
        if said
            .get("ask")
            .is_some_and(|ask| !ask.is_null() && wanted(ask))
        {
            return Some(said);
        }
    }
    None
}

/// A list drawn with no keys beside it, with the agent's mark on one line.
pub(super) fn walking_box(on: usize) -> String {
    let answers = ["Allow once", "Allow always", "Deny"];
    let mut drawn = String::from("\u{1b}[?1049h\u{1b}[?25l\u{1b}[2J\u{1b}[H");
    drawn.push_str("\u{256d}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{256e}\r\n");
    drawn.push_str("\u{2502} Run this command?  \u{2502}\r\n");
    for (at, answer) in answers.iter().enumerate() {
        let mark = if at == on { '\u{276f}' } else { ' ' };
        drawn.push_str(&format!("\u{2502} {mark} {answer:<14} \u{2502}\r\n"));
    }
    drawn.push_str("\u{2570}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{256f}\r\n");
    drawn
}

/// Hands a run to a watcher the way a session does: after everything it has
/// already been handed.
pub(super) fn feed(watcher: &mut Watcher, data: &str) -> Option<Option<Ask>> {
    let at = watcher.fed;
    watcher.keep(at, data)
}

pub(super) fn asking_now(app: &AppHandle<MockRuntime>, id: &str) -> Option<serde_json::Value> {
    let standing = pty_asking(app.clone());
    let found = standing.into_iter().find(|asking| asking.id == id)?;
    serde_json::to_value(found.ask?).ok()
}
