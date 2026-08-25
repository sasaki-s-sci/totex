//! Standing the server up and taking it down, and joining it to the sessions.

use std::sync::Arc;
use std::sync::atomic::Ordering;

use tauri::{AppHandle, Emitter, Manager, Runtime};

use super::{ADDRESS_VAR, McpState, REPORT_EVENT, Reported, address};
use crate::pty::{Event, PtyState};

/// The port the server is answering on, or nothing when it is not up.
pub fn serving<R: Runtime>(app: &AppHandle<R>) -> Option<u16> {
    app.state::<McpState>()
        .standing()
        .as_ref()
        .map(|up| up.port)
}

/// Stands the server up, and says which port it took.
///
/// Idempotent: asking for a server that is already up is being told where it is.
/// Nothing about the sessions changes here — a terminal is handed its address
/// when it starts, so the ones already running stay without one.
pub fn serve<R: Runtime>(app: &AppHandle<R>) -> Result<u16, String> {
    let state = app.state::<McpState>();
    let mut standing = state.standing();
    if let Some(up) = standing.as_ref() {
        return Ok(up.port);
    }

    let up = super::serve::listen(app.clone(), state.last.load(Ordering::Relaxed))?;
    let port = up.port;
    state.last.store(port, Ordering::Relaxed);
    *standing = Some(up);
    Ok(port)
}

/// Takes it down again, and takes the reports with it: with the door shut no
/// agent can say what it is doing now, and a card that cannot be corrected is a
/// card that will be wrong. The sessions carry on — none of this was theirs.
pub fn unserve<R: Runtime>(app: &AppHandle<R>) {
    let state = app.state::<McpState>();
    if let Some(up) = state.standing().take() {
        up.stopping.store(true, Ordering::Relaxed);
    }

    let dropped: Vec<String> = state.said().drain().map(|(id, _)| id).collect();
    for id in dropped {
        let _ = app.emit(REPORT_EVENT, Reported { id, report: None });
    }
}

/// Joins this to the sessions, for the life of the app.
///
/// Two seams, both the session module's own: every session that starts is handed
/// the address of its own door in its environment, and this side is told when
/// one has ended. A report is kept for exactly as long as the session is there
/// to correct it — after that it is a claim about a process that no longer
/// exists, which is worse than nothing.
pub fn attend<R: Runtime>(app: &AppHandle<R>) {
    let dressing = app.clone();
    app.state::<PtyState>().dress(Arc::new(move |id, cwd| {
        // Nothing at all while the server is down, or where the session could
        // not reach it: an agent told an address it cannot use is an agent that
        // reports a connection nobody asked it to make.
        match address(&dressing, id, cwd) {
            Some(url) => vec![(ADDRESS_VAR.to_string(), url)],
            None => Vec::new(),
        }
    }));

    let handle = app.clone();
    app.state::<PtyState>().follow(Arc::new(move |id, event| {
        if !matches!(event, Event::Ended) {
            return;
        }
        let state = handle.state::<McpState>();
        if state.said().remove(id).is_none() {
            return;
        }
        let _ = handle.emit(
            REPORT_EVENT,
            Reported {
                id: id.to_string(),
                report: None,
            },
        );
    }));
}
