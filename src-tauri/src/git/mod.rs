/// Wraps a blocking git operation so it never runs on the UI thread.
///
/// Declared before the modules that use it: `macro_rules!` is textually scoped,
/// so a macro defined inside one module cannot be reached from its siblings —
/// which is what had each of them writing the `spawn_blocking` dance out again.
macro_rules! off_thread {
    ($body:expr) => {
        tauri::async_runtime::spawn_blocking(move || $body)
            .await
            .map_err(|_| "task-failed".to_string())?
    };
}

// Public so `generate_handler!` can name its command the same way it names
// the other modules' commands.
pub mod changes;
mod cmd;
mod delta;
mod discover;
pub mod identity;
pub(crate) mod inspect;
// Public so `generate_handler!` can name its command the same way it names
// the other modules' commands.
pub mod message;
mod model;
// Public for `generate_handler!` as well: what one file has become, which is
// what a card on the canvas draws down its gutter.
pub mod patch;
pub(crate) mod scan;
// Public so `generate_handler!` can name its command the same way it names
// the other modules' commands.
pub mod remote;
#[cfg(test)]
mod tests;
pub mod workspace;
// Public so `generate_handler!` can name its commands the same way it names
// the other modules' commands.
pub mod session;
pub mod watch;

use std::collections::HashSet;
use std::path::Path;
use std::sync::Mutex;
use std::sync::atomic::{AtomicUsize, Ordering};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

pub use session::SessionState;
pub use watch::WatchState;

/// The walk always runs as deep as it is allowed to; the directory budget in
/// `discover` is what actually bounds it.
const SCAN_DEPTH: usize = 12;

/// How much history to load per repository. Enough to show the shape of a
/// project without turning the overview into tens of thousands of nodes.
const DEFAULT_COMMIT_LIMIT: usize = 300;
const MAX_COMMIT_LIMIT: usize = 5_000;

/// How many directories one listing may look at before it stops and says so.
///
/// A listing is asked for once per pane rather than once per row, so it may
/// look at far more than a per-row question ever could — and a project folder
/// of any size is well inside this. It still has to end: a root like a home
/// directory on a network share goes on for longer than anybody will wait,
/// and a pane that says "there may be more" is better than one that never
/// fills in.
const LIST_BUDGET: usize = 20_000;

/// Carries a `RepositoryFound` to the window, one per repository, as the
/// listing reaches it.
pub const FOUND_EVENT: &str = "repositories:found";

/// Reports the git that would read `path`, so the UI can explain the problem
/// instead of failing every scan with the same error.
///
/// `path` rather than nothing: a folder on a remote machine — a WSL
/// distribution, or one reached over ssh — is read by that machine's git, and a
/// Windows window that only ever opens those has no use for the git beside it —
/// which may well not be installed. Asking about the machine would draw the
/// missing-git rule over a window that works.
#[tauri::command(async)]
pub fn git_version(path: Option<String>) -> Result<String, String> {
    cmd::version(path.as_deref().map(Path::new))
}

/// The listings still wanted, by the token the window gave each one.
///
/// A walk cannot be interrupted from outside — it is a thread reading
/// directories — so it asks, before every directory, whether its token is
/// still here. `stop_listing` takes the token away, and the walk ends at the
/// next directory it would have read.
#[derive(Default)]
pub struct ListState {
    wanted: Mutex<HashSet<u64>>,
}

impl ListState {
    fn lock(&self) -> std::sync::MutexGuard<'_, HashSet<u64>> {
        crate::sync::lock(&self.wanted)
    }
}

/// One repository, as the pane lists it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FoundRepository {
    /// The last component of `path`: what the row says.
    pub name: String,
    /// Spelled the way the walk spells it — the resolved root joined down —
    /// which is the spelling a scan of the same directory settles on as its
    /// root, and what the window matches a row to its workspace by.
    pub path: String,
}

/// What the listing tells the window as it goes.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryFound {
    pub token: u64,
    pub path: String,
    pub name: String,
}

/// What the listing answers with once the walk has ended.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryList {
    /// `root` as the walk settled on it — links followed, `~` expanded.
    pub root: String,
    /// By name, then path: the order the graph lays repositories out in.
    pub repositories: Vec<FoundRepository>,
    /// The walk ran out of its directory budget, so there may be more.
    pub truncated: bool,
    pub warnings: Vec<String>,
}

/// Every repository under `root`, for the repository pane.
///
/// Streamed and returned both: each repository is sent as `FOUND_EVENT` the
/// moment the walk reaches it, so the pane fills in while a slow tree is
/// still being read, and the whole list comes back at the end, sorted, for
/// the pane to settle on. `token` is the window's name for this listing —
/// what the events carry, and what `stop_listing` takes.
///
/// `Err("stopped")` when the listing was stopped before it ended: the pane
/// that asked has gone, and whatever was found is not an answer to anything.
#[tauri::command]
pub async fn list_repositories(
    app: AppHandle,
    root: String,
    token: u64,
) -> Result<RepositoryList, String> {
    // Registered before the walk is even scheduled, so a stop that arrives
    // first still lands on this listing rather than on nothing.
    app.state::<ListState>().lock().insert(token);

    off_thread!({
        let listed = list(&app, &root, token);
        app.state::<ListState>().lock().remove(&token);
        listed
    })
}

/// Forgets `token`, which ends its walk at the next directory. Nothing to say
/// about a token that is not there: the listing has already ended.
#[tauri::command]
pub fn stop_listing(app: AppHandle, token: u64) {
    app.state::<ListState>().lock().remove(&token);
}

fn list(app: &AppHandle, root: &str, token: u64) -> Result<RepositoryList, String> {
    let root = scan::normalize_root(root)?;
    let host = crate::host::Host::of(&root);
    let describe = |path: &Path| FoundRepository {
        name: name_of(&host, path),
        path: path.to_string_lossy().into_owned(),
    };

    let listed = discover::list_repositories(
        &root,
        SCAN_DEPTH,
        LIST_BUDGET,
        |path| {
            let found = describe(path);
            let _ = app.emit(
                FOUND_EVENT,
                RepositoryFound {
                    token,
                    path: found.path,
                    name: found.name,
                },
            );
        },
        || app.state::<ListState>().lock().contains(&token),
    );
    if listed.stopped {
        return Err("stopped".to_string());
    }

    let mut repositories: Vec<FoundRepository> = listed
        .repositories
        .iter()
        .map(|path| describe(path))
        .collect();
    // The order the graph lays repositories out in: the order the rows
    // arrived in as the walk found them is not one anybody can read.
    repositories.sort_by(|a, b| scan::by_name(&a.name, &a.path, &b.name, &b.path));

    Ok(RepositoryList {
        root: root.to_string_lossy().into_owned(),
        repositories,
        truncated: listed.truncated,
        warnings: listed.warnings,
    })
}

/// What a row calls a repository: its directory's name, or the whole path for
/// one that has no name of its own — a drive, or a distribution's root.
fn name_of(host: &crate::host::Host, path: &Path) -> String {
    let name = host.name(path);
    if name.is_empty() {
        path.to_string_lossy().into_owned()
    } else {
        name
    }
}

/// Runs `worker` over `items` on a small thread pool, preserving input order.
/// Every step is a blocking `git` subprocess, so the scan is dominated by
/// process startup rather than CPU.
fn parallel_map<T, R, F>(items: Vec<T>, worker: F) -> Vec<R>
where
    T: Send,
    R: Send,
    F: Fn(T) -> R + Sync,
{
    if items.len() <= 1 {
        return items.into_iter().map(worker).collect();
    }

    let threads = std::thread::available_parallelism()
        .map(|count| count.get())
        .unwrap_or(4)
        .clamp(2, 16)
        .min(items.len());

    let cursor = AtomicUsize::new(0);
    let slots: Vec<Mutex<Option<R>>> = items.iter().map(|_| Mutex::new(None)).collect();
    let items: Vec<Mutex<Option<T>>> = items
        .into_iter()
        .map(|item| Mutex::new(Some(item)))
        .collect();

    std::thread::scope(|scope| {
        for _ in 0..threads {
            scope.spawn(|| {
                loop {
                    let index = cursor.fetch_add(1, Ordering::Relaxed);
                    let Some(slot) = items.get(index) else {
                        break;
                    };
                    let Some(item) = slot.lock().expect("worker slot poisoned").take() else {
                        continue;
                    };
                    *slots[index].lock().expect("result slot poisoned") = Some(worker(item));
                }
            });
        }
    });

    slots
        .into_iter()
        .filter_map(|slot| slot.into_inner().expect("result slot poisoned"))
        .collect()
}
