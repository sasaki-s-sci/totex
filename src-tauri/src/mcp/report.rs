//! What the sessions have said, and which session said it.

use tauri::{AppHandle, Emitter, Manager, Runtime};

use super::address::token;
use super::{McpState, REPORT_EVENT, Report, Reported};
use crate::pty;

/// Which session an address belongs to, out of the ones actually running.
///
/// Nothing is kept to answer this: the addresses are made from the names of the
/// sessions, so a session that has ended stops answering its own door without
/// anything having to be told to forget it.
pub fn session_of<R: Runtime>(app: &AppHandle<R>, offered: &str) -> Option<String> {
    // The keys are taken and the lock let go of before the sessions are asked
    // about: this side asks that one what is running and that one asks this side
    // what to put in an environment, so neither may be holding anything.
    let keys = {
        let state = app.state::<McpState>();
        state.standing().as_ref()?;
        state.keys.clone()
    };
    pty::running(app)
        .into_iter()
        .find(|session| token(&keys, &session.id) == offered)
        .map(|session| session.id)
}

/// Keeps what a session said, and tells the window. An empty report is a session
/// saying there is nothing to show, which is the same thing to the window as
/// never having said anything.
pub fn keep<R: Runtime>(app: &AppHandle<R>, id: &str, report: Report) {
    let state = app.state::<McpState>();
    let report = {
        let mut said = state.said();
        if report.empty() {
            said.remove(id);
            None
        } else {
            if said.get(id) == Some(&report) {
                return;
            }
            said.insert(id.to_string(), report.clone());
            Some(report)
        }
    };

    let _ = app.emit(
        REPORT_EVENT,
        Reported {
            id: id.to_string(),
            report,
        },
    );
}

/// Everything being worked on right now, for a window that has just come up. The
/// event carries these from moment to moment; a window that only listened would
/// show nothing until an agent next happened to say something.
pub fn reports<R: Runtime>(app: &AppHandle<R>) -> Vec<Reported> {
    app.state::<McpState>()
        .said()
        .iter()
        .map(|(id, report)| Reported {
            id: id.clone(),
            report: Some(report.clone()),
        })
        .collect()
}
