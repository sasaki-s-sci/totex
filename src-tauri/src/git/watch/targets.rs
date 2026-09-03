//! Which paths a repository is watched at, and which of a burst of writes is
//! worth re-reading it for.

use std::collections::HashSet;
use std::path::{Path, PathBuf};

use notify_debouncer_full::notify::RecursiveMode;

use crate::host::Host;

use super::super::discover;
use super::NEW_REPOSITORY_DEPTH;

/// The paths worth acting on, deduplicated: a burst names the same file many
/// times, and each name costs the refresh a prefix match.
pub(crate) fn relevant_paths<'a>(paths: impl Iterator<Item = &'a PathBuf>) -> Vec<PathBuf> {
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

pub(crate) struct Target {
    pub path: PathBuf,
    pub mode: RecursiveMode,
}

pub(crate) fn watch_targets(
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
        // And what the repository itself says about how it is drawn, which is a
        // file somebody edits by hand rather than something git ever writes:
        // nothing else in here would fire for it. See `inspect::ignore`.
        push(
            host.join(Path::new(path), crate::space::DIR),
            RecursiveMode::NonRecursive,
        );
    }

    // And the one the folder itself keeps, which covers every repository under
    // it that has none of its own.
    push(
        host.join(Path::new(root), crate::space::DIR),
        RecursiveMode::NonRecursive,
    );

    for path in discover::levels(host, Path::new(root), NEW_REPOSITORY_DEPTH) {
        push(path, RecursiveMode::NonRecursive);
    }

    targets
}

/// Filters out the churn git makes while it works, which would otherwise
/// trigger a rescan in the middle of an operation that is not finished.
pub(crate) fn is_relevant(path: &Path) -> bool {
    let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
        return true;
    };
    !name.ends_with(".lock")
}
