use serde::Serialize;

/// Everything the UI needs to draw the graph for one scanned folder.
///
/// The types are compared field by field to work out what a rescan actually
/// changed, so every one of them derives `PartialEq`.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Workspace {
    pub root: String,
    pub repositories: Vec<Repository>,
    /// Non-fatal problems (unreadable directories, repositories that failed to
    /// inspect) so the UI can surface them instead of silently dropping data.
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Repository {
    /// The common git directory, which is shared by every linked worktree and
    /// therefore identifies the repository no matter which path we found first.
    pub id: String,
    pub name: String,
    pub path: String,
    pub git_dir: String,
    pub bare: bool,
    pub head: Option<String>,
    pub head_detached: bool,
    pub default_branch: Option<String>,
    pub remotes: Vec<Remote>,
    pub branches: Vec<Branch>,
    pub worktrees: Vec<Worktree>,
    /// History reachable from every branch, newest first, in topological order.
    pub commits: Vec<Commit>,
    /// True when the history hit the per-repository limit, so the oldest
    /// commits are missing rather than absent.
    pub history_truncated: bool,
    /// The branch names this repository asks the graph to leave out, as its
    /// `.totex/.graphignore` writes them. Empty where it asks for nothing.
    pub graph_ignore: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Commit {
    pub id: String,
    pub short_id: String,
    pub parents: Vec<String>,
    pub subject: String,
    pub author: String,
    pub committed_at: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Remote {
    pub name: String,
    pub url: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum BranchKind {
    Local,
    Remote,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Branch {
    pub id: String,
    pub repo_id: String,
    pub ref_name: String,
    /// Display name: `main` for locals, `origin/main` for remotes.
    pub name: String,
    /// Name with the remote prefix stripped, used to pair a local branch with
    /// its remote counterpart.
    pub logical_name: String,
    pub kind: BranchKind,
    pub remote: Option<String>,
    pub commit: String,
    pub short_commit: String,
    pub subject: String,
    pub author: String,
    pub committed_at: Option<String>,
    /// HEAD of the worktree we inspected the repository from.
    pub is_head: bool,
    pub upstream: Option<String>,
    pub ahead: u32,
    pub behind: u32,
    /// The upstream ref is configured but no longer exists.
    pub gone: bool,
    /// Ids of the worktrees that have this branch checked out.
    pub checked_out_in: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Worktree {
    pub id: String,
    pub repo_id: String,
    pub name: String,
    pub path: String,
    pub head: Option<String>,
    pub short_head: Option<String>,
    pub branch: Option<String>,
    pub detached: bool,
    pub bare: bool,
    pub locked: bool,
    pub lock_reason: Option<String>,
    pub prunable: bool,
    pub prunable_reason: Option<String>,
    /// The worktree that owns the common git directory.
    pub is_main: bool,
    pub exists: bool,
}
