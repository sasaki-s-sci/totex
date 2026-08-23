//! The open workspace, and the refresh that keeps it current.
//!
//! The snapshot lives here rather than in the UI, which is what lets a change
//! be answered with a diff: the backend already knows what the window is
//! showing, so it re-reads only the repositories a change could have touched
//! and reports what actually moved. A window that draws nothing new receives
//! nothing at all.
//!
//! `Session` knows nothing about Tauri; the commands at the bottom of this file
//! are the only part that does.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};

use tauri::{AppHandle, Emitter, Manager};

use super::delta::{self, WorkspaceDelta};
use super::inspect::{Located, id_of};
use super::model::{Repository, Workspace};
use super::watch;

/// Carries a `WorkspaceDelta` to the window that opened the workspace.
pub const DELTA_EVENT: &str = "workspace:delta";
/// Carries the message of a refresh that could not be completed.
pub const FAILED_EVENT: &str = "workspace:failed";

/// What the UI is showing, and everything needed to re-read it.
pub struct Session {
    root: PathBuf,
    commit_limit: usize,
    /// In display order, exactly as the UI has them.
    repositories: Vec<Repository>,
    /// Where each repository lives, by id. Ordered, so a refresh produces its
    /// warnings in a stable order rather than reporting a diff that is only
    /// the iteration order changing.
    located: BTreeMap<String, Located>,
    /// Every directory the walk has already resolved, so a re-survey skips
    /// `locate` for the ones that have not moved.
    candidates: HashMap<PathBuf, Located>,
    /// Problems from the walk itself, kept apart from inspection failures
    /// because a partial refresh does not re-walk.
    survey_warnings: Vec<String>,
    /// The warning list the UI has, which is the two kinds concatenated.
    warnings: Vec<String>,
}

impl Session {
    /// Scans `root` and becomes the snapshot every later refresh diffs against.
    pub fn open(root: &str, commit_limit: Option<usize>) -> Result<Self, String> {
        let root = super::normalize_root(root)?;
        let commit_limit = super::clamp_commit_limit(commit_limit);

        let survey = super::survey(&root, &HashMap::new());
        let located = index(&survey.repositories);
        let (mut repositories, failures) = super::inspect_all(survey.repositories, commit_limit);
        super::sort_repositories(&mut repositories);

        let mut warnings = survey.warnings.clone();
        warnings.extend(failures);

        Ok(Self {
            root,
            commit_limit,
            repositories,
            located,
            candidates: survey.candidates,
            survey_warnings: survey.warnings,
            warnings,
        })
    }

    pub fn root(&self) -> String {
        self.root.to_string_lossy().into_owned()
    }

    /// The whole snapshot, for the window that is about to draw it for the
    /// first time.
    pub fn workspace(&self) -> Workspace {
        Workspace {
            root: self.root(),
            repositories: self.repositories.clone(),
            warnings: self.warnings.clone(),
        }
    }

    pub fn git_dirs(&self) -> Vec<String> {
        self.repositories
            .iter()
            .map(|repository| repository.git_dir.clone())
            .collect()
    }

    pub fn paths(&self) -> Vec<String> {
        self.repositories
            .iter()
            .map(|repository| repository.path.clone())
            .collect()
    }

    /// Re-reads what `touched` could have changed — everything, when it is
    /// `None` — and returns the diff against the snapshot, which it replaces.
    pub fn refresh(&mut self, touched: Option<&[PathBuf]>) -> Result<WorkspaceDelta, String> {
        let plan = self.plan(touched);

        let mut survey_warnings = self.survey_warnings.clone();
        let mut located = self.located.clone();
        if plan.rediscover {
            if !crate::host::Host::of(&self.root).is_dir(&self.root) {
                return Err("not-a-directory".to_string());
            }
            let survey = super::survey(&self.root, &self.candidates);
            located = index(&survey.repositories);
            survey_warnings = survey.warnings;
            self.candidates = survey.candidates;
        }

        // A repository is re-read when a change pointed at it or when it is
        // new; everything else is carried over untouched, which is what keeps
        // a commit in one repository from costing a read of the other twenty.
        let mut carried: Vec<Repository> = Vec::new();
        let mut stale: Vec<Located> = Vec::new();
        for (id, entry) in &located {
            match self.repository(id) {
                Some(repository) if !plan.targets.contains(id) => carried.push(repository.clone()),
                _ => stale.push(entry.clone()),
            }
        }

        let (inspected, failures) = super::inspect_all(stale, self.commit_limit);
        let mut repositories = carried;
        repositories.extend(inspected);
        super::sort_repositories(&mut repositories);

        let mut warnings = survey_warnings.clone();
        warnings.extend(failures);

        let changed = delta::diff_workspace(
            &self.root(),
            &self.repositories,
            &self.warnings,
            &repositories,
            &warnings,
        );

        self.repositories = repositories;
        self.located = located;
        self.survey_warnings = survey_warnings;
        self.warnings = warnings;

        Ok(changed)
    }

    /// Where to run git for one repository: its own working directory.
    pub(super) fn repository_dir(&self, id: &str) -> Option<PathBuf> {
        self.located.get(id).map(|located| located.path.clone())
    }

    fn repository(&self, id: &str) -> Option<&Repository> {
        self.repositories
            .iter()
            .find(|repository| repository.id == id)
    }

    fn plan(&self, touched: Option<&[PathBuf]>) -> Plan {
        let Some(touched) = touched else {
            // An explicit refresh trusts nothing it already has.
            return Plan {
                rediscover: true,
                targets: self.located.keys().cloned().collect(),
            };
        };

        let mut plan = Plan {
            rediscover: false,
            targets: HashSet::new(),
        };
        for path in touched {
            match self.owner(path) {
                Some(id) => {
                    plan.targets.insert(id);
                }
                // A path under no repository we know about is the tree itself
                // moving: a clone landed, a folder was removed.
                None => plan.rediscover = true,
            }
        }
        plan
    }

    /// The repository a changed path belongs to.
    ///
    /// Repositories nest — a submodule sits inside its parent's worktree — so
    /// the innermost match is the one that changed, and matching is by whole
    /// path components: `alpha-feature` is not inside `alpha`.
    fn owner(&self, path: &Path) -> Option<String> {
        self.located
            .iter()
            .filter_map(|(id, located)| {
                let depth = [&located.common_dir, &located.path]
                    .into_iter()
                    .filter(|root| path.starts_with(root))
                    .map(|root| root.components().count())
                    .max()?;
                Some((depth, id))
            })
            .max_by_key(|(depth, _)| *depth)
            .map(|(_, id)| id.clone())
    }
}

/// What a change is worth re-reading.
struct Plan {
    /// The tree itself moved, so the walk has to run again.
    rediscover: bool,
    /// Repositories a change could have touched.
    targets: HashSet<String>,
}

fn index(located: &[Located]) -> BTreeMap<String, Located> {
    located
        .iter()
        .map(|entry| (id_of(entry), entry.clone()))
        .collect()
}

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

/// Re-reads every open folder, which is what a write has to do: a new worktree
/// can land under any of them, and only a re-survey finds it. A folder that
/// cannot be re-read does not stop the others.
fn refresh_all(app: &AppHandle) -> Result<Vec<WorkspaceDelta>, String> {
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
pub(super) fn report_all(app: &AppHandle) -> Result<(), String> {
    for changed in refresh_all(app)? {
        if !changed.is_empty() {
            let _ = app.emit(DELTA_EVENT, changed);
        }
    }
    Ok(())
}

/// Where to run git for one repository: its own working directory, in whichever
/// open folder holds it.
pub(super) fn repository_dir(app: &AppHandle, id: &str) -> Result<PathBuf, String> {
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
fn arm(app: &AppHandle, session: &Session) {
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
