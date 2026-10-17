//! What the sessions are driven with: a mock app, and a program holding shells
//! at the other end of a real socket.

mod replay;
mod session;

use std::path::PathBuf;
use std::sync::Arc;

use tauri::AppHandle;
use tauri::Listener;
use tauri::test::{MockRuntime, mock_builder, mock_context, noop_assets};

use totex_persistent::talk::Link;
use totex_persistent::{Persistent, serve};

use super::{AskState, attend};
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
