//! Keeps the folder tree honest without a refresh button.
//!
//! The tree reads a directory when it is expanded and would then show that
//! reading forever — a worktree removed a moment ago stays on screen until
//! somebody thinks to press refresh. So the directories the tree currently has
//! open are watched, and each one is told when its own contents move.
//!
//! Only the levels that are open are watched, and none of them recursively: an
//! expanded tree is a handful of directories, while the tree below them is
//! however large the checkout is.
//!
//! The tree can have folders from more than one machine open at once — a
//! Windows drive in one pane and a distribution in the next — so the set is
//! split by where each directory lives. This machine's own notifications watch
//! its own; a distribution is asked from inside, because Windows is never told
//! that a file under the share moved.

use std::collections::{BTreeMap, BTreeSet};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use notify_debouncer_full::notify::RecursiveMode;
use notify_debouncer_full::{DebounceEventResult, Debouncer, RecommendedCache, new_debouncer};
use tauri::{AppHandle, Emitter, Runtime, State};

use crate::host::Host;
use crate::wsl;

/// Carries the directories whose contents moved, as absolute paths.
pub const CHANGED_EVENT: &str = "fs:changed";

/// Long enough to collect the burst a single command makes, short enough that
/// the tree still reads as answering the command itself.
const DEBOUNCE: Duration = Duration::from_millis(120);

type Local = Debouncer<notify_debouncer_full::notify::RecommendedWatcher, RecommendedCache>;

/// Everything watching for the tree as it now stands.
///
/// Dropping it stops all of it — the local watcher's thread and every poll
/// running inside a distribution — which is the only thing replacing the set
/// has to do about the set it replaces.
#[derive(Default)]
struct Watching {
    /// The directories this was built for, so a set that has not changed is
    /// recognised before anything is torn down.
    paths: BTreeSet<PathBuf>,
    local: Option<Local>,
    inside: Vec<wsl::Poll>,
}

#[derive(Default)]
pub struct BrowseWatch {
    current: Mutex<Option<Watching>>,
}

impl BrowseWatch {
    fn watching(&self) -> BTreeSet<PathBuf> {
        crate::sync::lock(&self.current)
            .as_ref()
            .map(|held| held.paths.clone())
            .unwrap_or_default()
    }

    fn replace(&self, next: Option<Watching>) {
        let mut guard = crate::sync::lock(&self.current);
        *guard = next;
    }

    /// Stops watching altogether. The tree says what it wants watched every
    /// time it changes, so what this costs is one round of notifications
    /// nobody had asked about yet.
    pub fn clear(&self) {
        self.replace(None);
    }
}

/// Watches exactly `paths` — the directories the tree has open — and nothing
/// else. Called again with the new set every time a folder is expanded or
/// collapsed; an empty list stops watching altogether.
#[tauri::command]
pub fn watch_directories<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, BrowseWatch>,
    paths: Vec<String>,
) -> Result<(), String> {
    let wanted: BTreeSet<PathBuf> = paths.into_iter().map(PathBuf::from).collect();
    // The tree re-sends its set on every expand and collapse, and most of those
    // are one directory different from the last. Rebuilding the watcher for a
    // set it is already watching would drop and re-take every watch.
    if wanted == state.watching() {
        return Ok(());
    }

    if wanted.is_empty() {
        state.replace(None);
        return Ok(());
    }

    let watched = Arc::new(wanted.clone());
    let mut held = Watching {
        paths: wanted.clone(),
        ..Watching::default()
    };

    let mut elsewhere: BTreeMap<String, Vec<PathBuf>> = BTreeMap::new();
    let mut here: Vec<PathBuf> = Vec::new();
    for path in &wanted {
        match Host::of(path) {
            Host::Local => here.push(path.clone()),
            Host::Wsl(distro) => elsewhere.entry(distro).or_default().push(path.clone()),
        }
    }

    if !here.is_empty() {
        held.local = Some(locally(&app, Arc::clone(&watched), &here)?);
    }
    for (distro, paths) in elsewhere {
        // A distribution that will not answer costs the folders inside it their
        // refreshes and nothing else. The rest of the tree is still watched,
        // which is what a tree spanning two machines has to be able to do.
        if let Ok(poll) = inside(&app, Arc::clone(&watched), &distro, &paths) {
            held.inside.push(poll);
        }
    }

    state.replace(Some(held));
    Ok(())
}

/// The directories on this machine, watched by it.
fn locally<R: Runtime>(
    app: &AppHandle<R>,
    watched: Arc<BTreeSet<PathBuf>>,
    paths: &[PathBuf],
) -> Result<Local, String> {
    let handle = app.clone();
    let mut debouncer = new_debouncer(DEBOUNCE, None, move |result: DebounceEventResult| {
        let Ok(events) = result else {
            return;
        };
        let touched = directories(events.iter().flat_map(|event| event.paths.iter()), &watched);
        if !touched.is_empty() {
            let _ = handle.emit(CHANGED_EVENT, touched);
        }
    })
    .map_err(|error| error.to_string())?;

    for path in paths {
        // A directory can go away between the tree reading it and here; one
        // that cannot be watched simply is not, and the rest still are.
        let _ = debouncer.watch(path, RecursiveMode::NonRecursive);
    }

    Ok(debouncer)
}

/// The directories inside one distribution, watched from inside it.
fn inside<R: Runtime>(
    app: &AppHandle<R>,
    watched: Arc<BTreeSet<PathBuf>>,
    distro: &str,
    paths: &[PathBuf],
) -> Result<wsl::Poll, String> {
    let host = Host::Wsl(distro.to_string());
    let native: Vec<String> = paths.iter().map(|path| host.native(path)).collect();
    let handle = app.clone();

    wsl::watch(distro, false, &native, move |moved| {
        let paths: Vec<PathBuf> = moved.iter().map(|path| host.canonical(path)).collect();
        let touched = directories(paths.iter(), &watched);
        if !touched.is_empty() {
            let _ = handle.emit(CHANGED_EVENT, touched);
        }
    })
}

/// The watched directories a burst of paths belongs to.
///
/// An event names the file that moved, but what the tree redraws is the
/// directory holding it — and the directory itself is named when it is the one
/// that was created or removed, in which case its parent is what has to be
/// re-read.
fn directories<'a>(
    paths: impl Iterator<Item = &'a PathBuf>,
    watched: &BTreeSet<PathBuf>,
) -> Vec<String> {
    let mut touched: Vec<String> = Vec::new();
    for path in paths {
        let host = Host::of(path);
        for candidate in [host.parent(path), Some(path.clone())]
            .into_iter()
            .flatten()
        {
            if watched.contains(&candidate) {
                let named = candidate.to_string_lossy().into_owned();
                if !touched.contains(&named) {
                    touched.push(named);
                }
            }
        }
    }
    touched
}

#[cfg(test)]
mod tests;
