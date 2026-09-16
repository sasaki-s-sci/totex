//! Walking a root into the repositories under it, and reading each of them.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

use super::inspect::Located;
use super::model::Repository;
use super::{DEFAULT_COMMIT_LIMIT, MAX_COMMIT_LIMIT, SCAN_DEPTH, discover, inspect, parallel_map};

/// What a root is opened as, which is what a survey of it looks for.
///
/// The window puts a root on the canvas either as a folder — everything under
/// it is walked for repositories — or as one repository picked out of the
/// repository pane, whose listing has already done the walking. A repository
/// is scanned alone: what is inside it, submodules included, belongs to it,
/// and the pane it was picked from lists the projects beside it separately.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Scope {
    Folder,
    Repository,
}

/// Where the repositories under a root are, without having read any of them.
pub(super) struct Survey {
    /// One entry per repository, deduplicated by common git directory.
    pub repositories: Vec<Located>,
    /// Every candidate directory that resolved, so a later survey of the same
    /// root can skip `locate` for the ones that have not moved.
    pub candidates: HashMap<PathBuf, Located>,
    pub warnings: Vec<String>,
}

/// The scanned root, settled: it is there, it is a directory, and every link
/// along the way to it has been followed.
///
/// Resolved because git answers in resolved paths, and the graph matches what
/// git says against this. Asked of the machine holding the folder rather than
/// of `Path`: a folder on a remote machine is resolved by that machine, and
/// `canonicalize` would answer for a share it is not going to read — or for a
/// url it cannot read at all.
pub(super) fn normalize_root(root: &str) -> Result<PathBuf, String> {
    let host = crate::host::Host::of_str(root);
    let path = PathBuf::from(root);
    if !host.is_dir(&path) {
        return Err("not-a-directory".to_string());
    }
    Ok(host.resolve(&path).unwrap_or(path))
}

pub(super) fn clamp_commit_limit(limit: Option<usize>) -> usize {
    limit
        .unwrap_or(DEFAULT_COMMIT_LIMIT)
        .clamp(1, MAX_COMMIT_LIMIT)
}

/// Walks `root` — or, for a repository, takes it as it is — and resolves what
/// it finds to repositories.
///
/// `known` is the previous survey's `candidates`: `locate` costs two git
/// subprocesses per directory, and a directory that was a repository a moment
/// ago still is, so a re-survey only pays for what is new.
///
/// A folder never fails: a directory that is not a repository is just not one.
/// A repository that turns out not to be one is a failure, and the error is
/// git's own — the root was opened as a repository, and there is nothing else
/// to show for it.
pub(super) fn survey(
    root: &Path,
    known: &HashMap<PathBuf, Located>,
    scope: Scope,
) -> Result<Survey, String> {
    let found = match scope {
        Scope::Folder => discover::discover(root, SCAN_DEPTH),
        Scope::Repository => discover::Discovery {
            candidates: vec![root.to_path_buf()],
            warnings: Vec::new(),
        },
    };
    let mut warnings = found.warnings;

    let located = parallel_map(found.candidates, |candidate| match known.get(&candidate) {
        Some(hit) => Ok((candidate, hit.clone())),
        None => match inspect::locate(&candidate) {
            Ok(located) => Ok((candidate, located)),
            Err(error) => Err((candidate, error)),
        },
    });

    if scope == Scope::Repository
        && let Some(Err((_, error))) = located.iter().find(|result| result.is_err())
    {
        return Err(error.clone());
    }

    // Linked worktrees resolve to the same repository as their main worktree,
    // so a folder holding both must still produce a single node.
    let mut seen: HashSet<PathBuf> = HashSet::new();
    let mut repositories = Vec::new();
    let mut candidates = HashMap::new();
    for result in located {
        match result {
            Ok((candidate, located)) => {
                if seen.insert(located.common_dir.clone()) {
                    repositories.push(located.clone());
                }
                candidates.insert(candidate, located);
            }
            Err((candidate, error)) => {
                warnings.push(format!("skipped {}: {error}", candidate.display()));
            }
        }
    }

    Ok(Survey {
        repositories,
        candidates,
        warnings,
    })
}

/// Reads every repository in `located`, in parallel, and reports the ones that
/// failed as warnings rather than dropping them silently.
pub(super) fn inspect_all(
    located: Vec<Located>,
    commit_limit: usize,
) -> (Vec<Repository>, Vec<String>) {
    let inspected = parallel_map(located, |located| {
        let path = located.path.clone();
        inspect::inspect(&located, commit_limit).map_err(|error| (path, error))
    });

    let mut repositories = Vec::new();
    let mut warnings = Vec::new();
    for result in inspected {
        match result {
            Ok(repository) => repositories.push(repository),
            Err((path, error)) => warnings.push(format!("skipped {}: {error}", path.display())),
        }
    }

    (repositories, warnings)
}

/// The order the graph is laid out in, so a refresh that adds a repository
/// still puts it where a full scan would have: one alphabet whatever the
/// case, then the path, the same order the repository pane lists in.
pub(super) fn sort_repositories(repositories: &mut [Repository]) {
    repositories.sort_by(|a, b| by_name(&a.name, &a.path, &b.name, &b.path));
}

/// One alphabet whatever the case (`Blender` stands between `abc` and
/// `notes`), the path deciding between same-named repositories.
pub(super) fn by_name(
    a_name: &str,
    a_path: &str,
    b_name: &str,
    b_path: &str,
) -> std::cmp::Ordering {
    a_name
        .to_lowercase()
        .cmp(&b_name.to_lowercase())
        .then_with(|| a_path.cmp(b_path))
}
