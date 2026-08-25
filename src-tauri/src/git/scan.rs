//! Walking a root into the repositories under it, and reading each of them.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

use super::inspect::Located;
use super::model::Repository;
use super::{DEFAULT_COMMIT_LIMIT, MAX_COMMIT_LIMIT, SCAN_DEPTH, discover, inspect, parallel_map};

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
/// of `Path`: a folder inside a distribution is resolved by the distribution,
/// and `canonicalize` would answer for a share it is not going to read.
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

/// Walks `root` and resolves what it finds to repositories.
///
/// `known` is the previous survey's `candidates`: `locate` costs two git
/// subprocesses per directory, and a directory that was a repository a moment
/// ago still is, so a re-survey only pays for what is new.
pub(super) fn survey(root: &Path, known: &HashMap<PathBuf, Located>) -> Survey {
    let found = discover::discover(root, SCAN_DEPTH);
    let mut warnings = found.warnings;

    let located = parallel_map(found.candidates, |candidate| match known.get(&candidate) {
        Some(hit) => Ok((candidate, hit.clone())),
        None => match inspect::locate(&candidate) {
            Ok(located) => Ok((candidate, located)),
            Err(error) => Err((candidate, error)),
        },
    });

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

    Survey {
        repositories,
        candidates,
        warnings,
    }
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
/// still puts it where a full scan would have.
pub(super) fn sort_repositories(repositories: &mut [Repository]) {
    repositories.sort_by(|a, b| a.name.cmp(&b.name).then_with(|| a.path.cmp(&b.path)));
}
