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

use std::collections::HashMap;
use std::path::Path;
use std::sync::Mutex;
use std::sync::atomic::{AtomicUsize, Ordering};

pub use session::SessionState;
pub use watch::WatchState;

/// The walk always runs as deep as it is allowed to; the directory budget in
/// `discover` is what actually bounds it.
const SCAN_DEPTH: usize = 12;

/// How much history to load per repository. Enough to show the shape of a
/// project without turning the overview into tens of thousands of nodes.
const DEFAULT_COMMIT_LIMIT: usize = 300;
const MAX_COMMIT_LIMIT: usize = 5_000;

/// How many directories one "is there anything in here?" question may look at
/// before it gives up and says yes.
///
/// The walk stops at the first repository, so this only bounds the folders that
/// have none — and those are the ones nobody is waiting on. Small, because a
/// listing asks about every folder in it at once and some of those folders are
/// on a network share.
const HOLD_BUDGET: usize = 200;

/// Reports the git that would read `path`, so the UI can explain the problem
/// instead of failing every scan with the same error.
///
/// `path` rather than nothing: a folder inside a WSL distribution is read by
/// that distribution's git, and a Windows window that only ever opens those has
/// no use for the git beside it — which may well not be installed. Asking about
/// the machine would draw the missing-git rule over a window that works.
#[tauri::command(async)]
pub fn git_version(path: Option<String>) -> Result<String, String> {
    cmd::version(path.as_deref().map(Path::new))
}

/// How many repositories each of `paths` holds — itself, or somewhere
/// underneath.
///
/// What the folder column puts on its graph mark. Every folder can be put on
/// the graph, repository or not — a folder is a place work happens — so this
/// says what is in one rather than whether it is worth offering. Asked one
/// listing at a time and walked in parallel, because the folders in a listing
/// are independent and some of them are slow.
///
/// The depth is the scan's own, so the question and the answer agree: a folder
/// this counts one in is a folder the scan would find something in. Only the
/// folders that hold any are answered for, which is most of a listing left out.
#[tauri::command(async)]
pub fn repository_counts(paths: Vec<String>) -> HashMap<String, usize> {
    parallel_map(paths, |path| {
        let found = discover::count_repositories(Path::new(&path), SCAN_DEPTH, HOLD_BUDGET);
        (path, found)
    })
    .into_iter()
    .filter(|(_, found)| *found > 0)
    .collect()
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
