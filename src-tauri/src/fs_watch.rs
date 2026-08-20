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

use std::collections::BTreeSet;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;

use notify_debouncer_full::notify::RecursiveMode;
use notify_debouncer_full::{DebounceEventResult, Debouncer, RecommendedCache, new_debouncer};
use tauri::{AppHandle, Emitter, Runtime, State};

/// Carries the directories whose contents moved, as absolute paths.
pub const CHANGED_EVENT: &str = "fs:changed";

/// Long enough to collect the burst a single command makes, short enough that
/// the tree still reads as answering the command itself.
const DEBOUNCE: Duration = Duration::from_millis(120);

type Watch = Debouncer<notify_debouncer_full::notify::RecommendedWatcher, RecommendedCache>;

#[derive(Default)]
pub struct BrowseWatch {
    /// The live watcher, and the directories it was built for.
    current: Mutex<Option<(Watch, BTreeSet<PathBuf>)>>,
}

impl BrowseWatch {
    fn watching(&self) -> BTreeSet<PathBuf> {
        crate::sync::lock(&self.current)
            .as_ref()
            .map(|(_, paths)| paths.clone())
            .unwrap_or_default()
    }

    fn replace(&self, next: Option<(Watch, BTreeSet<PathBuf>)>) {
        let mut guard = crate::sync::lock(&self.current);
        // Dropping the previous debouncer stops its thread and releases the
        // watches it held.
        *guard = next;
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

    let handle = app.clone();
    let watched = wanted.clone();
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

    for path in &wanted {
        // A directory can go away between the tree reading it and here; one
        // that cannot be watched simply is not, and the rest still are.
        let _ = debouncer.watch(path, RecursiveMode::NonRecursive);
    }

    state.replace(Some((debouncer, wanted)));
    Ok(())
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
        for candidate in [path.parent(), Some(path.as_path())].into_iter().flatten() {
            if watched.contains(candidate) {
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
mod tests {
    use super::*;

    #[test]
    fn reports_the_watched_directory_a_file_belongs_to() {
        let watched: BTreeSet<PathBuf> = [PathBuf::from("/tmp/demo")].into_iter().collect();
        let paths = [PathBuf::from("/tmp/demo/alpha.txt")];
        assert_eq!(directories(paths.iter(), &watched), vec!["/tmp/demo"]);
    }

    #[test]
    fn reports_a_watched_directory_that_moved_itself() {
        let watched: BTreeSet<PathBuf> = [PathBuf::from("/tmp/demo/alpha")].into_iter().collect();
        let paths = [PathBuf::from("/tmp/demo/alpha")];
        assert_eq!(directories(paths.iter(), &watched), vec!["/tmp/demo/alpha"]);
    }

    #[test]
    fn ignores_paths_no_open_directory_is_showing() {
        let watched: BTreeSet<PathBuf> = [PathBuf::from("/tmp/demo")].into_iter().collect();
        let paths = [PathBuf::from("/tmp/other/beta.txt")];
        assert!(directories(paths.iter(), &watched).is_empty());
    }

    #[test]
    fn names_each_directory_once_however_many_files_moved() {
        let watched: BTreeSet<PathBuf> = [PathBuf::from("/tmp/demo")].into_iter().collect();
        let paths = [
            PathBuf::from("/tmp/demo/one.txt"),
            PathBuf::from("/tmp/demo/two.txt"),
        ];
        assert_eq!(directories(paths.iter(), &watched), vec!["/tmp/demo"]);
    }
}
