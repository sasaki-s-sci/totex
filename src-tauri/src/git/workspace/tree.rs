//! Making a branch a place to work in, and taking it away again.

use std::path::Path;

use tauri::AppHandle;

use super::Workspace;
use super::place::{prepare_worktree_path, worktrees_root};
use super::probe::{DIRTY, branch_tip, is_clean, resolve_commit, validate_branch, worktree_for};
use crate::git::cmd;
use crate::git::session::{report_all, repository_dir};

/// Cuts `branch` at `oid` and gives it a worktree to work in.
#[tauri::command]
pub async fn create_workspace(
    app: AppHandle,
    repo_id: String,
    branch: String,
    oid: String,
) -> Result<Workspace, String> {
    off_thread!({
        let repo = repository_dir(&app, &repo_id)?;
        let branch = branch.trim().to_string();
        validate_branch(&repo, &branch)?;
        let oid = resolve_commit(&repo, &oid)?;

        let path = prepare_worktree_path(&worktrees_root(&app, &repo)?, &repo, &branch)?;
        // One call, so a failure leaves neither the branch nor the directory.
        cmd::run(
            &repo,
            &[
                "worktree",
                "add",
                "-b",
                &branch,
                &path.to_string_lossy(),
                &oid,
            ],
        )?;

        report_all(&app)?;
        Ok(Workspace {
            repo_id,
            branch,
            path: path.to_string_lossy().into_owned(),
        })
    })
}

/// Gives an existing branch its worktree, or hands back the one it has.
#[tauri::command]
pub async fn open_workspace(
    app: AppHandle,
    repo_id: String,
    branch: String,
) -> Result<Workspace, String> {
    off_thread!({
        let repo = repository_dir(&app, &repo_id)?;
        let branch = branch.trim().to_string();
        branch_tip(&repo, &branch)?;

        if let Some(existing) = worktree_for(&repo, &branch)? {
            return Ok(Workspace {
                repo_id,
                branch,
                path: existing,
            });
        }

        let path = prepare_worktree_path(&worktrees_root(&app, &repo)?, &repo, &branch)?;
        cmd::run(
            &repo,
            &[
                "worktree",
                "add",
                "--quiet",
                &path.to_string_lossy(),
                &branch,
            ],
        )?;

        report_all(&app)?;
        Ok(Workspace {
            repo_id,
            branch,
            path: path.to_string_lossy().into_owned(),
        })
    })
}

/// Takes a worktree away. Refuses while it holds work that is not committed,
/// unless told plainly to discard it.
#[tauri::command]
pub async fn remove_workspace(
    app: AppHandle,
    repo_id: String,
    path: String,
    force: bool,
) -> Result<(), String> {
    off_thread!({
        let repo = repository_dir(&app, &repo_id)?;
        let target = Path::new(&path);
        if !force && !is_clean(target)? {
            return Err(DIRTY.to_string());
        }
        cmd::run(&repo, &["worktree", "remove", "--force", &path])?;
        report_all(&app)
    })
}

/// Deletes a local branch and everything standing on it.
///
/// The branch goes whether or not it was merged, and its linked worktree goes
/// with it along with whatever was left uncommitted in there. Git itself still
/// refuses the repository's main worktree, so a branch checked out there is left
/// wholly intact. The remote-tracking ref is not touched.
#[tauri::command]
pub async fn delete_branch(app: AppHandle, repo_id: String, branch: String) -> Result<(), String> {
    off_thread!({
        let repo = repository_dir(&app, &repo_id)?;
        delete_branch_at(&repo, &branch)?;
        report_all(&app)
    })
}

pub(super) fn delete_branch_at(repo: &Path, branch: &str) -> Result<(), String> {
    let branch = branch.trim();
    validate_branch(repo, branch)?;
    branch_tip(repo, branch)?;

    if let Some(path) = worktree_for(repo, branch)? {
        // `worktree remove` deliberately refuses the repository's main worktree.
        // In that case the branch remains checked out and untouched, and the
        // delete below is never reached.
        cmd::run(repo, &["worktree", "remove", "--force", &path])?;
    }

    // `--force`, because what this button says is that the branch goes: a branch
    // nothing has merged is the ordinary case for a line of work being thrown
    // away, and being told `not-merged` by a press already confirmed once is an
    // answer to a question nobody asked.
    cmd::run(repo, &["branch", "--delete", "--force", "--", branch]).map(|_| ())
}
