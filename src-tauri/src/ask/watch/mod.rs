//! Which session is standing on a question, kept beside the sessions rather
//! than inside them.
//!
//! Every question is read off a session's own screen, which makes all of this
//! derived: hand the same bytes to the same reading and the same question comes
//! back under the same name. Nothing here is a possession — it is a saving, so
//! that a run of output can be answered by looking at what changed rather than
//! at all of it — and `rederive` throws the whole of it away and takes it again
//! out of what the sessions have already said.
//!
//! Which is why it is on this side of the line: `pty` owns processes and
//! nothing else, and the reading is the part of the app that changes most often.

pub mod adjust;
pub mod answer;
mod typing;
mod watcher;

#[cfg(test)]
mod tests;

use std::collections::HashMap;
use std::sync::{Arc, Mutex, MutexGuard};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, Runtime};

use crate::pty::{self, Event, PtyState};

pub use watcher::Watcher;

/// Carries what a session is asking, and its going away again. Sent whether or
/// not a terminal is being drawn: a question is asked of the person at the
/// window, not of the panel.
pub const ASK_EVENT: &str = "pty:ask";

/// What a session is asking, or — with nothing in it — that it has stopped.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Asking {
    id: String,
    ask: Option<super::Ask>,
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

/// Says what a session is asking, whether or not the reading changed.
///
/// The ordinary telling is the one in `attend`, off a reading of what just
/// arrived. This is for the acts on a question, which have two other things to
/// say: that a question has been taken, and — when a press named a question the
/// session had already moved on from — what is really being asked instead.
fn say<R: Runtime>(app: &AppHandle<R>, id: String, ask: Option<super::Ask>) {
    let _ = app.emit(ASK_EVENT, Asking { id, ask });
}

/// The question a press names, if it is still the one being asked, and how far
/// the session's screen had been drawn when the press landed.
///
/// What every act on a question is held to: a card is drawn from a reading that
/// is already a moment old, and nothing meant for "may I delete this" may arrive
/// at whatever the agent went on to ask instead.
///
/// A refusal is not silent. The window takes a card off the graph at the press —
/// see the note above `answer` — so a press refused without a word would leave
/// the graph short of a question somebody still has to answer. What goes back is
/// what the session is really asking: the question it moved on to, or nothing.
fn pressed<R: Runtime>(
    app: &AppHandle<R>,
    id: &str,
    seq: u64,
) -> Result<(super::Ask, usize), String> {
    let found = {
        let state = app.state::<AskState>();
        let watching = state.lock();
        match watching.get(id) {
            None => Err(("no-session", None)),
            Some(watcher) => match watcher.asking() {
                Some(ask) if ask.seq == seq => Ok((ask.clone(), watcher.drawn())),
                Some(ask) => Err(("asking-something-else", Some(ask.clone()))),
                None => Err(("asking-nothing", None)),
            },
        }
    };

    // Said outside the lock, the way every telling is: it crosses to the window,
    // and the next run of output must not wait on that.
    match found {
        Ok(standing) => Ok(standing),
        Err((error, standing)) => {
            say(app, id.to_string(), standing);
            Err(error.to_string())
        }
    }
}

/// Starts following the sessions, for the life of the app. The one place the
/// two sides are joined, and joined this way round on purpose: `pty` is told
/// that something is following and never what it is for.
pub fn attend<R: Runtime>(app: &AppHandle<R>) {
    let handle = app.clone();
    app.state::<PtyState>().follow(Arc::new(move |id, event| {
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
                let told = state
                    .lock()
                    .get_mut(id)
                    .and_then(|watcher| watcher.keep(at, data));
                if let Some(ask) = told {
                    let _ = handle.emit(
                        ASK_EVENT,
                        Asking {
                            id: id.to_string(),
                            ask,
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
                state.lock().remove(id);
            }
        }
    }));
}

/// Throws every screen away and reads them again out of the backlogs.
///
/// Nothing being asked is lost by it: the sessions still hold what they said,
/// and a question is named by what it says, so a card the window drew before
/// this ran is still answerable after it. The map is held for the whole of it,
/// so a run arriving meanwhile waits rather than landing on a half-built screen.
pub fn rederive<R: Runtime>(app: &AppHandle<R>) {
    let running = pty::running(app);
    let state = app.state::<AskState>();
    let mut watching = state.lock();
    watching.clear();
    for session in running {
        // Gone between being listed and being read: nothing to read.
        let Some(held) = pty::pty_attach(app.clone(), session.id.clone()) else {
            continue;
        };
        let mut watcher = Watcher::new(session.rows, session.cols);
        watcher.replay(&held.text, held.upto);
        watching.insert(session.id, watcher);
    }
}

/// Every question standing right now, for a window that has just come up. The
/// event carries these from moment to moment; a window that only listened would
/// show nothing until the next redraw, which for a session sitting on a
/// question is never.
#[tauri::command]
pub fn pty_asking<R: Runtime>(app: AppHandle<R>) -> Vec<Asking> {
    let state = app.state::<AskState>();
    let watching = state.lock();
    watching
        .iter()
        .filter_map(|(id, watcher)| {
            Some(Asking {
                id: id.clone(),
                ask: Some(watcher.asking()?.clone()),
            })
        })
        .collect()
}
