//! What each session is doing and was last told, kept beside the sessions
//! rather than inside them.
//!
//! Every one of those is read off a session's own screen, which makes all of
//! this derived: hand the same bytes to the same reading and the same reading
//! comes back. Nothing here is a possession — it is a saving, so
//! that a run of output can be answered by looking at what changed rather than
//! at all of it — and `rederive` throws the whole of it away and takes it again
//! out of what the sessions have already said.
//!
//! Which is why it is on this side of the line: the program beside this one
//! owns processes and nothing else, and the reading is the part of the app that
//! changes most often.

mod taken;
mod watcher;

#[cfg(test)]
mod tests;

use std::collections::HashMap;
use std::sync::{Arc, Mutex, MutexGuard};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, Runtime};

use crate::pty::{self, Event};

pub use watcher::Watcher;

/// Carries what a session has turned to doing. Sent whether or not a terminal
/// is being drawn: the mark a terminal wears on the canvas is drawn from this,
/// and the canvas is there whether or not the panel is.
pub const DOING_EVENT: &str = "pty:doing";

/// A session, and what it is doing.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Doings {
    id: String,
    doing: super::Doing,
}

/// A session as Monitor draws it between observations: what it is doing,
/// whether it is stopped on a question, the last thing typed at it, and what
/// its shell is running as the process table has it — see `ask::process`.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Glance {
    id: String,
    doing: super::Doing,
    asking: bool,
    said: Option<String>,
    running: Option<String>,
    tail: String,
}

/// One screen per running session, and nothing that is not on one.
#[derive(Default)]
pub struct AskState {
    watching: Mutex<HashMap<String, Watcher>>,
}

impl AskState {
    fn lock(&self) -> MutexGuard<'_, HashMap<String, Watcher>> {
        crate::sync::lock(&self.watching)
    }
}

/// Takes what is sent to a session as it goes to the shell — see `Watcher::keyed`.
pub fn keyed<R: Runtime>(app: &AppHandle<R>, id: &str, data: &str) {
    if let Some(watcher) = app.state::<AskState>().lock().get_mut(id) {
        watcher.keyed(data);
    }
}

/// Starts following the sessions, for the life of the app. The one place the
/// two sides are joined, and joined this way round on purpose: the link is told
/// that something is following and never what it is for.
pub fn attend<R: Runtime>(app: &AppHandle<R>) {
    let handle = app.clone();
    crate::persistent::link(app).follow(Arc::new(move |id, event| {
        let state = handle.state::<AskState>();
        match event {
            Event::Opened { rows, cols } => {
                state
                    .lock()
                    .insert(id.to_string(), Watcher::new(rows, cols));
            }
            Event::Said { data, at } => {
                // Read under the lock and told outside it: telling crosses to
                // the window, and the next run of output must not wait on that.
                // Both readings are taken in the one hold of the map — they are
                // off the same screen, and taking them separately would be
                // holding it twice for one run of output.
                let (turned, retaken) = {
                    let mut watching = state.lock();
                    let (turned, retaken) = match watching.get_mut(id) {
                        None => (None, false),
                        Some(watcher) => {
                            watcher.keep(at, data);
                            (watcher.turned(), watcher.retaken())
                        }
                    };
                    (turned, retaken.then(|| taken::standing(&watching)))
                };
                // Kept before anything is told: it is the one reading here that
                // cannot be taken again, and it changes a few times a session.
                if let Some(standing) = retaken {
                    taken::keep(&handle, standing);
                }
                if let Some(doing) = turned {
                    let _ = handle.emit(
                        DOING_EVENT,
                        Doings {
                            id: id.to_string(),
                            doing,
                        },
                    );
                }
            }
            Event::Resized { rows, cols } => {
                if let Some(watcher) = state.lock().get_mut(id) {
                    watcher.resize(rows, cols);
                }
            }
            Event::Ended => {
                let left = {
                    let mut watching = state.lock();
                    let ended = watching.remove(id);
                    ended
                        .is_some_and(|watcher| watcher.taken().is_some())
                        .then(|| taken::standing(&watching))
                };
                if let Some(standing) = left {
                    taken::keep(&handle, standing);
                }
            }
        }
    }));
}

/// Throws every screen away and reads them again out of the backlogs.
///
/// Nothing is lost by it: the sessions still hold what they said, and every
/// reading here is taken again out of that. The map is held for the whole of it,
/// so a run arriving meanwhile waits rather than landing on a half-built screen.
///
/// One thing is not in the backlogs, for a session that has said more than its
/// backlog holds: how its terminal was taken over. That is asked for back from
/// where it was kept — see `taken` — and kept again as it stands afterwards, so
/// that what is kept is never older than the screens it was read off.
pub fn rederive<R: Runtime>(app: &AppHandle<R>) {
    let running = pty::running(app);
    let kept = taken::kept(app);
    let state = app.state::<AskState>();
    let standing = {
        let mut watching = state.lock();
        watching.clear();
        for session in running {
            // Gone between being listed and being read: nothing to read.
            let Some(held) = pty::pty_attach(app.clone(), session.id.clone()) else {
                continue;
            };
            let mut watcher = Watcher::new(session.rows, session.cols);
            // A backlog that reaches back to the start says all of it itself.
            if held.upto > held.text.len()
                && let Some(taken) = kept.get(&session.id)
            {
                watcher.resume(taken);
            }
            watcher.replay(&held.text, held.upto);
            watching.insert(session.id, watcher);
        }
        taken::standing(&watching)
    };
    if standing != kept {
        taken::keep(app, standing);
    }
}

/// What every running session is doing, for a window that has just come up.
///
/// The event carries the moments these change; a window that only listened
/// would draw nothing until a session next said something, which for a shell
/// sitting at its prompt is never.
#[tauri::command]
pub fn pty_doing<R: Runtime>(app: AppHandle<R>) -> Vec<Doings> {
    let state = app.state::<AskState>();
    let watching = state.lock();
    watching
        .iter()
        .map(|(id, watcher)| Doings {
            id: id.clone(),
            doing: watcher.doing(),
        })
        .collect()
}

/// Every running session as it stands, polled often by Monitor so its status
/// comes off the screen rather than waiting on the observer's next report.
#[tauri::command(async)]
pub fn pty_standing<R: Runtime>(app: AppHandle<R>) -> Vec<Glance> {
    // The shells' pids are the persistent half's, asked before the lock is taken.
    let pids: HashMap<String, u32> = pty::running(&app)
        .into_iter()
        .filter_map(|session| Some((session.id, session.pid?)))
        .collect();
    let state = app.state::<AskState>();
    let watching = state.lock();
    watching
        .iter()
        .map(|(id, watcher)| Glance {
            id: id.clone(),
            doing: watcher.doing(),
            asking: watcher.asking(),
            said: watcher.typed().map(str::to_string),
            tail: watcher.tail(),
            running: pids
                .get(id)
                .and_then(|pid| super::process::foreground(*pid)),
        })
        .collect()
}
