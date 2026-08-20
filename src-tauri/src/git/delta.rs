//! What changed between two snapshots of a workspace.
//!
//! A rescan re-reads whole repositories, but almost nothing in them moves: a
//! commit lands, a branch tip advances, a worktree is pruned. Sending the whole
//! workspace again would make the UI rebuild a graph it has already drawn, so
//! the refresh reports a diff instead and the UI patches what it has.

use std::collections::HashSet;

use serde::Serialize;

use super::model::{Branch, Commit, Remote, Repository, Worktree};

/// Everything but the three lists. It is a handful of strings, so it travels
/// whole as soon as any of it changed.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositorySummary {
    pub name: String,
    pub path: String,
    pub git_dir: String,
    pub bare: bool,
    pub head: Option<String>,
    pub head_detached: bool,
    pub default_branch: Option<String>,
    pub remotes: Vec<Remote>,
    pub history_truncated: bool,
}

fn summary(repository: &Repository) -> RepositorySummary {
    RepositorySummary {
        name: repository.name.clone(),
        path: repository.path.clone(),
        git_dir: repository.git_dir.clone(),
        bare: repository.bare,
        head: repository.head.clone(),
        head_detached: repository.head_detached,
        default_branch: repository.default_branch.clone(),
        remotes: repository.remotes.clone(),
        history_truncated: repository.history_truncated,
    }
}

/// History as a diff: the bodies the UI has not seen, plus the resulting
/// order.
///
/// The order is what the layout is built from and it has to be exact, but a
/// list of shas is two orders of magnitude smaller than the commits
/// themselves — so it is sent whole and only the new bodies come with it.
/// Commits that dropped out of history (a reset, a rebase) need no mention:
/// they are simply absent from the order.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitDelta {
    pub added: Vec<Commit>,
    pub order: Vec<String>,
}

/// The changed parts of one repository. Everything is optional; a field that
/// is absent did not move.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryDelta {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary: Option<RepositorySummary>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub branches: Option<Vec<Branch>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub worktrees: Option<Vec<Worktree>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub commits: Option<CommitDelta>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceDelta {
    pub root: String,
    /// Repositories that were not in the previous snapshot, in full.
    pub added: Vec<Repository>,
    pub changed: Vec<RepositoryDelta>,
    /// Ids of repositories that are gone.
    pub removed: Vec<String>,
    /// Every repository id in display order, sent when the set or the order
    /// changed so the UI can place a new repository without a rescan.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub order: Option<Vec<String>>,
    /// The whole warning list, when it changed.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub warnings: Option<Vec<String>>,
}

impl WorkspaceDelta {
    pub fn empty(root: String) -> Self {
        Self {
            root,
            added: Vec::new(),
            changed: Vec::new(),
            removed: Vec::new(),
            order: None,
            warnings: None,
        }
    }

    /// True when there is nothing for the UI to do, which is the common case:
    /// git touches its directory far more often than it changes the graph.
    pub fn is_empty(&self) -> bool {
        self.added.is_empty()
            && self.changed.is_empty()
            && self.removed.is_empty()
            && self.order.is_none()
            && self.warnings.is_none()
    }
}

/// Diffs one repository against its previous state, or `None` when it is
/// unchanged.
pub fn diff_repository(previous: &Repository, next: &Repository) -> Option<RepositoryDelta> {
    if previous == next {
        return None;
    }

    let next_summary = summary(next);
    let delta = RepositoryDelta {
        id: next.id.clone(),
        summary: (summary(previous) != next_summary).then_some(next_summary),
        branches: (previous.branches != next.branches).then(|| next.branches.clone()),
        worktrees: (previous.worktrees != next.worktrees).then(|| next.worktrees.clone()),
        commits: diff_commits(&previous.commits, &next.commits),
    };

    // Equal field by field even though the structs differed: nothing the UI
    // can act on, so it hears nothing.
    if delta.summary.is_none()
        && delta.branches.is_none()
        && delta.worktrees.is_none()
        && delta.commits.is_none()
    {
        return None;
    }

    Some(delta)
}

fn diff_commits(previous: &[Commit], next: &[Commit]) -> Option<CommitDelta> {
    if previous == next {
        return None;
    }

    let known: HashSet<&str> = previous.iter().map(|commit| commit.id.as_str()).collect();
    Some(CommitDelta {
        added: next
            .iter()
            .filter(|commit| !known.contains(commit.id.as_str()))
            .cloned()
            .collect(),
        order: next.iter().map(|commit| commit.id.clone()).collect(),
    })
}

/// Diffs two snapshots. Both lists are in display order.
pub fn diff_workspace(
    root: &str,
    previous: &[Repository],
    previous_warnings: &[String],
    next: &[Repository],
    next_warnings: &[String],
) -> WorkspaceDelta {
    let mut delta = WorkspaceDelta::empty(root.to_string());

    for repository in next {
        match previous.iter().find(|other| other.id == repository.id) {
            Some(before) => delta.changed.extend(diff_repository(before, repository)),
            None => delta.added.push(repository.clone()),
        }
    }

    for repository in previous {
        if !next.iter().any(|other| other.id == repository.id) {
            delta.removed.push(repository.id.clone());
        }
    }

    let order: Vec<&str> = next
        .iter()
        .map(|repository| repository.id.as_str())
        .collect();
    let previous_order: Vec<&str> = previous
        .iter()
        .map(|repository| repository.id.as_str())
        .collect();
    if order != previous_order {
        delta.order = Some(order.into_iter().map(str::to_string).collect());
    }

    if previous_warnings != next_warnings {
        delta.warnings = Some(next_warnings.to_vec());
    }

    delta
}
