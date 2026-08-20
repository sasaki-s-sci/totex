//! Keeps the graph current without a rescan button.
//!
//! Watching the whole folder tree would burn one inotify watch per directory
//! and fire on every build artefact, so this watches the few places git itself
//! writes when the graph would change: each repository's git directory, its
//! refs and its worktree registry, plus the shallow part of the scanned tree
//! where a newly cloned repository would appear.

use std::collections::{BTreeMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};
use std::time::Duration;

use notify_debouncer_full::notify::RecursiveMode;
use notify_debouncer_full::{DebounceEventResult, Debouncer, RecommendedCache, new_debouncer};

/// How long to wait for a burst of writes to settle. A single `git commit`
/// touches several files, and a fetch touches many more.
const DEBOUNCE: Duration = Duration::from_millis(700);

/// How deep below the scanned root to look for repositories appearing later.
const NEW_REPOSITORY_DEPTH: usize = 2;

pub type Watch = Debouncer<notify_debouncer_full::notify::RecommendedWatcher, RecommendedCache>;

#[derive(Default)]
pub struct WatchState {
    /// One watcher per open folder, keyed the way the sessions are: each folder
    /// watches its own repositories, and is dropped on its own.
    watchers: Mutex<BTreeMap<String, Watch>>,
}

impl WatchState {
    // Dropping a debouncer stops its thread and releases the watches it held,
    // which is all any of these three have to do about the one they replace.
    pub fn set(&self, root: String, watch: Watch) {
        self.lock().insert(root, watch);
    }

    pub fn remove(&self, root: &str) {
        self.lock().remove(root);
    }

    pub fn clear(&self) {
        self.lock().clear();
    }

    fn lock(&self) -> MutexGuard<'_, BTreeMap<String, Watch>> {
        crate::sync::lock(&self.watchers)
    }
}

/// Builds the watch and reports the paths that moved through `on_change`.
///
/// The paths are the point: they are what lets the refresh re-read one
/// repository instead of all of them.
pub(super) fn start(
    root: &str,
    git_dirs: &[String],
    repository_paths: &[String],
    on_change: impl Fn(Vec<PathBuf>) + Send + 'static,
) -> Result<Watch, String> {
    let mut debouncer = new_debouncer(DEBOUNCE, None, move |result: DebounceEventResult| {
        let Ok(events) = result else {
            return;
        };
        let touched = relevant_paths(events.iter().flat_map(|event| event.paths.iter()));
        if !touched.is_empty() {
            on_change(touched);
        }
    })
    .map_err(|error| error.to_string())?;

    for target in watch_targets(root, git_dirs, repository_paths) {
        // A repository can vanish between the scan and here; a failed watch is
        // never worth failing the whole call over.
        let _ = debouncer.watch(&target.path, target.mode);
    }

    Ok(debouncer)
}

/// The paths worth acting on, deduplicated: a burst names the same file many
/// times, and each name costs the refresh a prefix match.
pub(super) fn relevant_paths<'a>(paths: impl Iterator<Item = &'a PathBuf>) -> Vec<PathBuf> {
    // Kept in order — the refresh reads them as a list — with a set alongside
    // to say what has already been taken. A fetch or a `gc` rewrites many refs
    // at once, and scanning the list for each of them is quadratic in a burst
    // whose size nothing bounds.
    let mut seen: HashSet<&PathBuf> = HashSet::new();
    let mut touched: Vec<PathBuf> = Vec::new();
    for path in paths {
        if is_relevant(path) && seen.insert(path) {
            touched.push(path.clone());
        }
    }
    touched
}

pub(super) struct Target {
    pub path: PathBuf,
    pub mode: RecursiveMode,
}

pub(super) fn watch_targets(
    root: &str,
    git_dirs: &[String],
    repository_paths: &[String],
) -> Vec<Target> {
    let mut targets: Vec<Target> = Vec::new();
    let mut taken: HashSet<PathBuf> = HashSet::new();
    let mut push = |path: PathBuf, mode: RecursiveMode| {
        // `shallow_directories` can hand over thousands of paths for a large
        // root, so what has already been taken is a set rather than a scan of
        // everything taken so far.
        if path.exists() && taken.insert(path.clone()) {
            targets.push(Target { path, mode });
        }
    };

    for git_dir in git_dirs {
        let git_dir = PathBuf::from(git_dir);
        // HEAD, packed-refs and the reflog all live directly in here.
        push(git_dir.clone(), RecursiveMode::NonRecursive);
        push(git_dir.join("refs"), RecursiveMode::Recursive);
        push(git_dir.join("worktrees"), RecursiveMode::Recursive);
    }

    // A repository cloned next to one we already know about.
    for path in repository_paths {
        if let Some(parent) = Path::new(path).parent() {
            push(parent.to_path_buf(), RecursiveMode::NonRecursive);
        }
    }

    for path in shallow_directories(Path::new(root), NEW_REPOSITORY_DEPTH) {
        push(path, RecursiveMode::NonRecursive);
    }

    targets
}

/// The root and its directories down to `depth`, which is where a new
/// repository realistically shows up.
fn shallow_directories(root: &Path, depth: usize) -> Vec<PathBuf> {
    let mut found = vec![root.to_path_buf()];
    let mut frontier = vec![root.to_path_buf()];

    for _ in 0..depth {
        let mut next = Vec::new();
        for dir in &frontier {
            next.extend(super::discover::child_directories(dir).unwrap_or_default());
        }
        found.extend(next.iter().cloned());
        frontier = next;
    }

    found
}

/// Filters out the churn git makes while it works, which would otherwise
/// trigger a rescan in the middle of an operation that is not finished.
pub(super) fn is_relevant(path: &Path) -> bool {
    let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
        return true;
    };
    !name.ends_with(".lock")
}
