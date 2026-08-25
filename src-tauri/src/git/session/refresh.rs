//! Answering a change: re-read what it could have touched, and tell the window
//! what actually moved.

use std::path::PathBuf;

use tauri::{AppHandle, Emitter, Manager};

use super::super::delta::WorkspaceDelta;
use super::super::watch;
use super::{DELTA_EVENT, FAILED_EVENT, Session, SessionState, run_refresh};

/// Re-reads every open folder, which is what a write has to do: a new worktree
/// can land under any of them, and only a re-survey finds it. A folder that
/// cannot be re-read does not stop the others.
pub(super) fn refresh_all(app: &AppHandle) -> Result<Vec<WorkspaceDelta>, String> {
    let roots: Vec<String> = app.state::<SessionState>().lock().keys().cloned().collect();

    let mut deltas = Vec::new();
    let mut failure = None;
    for root in roots {
        match run_refresh(app, &root, None) {
            Ok(changed) => deltas.push(changed),
            Err(error) => failure = failure.or(Some(error)),
        }
    }

    // Only when nothing at all could be re-read is this the caller's problem;
    // otherwise the folders that did move are the answer.
    match failure {
        Some(error) if deltas.is_empty() => Err(error),
        _ => Ok(deltas),
    }
}

/// Re-reads every open folder and tells the window about each one that moved.
/// What a write does after it has run git, the same way a watch would.
pub fn report_all(app: &AppHandle) -> Result<(), String> {
    for changed in refresh_all(app)? {
        if !changed.is_empty() {
            let _ = app.emit(DELTA_EVENT, changed);
        }
    }
    Ok(())
}

/// Where to run git for one repository: its own working directory, in whichever
/// open folder holds it.
pub fn repository_dir(app: &AppHandle, id: &str) -> Result<PathBuf, String> {
    let state = app.state::<SessionState>();
    let guard = state.lock();
    if guard.is_empty() {
        return Err("no-folder".into());
    }
    guard
        .values()
        .find_map(|session| session.repository_dir(id))
        .ok_or_else(|| "unknown-repository".to_string())
}

/// Points a watch at the repositories one snapshot holds. Called with the
/// session lock held, which is the only order these two are ever taken in.
pub(super) fn arm(app: &AppHandle, session: &Session) {
    let root = session.root();
    let handle = app.clone();
    let reporting = root.clone();
    let watcher = watch::start(
        &root,
        &session.git_dirs(),
        &session.paths(),
        move |touched| on_change(&handle, &reporting, touched),
    );

    // A watch that will not start costs that folder its live updates, not its
    // graph, so it is reported and not raised.
    match watcher {
        Ok(watcher) => app.state::<watch::WatchState>().set(root, watcher),
        Err(error) => {
            app.state::<watch::WatchState>().remove(&root);
            let _ = app.emit(FAILED_EVENT, error);
        }
    }
}

/// Answers the watch off its own thread: the refresh runs git, and the
/// debouncer has to stay free to collect events while it does.
fn on_change(app: &AppHandle, root: &str, touched: Vec<PathBuf>) {
    let handle = app.clone();
    let root = root.to_string();
    tauri::async_runtime::spawn_blocking(move || {
        // The folder can be collapsed while its watcher is mid-flight, and a
        // folder nobody is showing has nothing to report.
        if !handle.state::<SessionState>().lock().contains_key(&root) {
            return;
        }

        match run_refresh(&handle, &root, Some(touched)) {
            // Silence is the common case: git writes its directory far more
            // often than it changes the graph, and a window with nothing to
            // redraw is left alone.
            Ok(changed) if changed.is_empty() => {}
            Ok(changed) => {
                let _ = handle.emit(DELTA_EVENT, changed);
            }
            Err(error) => {
                let _ = handle.emit(FAILED_EVENT, error);
            }
        }
    });
}
