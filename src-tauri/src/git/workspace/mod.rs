//! Branches as places to work in.
//!
//! A branch you can only look at is a name; a branch you can work in is a
//! directory. Everything here turns the one into the other and back: it hands a
//! branch its own worktree, tells you what is dirty in it, and runs the history
//! operations that need a working tree to run in.
//!
//! Two rules hold throughout. **One worktree per branch** — checking a branch
//! out twice leaves an index stale as soon as the shared ref moves, so every
//! entry point either reuses the branch's existing worktree or makes its single
//! canonical one. And **nothing is chosen for you and left behind** — a
//! worktree's path is derived from the repository and the branch, so the same
//! branch always lands in the same place.

pub mod follow;
pub mod history;
mod place;
mod probe;
pub mod status;
pub mod tree;

#[cfg(test)]
mod tests;

use serde::Serialize;

pub(super) use probe::validate_branch;

/// A branch and the directory it is checked out in.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Workspace {
    pub repo_id: String,
    pub branch: String,
    pub path: String,
}

/// What is uncommitted in a worktree, counted in files by what became of them.
///
/// Files rather than lines: what a branch has done to the codebase since its
/// commit is which files arrived, which left and which were rewritten, and the
/// graph draws those three as the shares of the branch's rim.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeStatus {
    /// Files the worktree has that its commit does not — the ones git has been
    /// told about and the ones it has not heard of, alike.
    pub added: u32,
    /// Files its commit has that the worktree does not.
    pub deleted: u32,
    /// Files both have, with something different in them.
    pub modified: u32,
}
