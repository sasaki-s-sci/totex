//! The open workspaces, the commands that open and close them, and the watch
//! that drives their refreshes.

mod refresh;
mod snapshot;

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::{Mutex, MutexGuard};

use tauri::{AppHandle, Manager};

use refresh::arm;

pub use refresh::{report_all, repository_dir};

use super::delta::WorkspaceDelta;
use super::model::Workspace;
use super::watch;

pub(crate) use snapshot::Session;

/// Carries a `WorkspaceDelta` to the window that opened the workspace.
pub const DELTA_EVENT: &str = "workspace:delta";
/// Carries the message of a refresh that could not be completed.
pub const FAILED_EVENT: &str = "workspace:failed";

#[derive(Default)]
pub struct SessionState {
    /// One session per folder the window has expanded into the graph, keyed by
    /// the root its scan settled on. The graph draws all of them at once, and
    /// each one keeps its own snapshot so a commit in one folder is still
    /// answered with a diff of that folder alone.
    open: Mutex<BTreeMap<String, Session>>,
}

impl SessionState {
    pub(super) fn lock(&self) -> MutexGuard<'_, BTreeMap<String, Session>> {
        crate::sync::lock(&self.open)
    }
}

/// The key a folder is held under: the path its scan settled on. A folder that
/// has since been removed can no longer be canonicalized, so the name the
/// caller used is what it is looked up by.
fn key_of(root: &str) -> String {
    let path = PathBuf::from(root);
    crate::host::Host::of(&path)
        .resolve(&path)
        .unwrap_or(path)
        .to_string_lossy()
        .into_owned()
}

/// Opens `root`: scans it, keeps it as one of the snapshots to diff against,
/// and starts the watch that drives its refreshes. A folder that is already
/// open is simply scanned again.
#[tauri::command]
pub async fn scan_workspace(
    app: AppHandle,
    root: String,
    commit_limit: Option<usize>,
) -> Result<Workspace, String> {
    off_thread!({
        let session = Session::open(&root, commit_limit)?;
        let workspace = session.workspace();

        let state = app.state::<SessionState>();
        let mut guard = state.lock();
        arm(&app, &session);
        guard.insert(session.root(), session);

        Ok(workspace)
    })
}

/// Drops one folder's snapshot and stops its watch. With no folder named, drops
/// all of them, which is what the window going away amounts to.
#[tauri::command]
pub fn close_workspace(app: AppHandle, root: Option<String>) {
    let Some(root) = root else {
        forget_all(&app);
        return;
    };

    let key = key_of(&root);
    app.state::<SessionState>().lock().remove(&key);
    app.state::<watch::WatchState>().remove(&key);
}

/// Drops every folder's snapshot and stops every watch.
///
/// Both of those are readings of what is on disk, so this loses nothing that
/// scanning again would not find — which is what the window does next, and the
/// only thing it has to do. See `derived`, which is the other caller and the
/// reason this is written apart from the command above.
pub fn forget_all<R: tauri::Runtime>(app: &AppHandle<R>) {
    app.state::<SessionState>().lock().clear();
    app.state::<watch::WatchState>().clear();
}

pub(super) fn run_refresh(
    app: &AppHandle,
    root: &str,
    touched: Option<Vec<PathBuf>>,
) -> Result<WorkspaceDelta, String> {
    let state = app.state::<SessionState>();
    let mut guard = state.lock();
    let Some(session) = guard.get_mut(root) else {
        return Err("not-open".to_string());
    };

    let changed = session.refresh(touched.as_deref())?;

    // The watch is built from the repositories the scan found, so one that
    // appeared or vanished has to re-arm it.
    if !changed.added.is_empty() || !changed.removed.is_empty() {
        arm(app, session);
    }

    Ok(changed)
}
