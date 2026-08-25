//! The history operations that need a working tree to run in.

use tauri::AppHandle;

use super::probe::{
    branch_tip, ensure_clean, in_branch_worktree, resolve_commit, run_or_abort, validate_branch,
};
use crate::git::cmd;
use crate::git::session::{report_all, repository_dir};

/// Merges `source` into `target`, in `target`'s own worktree.
#[tauri::command]
pub async fn merge_branch(
    app: AppHandle,
    repo_id: String,
    source: String,
    target: String,
) -> Result<String, String> {
    off_thread!({
        let repo = repository_dir(&app, &repo_id)?;
        let source = source.trim().to_string();
        let target = target.trim().to_string();
        validate_branch(&repo, &source)?;
        validate_branch(&repo, &target)?;
        if source == target {
            return Err("same-branch".to_string());
        }
        branch_tip(&repo, &source)?;
        branch_tip(&repo, &target)?;

        let output = in_branch_worktree(&repo, &target, "merge", |dir| {
            ensure_clean(dir)?;
            run_or_abort(dir, &["merge", "--no-edit", &source], &["merge", "--abort"])
        })?;

        report_all(&app)?;
        Ok(output.trim().to_string())
    })
}

/// Replays one commit onto a branch, in that branch's own worktree.
///
/// Revert and cherry-pick are the same protocol with a different verb: check the
/// branch and the commit are real, run it where the branch is checked out, and
/// abort rather than leave a half-applied state behind. `verb` is git's own
/// subcommand, which also names the scratch worktree.
fn replay(
    app: &AppHandle,
    repo_id: &str,
    branch: &str,
    oid: &str,
    verb: &str,
    flags: &[&str],
) -> Result<(), String> {
    let repo = repository_dir(app, repo_id)?;
    let branch = branch.trim().to_string();
    validate_branch(&repo, &branch)?;
    branch_tip(&repo, &branch)?;
    let oid = resolve_commit(&repo, oid)?;

    let mut args = vec![verb];
    args.extend_from_slice(flags);
    args.push(&oid);

    in_branch_worktree(&repo, &branch, verb, |dir| {
        ensure_clean(dir)?;
        run_or_abort(dir, &args, &[verb, "--abort"]).map(|_| ())
    })?;
    report_all(app)
}

/// Undoes `oid` on `branch` by committing its inverse.
#[tauri::command]
pub async fn revert_commit(
    app: AppHandle,
    repo_id: String,
    branch: String,
    oid: String,
) -> Result<(), String> {
    off_thread!(replay(
        &app,
        &repo_id,
        &branch,
        &oid,
        "revert",
        &["--no-edit"]
    ))
}

/// Copies `oid` onto `branch`.
#[tauri::command]
pub async fn cherry_pick_commit(
    app: AppHandle,
    repo_id: String,
    branch: String,
    oid: String,
) -> Result<(), String> {
    off_thread!(replay(&app, &repo_id, &branch, &oid, "cherry-pick", &[]))
}

/// Drops the newest commit on `branch`. Only ever the branch's own tip, checked
/// here rather than trusted from the window — a stale graph would otherwise
/// reset past commits nobody meant to lose.
#[tauri::command]
pub async fn undo_commit(
    app: AppHandle,
    repo_id: String,
    branch: String,
    oid: String,
) -> Result<(), String> {
    off_thread!({
        let repo = repository_dir(&app, &repo_id)?;
        let branch = branch.trim().to_string();
        validate_branch(&repo, &branch)?;
        let tip = branch_tip(&repo, &branch)?;
        let oid = resolve_commit(&repo, &oid)?;
        if tip != oid {
            return Err("behind".to_string());
        }
        let parent = resolve_commit(&repo, &format!("{oid}^")).map_err(|_| "root-commit")?;

        in_branch_worktree(&repo, &branch, "undo", |dir| {
            ensure_clean(dir)?;
            cmd::run(dir, &["reset", "--hard", &parent]).map(|_| ())
        })?;
        report_all(&app)
    })
}
