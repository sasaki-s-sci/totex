//! How each taken terminal was taken, kept where a window's going leaves it.
//!
//! The one thing here that is not derived. Everything else about a session is
//! read again out of what it has said, and what it has said is a backlog with
//! its head cut off: an agent that has been working a while no longer has the
//! line that started it, or the mode it set as it came up, anywhere in it. So
//! those are handed to the program that holds the terminals, under a name, the
//! moment they change — see `totex_persistent::store` — and `rederive` asks for
//! them back for the sessions whose backlog no longer says.

use std::collections::HashMap;

use tauri::{AppHandle, Runtime};

use super::watcher::Taken;

/// The document they are kept under.
const NAME: &str = "taken";

/// Keeps how every taken terminal stands, in place of what was kept before.
///
/// Whether it was kept is not waited on or reported: what is lost with it is a
/// mark being the wrong shape after the next restart, which is what there was
/// before any of this.
pub fn keep<R: Runtime>(app: &AppHandle<R>, taken: HashMap<String, Taken>) {
    let Ok(value) = serde_json::to_value(taken) else {
        return;
    };
    let _ = crate::persistent::link(app).ask(
        "store_put",
        serde_json::json!({ "name": NAME, "value": value }),
    );
}

/// What was kept, or nothing where nothing was or it no longer reads.
pub fn kept<R: Runtime>(app: &AppHandle<R>) -> HashMap<String, Taken> {
    crate::persistent::link(app)
        .asked::<Option<HashMap<String, Taken>>>("store_get", serde_json::json!({ "name": NAME }))
        .ok()
        .flatten()
        .unwrap_or_default()
}

/// How every taken terminal stands, out of the screens being followed.
pub fn standing(watching: &HashMap<String, super::Watcher>) -> HashMap<String, Taken> {
    watching
        .iter()
        .filter_map(|(id, watcher)| Some((id.clone(), watcher.taken()?)))
        .collect()
}
