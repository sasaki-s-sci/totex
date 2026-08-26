//! The history operations that need a working tree to run in.

use std::path::Path;

use serde::Serialize;
use tauri::AppHandle;

use super::probe::{
    branch_tip, ensure_clean, in_branch_worktree, resolve_commit, run_or_abort, validate_branch,
};
use crate::git::cmd;
use crate::git::remote::fetch_at;
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

/// How far a branch was brought level with the remote end of itself.
///
/// Counted in commits rather than said in words: what actually happened is
/// already on the canvas — the branch has moved along its remote's line, and
/// the gap that is left is the gap that is drawn. This is only what the window
/// needs to tell the two kinds of nothing apart, since a branch that took
/// nothing because there was nothing to take is at rest, and one that took
/// nothing because the first commit would not go is a refusal.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Sync {
    /// Commits taken from the remote end onto the branch.
    pub taken: usize,
    /// Commits the remote still has that the branch now does not.
    pub left: usize,
    /// What is left was stopped by a conflict rather than never being there.
    pub blocked: bool,
}

/// Brings a branch level with its remote, as far as it can go on its own.
///
/// The fetch first, because the question is what the remote has now and not
/// what it had when this window last asked. Then as much of that as the branch
/// will take without anything to settle by hand: git is asked, commit by
/// commit along the remote's own line, whether the merge would conflict, and
/// the branch is merged up to the last one that would not.
///
/// Stopping short is the point rather than a failure. A conflict is a decision,
/// and a decision is something to sit down to in a codebase — so what is
/// waiting is left waiting, on the remote end where it already was, and
/// everything ahead of it that needed nobody is already in. The graph draws the
/// difference: the branch has moved and the two ends are still apart.
#[tauri::command]
pub async fn sync_branch(
    app: AppHandle,
    repo_id: String,
    remote: String,
    branch: String,
) -> Result<Sync, String> {
    off_thread!({
        let repo = repository_dir(&app, &repo_id)?;
        let brought = sync_at(&repo, remote.trim(), branch.trim())?;
        report_all(&app)?;
        Ok(brought)
    })
}

pub(super) fn sync_at(repo: &Path, remote: &str, branch: &str) -> Result<Sync, String> {
    // `fetch_at` checks the remote as well, and both names go on a command line
    // in a position an option could take, so neither reaches it unchecked.
    validate_branch(repo, branch)?;
    fetch_at(repo, remote, branch)?;

    let here = branch_tip(repo, branch)?;
    let there = resolve_commit(repo, &format!("refs/remotes/{remote}/{branch}"))?;

    // The remote's own line of development, oldest first. First parents only:
    // each of these stands for the whole of the remote history up to it, so
    // stopping at one leaves the branch holding a whole prefix of what is out
    // there rather than half of somebody's merge.
    let ahead: Vec<String> = cmd::run(
        repo,
        &[
            "rev-list",
            "--first-parent",
            "--reverse",
            &format!("{here}..{there}"),
        ],
    )?
    .split_whitespace()
    .map(str::to_string)
    .collect();
    if ahead.is_empty() {
        return Ok(Sync::default());
    }

    let taken = reach(repo, &here, &ahead)?;
    if taken == 0 {
        return Ok(Sync {
            taken: 0,
            left: ahead.len(),
            blocked: true,
        });
    }

    let upto = &ahead[taken - 1];
    let whole = taken == ahead.len();
    let message = if whole {
        format!("Merge {remote}/{branch}")
    } else {
        format!("Merge {remote}/{branch} as far as it goes")
    };
    in_branch_worktree(repo, branch, "sync", |dir| {
        ensure_clean(dir)?;
        run_or_abort(
            dir,
            &["merge", "--no-edit", "-m", &message, upto],
            &["merge", "--abort"],
        )
    })?;

    Ok(Sync {
        taken,
        left: ahead.len() - taken,
        blocked: !whole,
    })
}

/// How many of `ahead` the branch would take before one of them conflicts.
///
/// The whole of it is asked about first, which is the answer nearly every time
/// and one question rather than one per commit. Only a branch that would not
/// take all of it is walked, and then from the oldest end: the first commit
/// that would have to be settled by hand is where the sync stops, and nothing
/// behind it is taken on the grounds that it happens to merge on its own.
fn reach(repo: &Path, here: &str, ahead: &[String]) -> Result<usize, String> {
    if let Some(last) = ahead.last()
        && would_merge(repo, here, last)?
    {
        return Ok(ahead.len());
    }
    let mut taken = 0;
    for candidate in ahead {
        if !would_merge(repo, here, candidate)? {
            break;
        }
        taken += 1;
    }
    Ok(taken)
}

/// Whether the branch would take this commit with nothing left to settle.
///
/// Answered in the object database: `merge-tree` does the whole three-way merge
/// and writes the result as a tree, touching no working directory and no ref.
/// That is what lets the question be asked of every commit on the way without a
/// checkout for each one — and what lets it be asked at all of a branch
/// somebody is working in.
///
/// git says which of the three it is in its exit code: nothing to settle, a
/// conflict, or it could not do the merge at all. Only the last is an error,
/// and it goes back in git's own words.
fn would_merge(repo: &Path, here: &str, there: &str) -> Result<bool, String> {
    match cmd::code(repo, &["merge-tree", "--write-tree", here, there])? {
        (0, _) => Ok(true),
        (1, _) => Ok(false),
        (_, said) => Err(said),
    }
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
