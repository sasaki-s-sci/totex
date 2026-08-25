//! What has to be true before an operation runs, and the worktree it runs in.

use std::path::{Path, PathBuf};

use crate::git::cmd;
use crate::host::Host;

/// A worktree with work in it, which is what most operations refuse over. The
/// window asks the same question before offering the operation at all, so this
/// is the answer to a race rather than to a mistake.
pub(super) const DIRTY: &str = "dirty";

/// Every refusal here is a word the window matches on, never one it shows: what
/// is drawn instead is the mark that was pressed, in red.
pub(crate) fn validate_branch(dir: &Path, branch: &str) -> Result<(), String> {
    cmd::run(dir, &["check-ref-format", "--branch", branch])
        .map(|_| ())
        .map_err(|_| "bad-branch-name".to_string())
}

/// The commit a branch points at, and proof that the branch exists.
pub(super) fn branch_tip(dir: &Path, branch: &str) -> Result<String, String> {
    cmd::run(
        dir,
        &["rev-parse", "--verify", &format!("refs/heads/{branch}")],
    )
    .map(|out| out.trim().to_string())
    .map_err(|_| "no-such-branch".to_string())
}

pub(super) fn resolve_commit(dir: &Path, oid: &str) -> Result<String, String> {
    cmd::run(
        dir,
        &["rev-parse", "--verify", &format!("{oid}^{{commit}}")],
    )
    .map(|out| out.trim().to_string())
    .map_err(|_| "no-such-commit".to_string())
}

/// The worktree a branch is already checked out in, if any — spelled the way
/// the app spells paths rather than the way git printed it, because this goes
/// back to the window as a directory to open.
pub(super) fn worktree_for(dir: &Path, branch: &str) -> Result<Option<String>, String> {
    let listing = cmd::run(dir, &["worktree", "list", "--porcelain"])?;
    let wanted = format!("branch refs/heads/{branch}");
    let mut path: Option<&str> = None;
    for line in listing.lines() {
        if let Some(rest) = line.strip_prefix("worktree ") {
            path = Some(rest);
        } else if line.trim() == wanted {
            return Ok(path.map(|path| cmd::path_of(dir, path).to_string_lossy().into_owned()));
        }
    }
    Ok(None)
}

pub(super) fn is_clean(dir: &Path) -> Result<bool, String> {
    Ok(cmd::run(dir, &["status", "--porcelain"])?.trim().is_empty())
}

pub(super) fn ensure_clean(dir: &Path) -> Result<(), String> {
    if is_clean(dir)? {
        return Ok(());
    }
    Err(DIRTY.to_string())
}

/// Runs something that can leave a mess, and cleans it up when it does.
pub(super) fn run_or_abort(dir: &Path, args: &[&str], abort: &[&str]) -> Result<String, String> {
    cmd::run(dir, args).inspect_err(|_| {
        let _ = cmd::run(dir, abort);
    })
}

/// Runs `action` in a worktree that has `branch` checked out.
///
/// Reuses the branch's own worktree when it has one; otherwise a scratch
/// worktree is made for the duration and taken away again. The removal always
/// runs, but its own failure is only raised when the action succeeded —
/// otherwise a temp directory that would not go away would be reported in place
/// of the merge conflict that is the actual news.
pub(super) fn in_branch_worktree<T>(
    repo: &Path,
    branch: &str,
    label: &str,
    action: impl FnOnce(&Path) -> Result<T, String>,
) -> Result<T, String> {
    let mut scratch: Option<PathBuf> = None;
    let target = match worktree_for(repo, branch)? {
        Some(existing) => PathBuf::from(existing),
        None => {
            let path = scratch_path(repo, label);
            cmd::run(
                repo,
                &[
                    "worktree",
                    "add",
                    "--quiet",
                    &path.to_string_lossy(),
                    branch,
                ],
            )?;
            scratch = Some(path.clone());
            path
        }
    };

    let result = action(&target);

    if let Some(path) = scratch {
        let removed = cmd::run(
            repo,
            &["worktree", "remove", "--force", &path.to_string_lossy()],
        );
        if result.is_ok() {
            removed?;
        }
    }
    result
}

/// A directory nothing else is using, on the machine the repository is on.
fn scratch_path(repo: &Path, label: &str) -> PathBuf {
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|since| since.as_nanos())
        .unwrap_or_default();
    let host = Host::of(repo);
    host.join(&host.temp_dir(), &format!("totex-{label}-{stamp:x}"))
}
