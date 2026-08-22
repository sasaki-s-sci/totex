//! Keeps the graph current without a rescan button.
//!
//! Watching the whole folder tree would burn one inotify watch per directory
//! and fire on every build artefact, so this watches the few places git itself
//! writes when the graph would change: each repository's git directory, its
//! refs and its worktree registry, plus the shallow part of the scanned tree
//! where a newly cloned repository would appear.
//!
//! A folder inside a WSL distribution is watched by asking the distribution.
//! Windows publishes the share but not its notifications — nothing on this side
//! is ever told that a file in there moved — so the same targets are polled
//! from inside instead, and what comes back is the same thing: the paths that
//! were written, which is what lets a refresh re-read one repository.

use std::collections::{BTreeMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Duration;

use notify_debouncer_full::notify::RecursiveMode;
use notify_debouncer_full::{DebounceEventResult, Debouncer, RecommendedCache, new_debouncer};

use crate::host::Host;
use crate::wsl;

/// How long to wait for a burst of writes to settle. A single `git commit`
/// touches several files, and a fetch touches many more.
const DEBOUNCE: Duration = Duration::from_millis(700);

/// How deep below the scanned root to look for repositories appearing later.
const NEW_REPOSITORY_DEPTH: usize = 2;

type Local = Debouncer<notify_debouncer_full::notify::RecommendedWatcher, RecommendedCache>;

/// What is watching one open folder, on whichever side of the window it lives.
///
/// Held rather than read: both kinds stop when they are dropped, and dropping
/// the one it replaces is the whole of what the state below has to do.
pub struct Watch {
    /// This machine's own change notifications.
    _here: Option<Local>,
    /// A poll running inside a distribution — one per group of targets.
    _inside: Vec<wsl::Poll>,
}

#[derive(Default)]
pub struct WatchState {
    /// One watcher per open folder, keyed the way the sessions are: each folder
    /// watches its own repositories, and is dropped on its own.
    watchers: Mutex<BTreeMap<String, Watch>>,
}

impl WatchState {
    // Dropping a watch stops its thread and releases whatever it held, which is
    // all any of these three have to do about the one they replace.
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
    on_change: impl Fn(Vec<PathBuf>) + Send + Sync + 'static,
) -> Result<Watch, String> {
    let host = Host::of(Path::new(root));
    let targets = watch_targets(&host, root, git_dirs, repository_paths);

    match &host {
        Host::Local => here(targets, on_change),
        Host::Wsl(distro) => inside(&host, distro, targets, on_change),
    }
}

fn here(
    targets: Vec<Target>,
    on_change: impl Fn(Vec<PathBuf>) + Send + Sync + 'static,
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

    for target in targets {
        // A repository can vanish between the scan and here; a failed watch is
        // never worth failing the whole call over.
        let _ = debouncer.watch(&target.path, target.mode);
    }

    Ok(Watch {
        _here: Some(debouncer),
        _inside: Vec::new(),
    })
}

/// The same targets, polled from inside the distribution holding them.
///
/// Two polls rather than one: `find` takes a single depth for every start point
/// it is given, and these targets do not all want the same one — a git
/// directory is watched for the files directly in it, its refs all the way
/// down.
fn inside(
    host: &Host,
    distro: &str,
    targets: Vec<Target>,
    on_change: impl Fn(Vec<PathBuf>) + Send + Sync + 'static,
) -> Result<Watch, String> {
    let told = Arc::new(on_change);
    let mut polls = Vec::new();

    for recursive in [false, true] {
        let paths: Vec<String> = targets
            .iter()
            .filter(|target| matches!(target.mode, RecursiveMode::Recursive) == recursive)
            .map(|target| host.native(&target.path))
            .collect();
        if paths.is_empty() {
            continue;
        }

        let told = Arc::clone(&told);
        let host = host.clone();
        polls.push(wsl::watch(distro, recursive, &paths, move |moved| {
            let paths: Vec<PathBuf> = moved.iter().map(|path| host.canonical(path)).collect();
            let touched = relevant_paths(paths.iter());
            if !touched.is_empty() {
                told(touched);
            }
        })?);
    }

    Ok(Watch {
        _here: None,
        _inside: polls,
    })
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
    host: &Host,
    root: &str,
    git_dirs: &[String],
    repository_paths: &[String],
) -> Vec<Target> {
    let mut targets: Vec<Target> = Vec::new();
    let mut taken: HashSet<PathBuf> = HashSet::new();
    let mut push = |path: PathBuf, mode: RecursiveMode| {
        // `levels` can hand over thousands of paths for a large root, so what
        // has already been taken is a set rather than a scan of everything
        // taken so far.
        //
        // Whether it is there is only asked on this machine. A poll is handed
        // its targets as words and says nothing about the ones that are not
        // there, so asking would be a round trip apiece for an answer that
        // changes nothing.
        let here = !host.is_remote();
        if (!here || path.exists()) && taken.insert(path.clone()) {
            targets.push(Target { path, mode });
        }
    };

    for git_dir in git_dirs {
        let git_dir = PathBuf::from(git_dir);
        // HEAD, packed-refs and the reflog all live directly in here.
        push(git_dir.clone(), RecursiveMode::NonRecursive);
        push(host.join(&git_dir, "refs"), RecursiveMode::Recursive);
        push(host.join(&git_dir, "worktrees"), RecursiveMode::Recursive);
    }

    // A repository cloned next to one we already know about.
    for path in repository_paths {
        if let Some(parent) = host.parent(Path::new(path)) {
            push(parent, RecursiveMode::NonRecursive);
        }
    }

    for path in super::discover::levels(host, Path::new(root), NEW_REPOSITORY_DEPTH) {
        push(path, RecursiveMode::NonRecursive);
    }

    targets
}

/// Filters out the churn git makes while it works, which would otherwise
/// trigger a rescan in the middle of an operation that is not finished.
pub(super) fn is_relevant(path: &Path) -> bool {
    let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
        return true;
    };
    !name.ends_with(".lock")
}
