//! The fixture every workspace test shares: a repository with a commit or two
//! in it, in a temp directory that cleans itself up.

mod borrow;
mod branch;
mod history;
mod place;
mod status;

use std::path::{Path, PathBuf};

// The sibling suite's fixture: one temp directory and one git isolated from the
// machine's own config. Two copies of that isolation is two places to correct.
use crate::git::tests::{TempDir, commit, git};

/// A repository on `main` with one commit per named file.
pub(super) fn repository(temp: &TempDir, files: &[&str]) -> PathBuf {
    let path = temp.path().join("repo");
    std::fs::create_dir_all(&path).expect("create repo dir");
    git(&path, &["init", "--quiet", "-b", "main"]);
    // Set in the repository rather than passed as environment, because the code
    // under test runs git itself and must not invent an identity to commit
    // under.
    git(&path, &["config", "user.name", "totex"]);
    git(&path, &["config", "user.email", "totex@example.invalid"]);
    for file in files {
        commit(&path, file, file);
    }
    path
}

pub(super) fn head_of(repo: &Path, branch: &str) -> String {
    git(repo, &["rev-parse", branch]).trim().to_string()
}

/// A worktree checked out beside the repository, on a branch of its own.
pub(super) fn side_worktree(temp: &TempDir, repo: &Path, branch: &str) -> PathBuf {
    let side = temp.path().join("side");
    git(
        repo,
        &["worktree", "add", "-b", branch, &side.to_string_lossy()],
    );
    side
}
