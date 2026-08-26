//! Bringing a branch up to the remote end it follows.
//!
//! Two ways in, and they are deliberately not the same operation. A branch
//! dropped onto its remote end by hand is somebody asking for what is out
//! there, so it is a merge: what fast-forwards fast-forwards, what has to be
//! joined is joined, and what git will not do comes back in git's own words.
//! The automatic round is nobody asking for anything, so it takes only the
//! branches that were purely behind and leaves every other one exactly where it
//! was — a window that made merge commits while it was not being looked at
//! would be a window nobody could leave open.

use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::AppHandle;

use super::probe::{
    branch_tip, in_branch_worktree, is_clean, run_or_abort, validate_branch, worktrees_by_branch,
};
use crate::git::cmd;
use crate::git::remote::fetch_at;
use crate::git::session::{report_all, repository_dir};

/// What came of taking one branch up to the remote end it follows.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Followed {
    /// Git's own words for what it would not do, or `None` where it did it.
    ///
    /// The one refusal in this app that is shown rather than matched on.
    /// Everything else a branch can be refused is refused for a reason the
    /// window already knew — see `probe` — and the ring going red says all
    /// there is to say. Two ends that will not come together is not one of
    /// those: only git has read both of them, and only git can name the files
    /// standing in the way.
    pub refused: Option<String>,
}

/// Brings one branch up to the remote end it follows.
///
/// The remote is asked first and every time. What a branch is behind is
/// whatever is out there now, not whatever this machine last heard, and a drop
/// that merged a week-old remote-tracking ref would be a gesture that quietly
/// meant something else.
///
/// `remote_branch` is the name that remote knows the branch by — `main`, not
/// `origin/main` — because the remote is named beside it.
#[tauri::command]
pub async fn follow_branch(
    app: AppHandle,
    repo_id: String,
    branch: String,
    remote: String,
    remote_branch: String,
) -> Result<Followed, String> {
    off_thread!({
        let repo = repository_dir(&app, &repo_id)?;
        let branch = branch.trim().to_string();
        validate_branch(&repo, &branch)?;
        let tip = branch_tip(&repo, &branch)?;

        fetch_at(&repo, &remote, &remote_branch)?;

        // Named in full rather than as `origin/main`: a remote-tracking ref and
        // a local branch can be spelled the same way, and this one has just
        // been fetched precisely because the two ends differ. The same two
        // names the fetch was made with, so what is merged is what was asked
        // for — both were checked on the way through `fetch_at`.
        let source = format!("refs/remotes/{}/{}", remote.trim(), remote_branch.trim());
        let end = cmd::run(&repo, &["rev-parse", "--verify", &source])
            .map(|out| out.trim().to_string())
            .map_err(|_| "no-such-remote-branch".to_string())?;

        // Answered here rather than by git, because the asking is what costs: a
        // branch with no worktree is given a whole scratch checkout to run a
        // merge in, and this is the case where that merge would print one line
        // and change nothing.
        if end == tip || contains(&repo, &tip, &end) {
            return Ok(Followed { refused: None });
        }

        let refused = in_branch_worktree(&repo, &branch, "follow", |dir| {
            Ok(run_or_abort(dir, &["merge", "--no-edit", &source], &["merge", "--abort"]).err())
        })?;

        report_all(&app)?;
        Ok(Followed { refused })
    })
}

/// What a branch that moved on its own says in its reflog.
const NOTE: &str = "totex: followed the remote";

/// Asks every remote of one repository, and takes the branches that were only
/// behind up to what came back.
///
/// The whole of what the automatic setting does. Fast-forward and nothing else:
/// a branch that has commits of its own is two ends that have parted, and
/// joining them is a decision somebody makes rather than something a timer does.
/// A branch that is checked out is somebody's directory as well as a ref, so it
/// is only moved when nothing is uncommitted in it.
///
/// Nothing here is reported. The round is nobody's press — there is no mark
/// waiting on it and no gesture to answer — so a remote that would not answer,
/// or a branch that would not move, is simply a branch that is where it was.
#[tauri::command]
pub async fn follow_repository(app: AppHandle, repo_id: String) -> Result<(), String> {
    off_thread!({
        let repo = repository_dir(&app, &repo_id)?;

        // One crossing for every remote rather than one for every branch: a
        // round that asked branch by branch would open a connection per branch,
        // on a timer, for a window nobody is necessarily looking at.
        let before = remote_refs(&repo);
        let _ = cmd::run(&repo, &["fetch", "--quiet", "--all"]);
        let mut moved = remote_refs(&repo) != before;

        let checkouts = worktrees_by_branch(&repo).unwrap_or_default();
        for behind in behind_branches(&repo)? {
            if forward(&repo, &behind, checkouts.get(&behind.branch)) {
                moved = true;
            }
        }

        // A rescan is the expensive half of this, and a round that found the
        // world exactly as it left it has nothing to redraw.
        if moved {
            report_all(&app)?;
        }
        Ok(())
    })
}

/// Where every remote-tracking ref stands, as one string to be compared with
/// itself afterwards.
///
/// What the fetch actually did, without asking git to say what it did: the
/// porcelain that would report it is newer than the gits this has to run on,
/// and the refs are the thing the graph draws anyway.
fn remote_refs(repo: &Path) -> String {
    cmd::try_run(
        repo,
        &[
            "for-each-ref",
            "--format=%(objectname) %(refname)",
            "refs/remotes",
        ],
    )
    .unwrap_or_default()
}

/// A branch whose remote end has commits it has not, and none of its own.
pub(super) struct Behind {
    pub(super) branch: String,
    /// Where it stands now, which the move is made conditional on.
    pub(super) tip: String,
    /// The remote-tracking ref it follows, by its full name.
    pub(super) upstream: String,
}

/// Every branch of this repository that is purely behind what it follows.
///
/// `%(upstream:track)` is git's own reading of a pair, and it is asked for every
/// branch in one call. `[behind n]` on its own is the whole of what can be
/// taken: `[ahead n, behind m]` is two ends that have parted, `[ahead n]` is a
/// branch with nothing to catch up to, and `[gone]` is one whose other end was
/// deleted. The wording is stable because every git this app runs is run under
/// `LC_ALL=C` — see `cmd`.
pub(super) fn behind_branches(repo: &Path) -> Result<Vec<Behind>, String> {
    let listed = cmd::run(
        repo,
        &[
            "for-each-ref",
            "--format=%(refname:short)%09%(objectname)%09%(upstream)%09%(upstream:track)",
            "refs/heads",
        ],
    )?;

    Ok(listed
        .lines()
        .filter_map(|line| {
            let mut fields = line.split('\t');
            let branch = fields.next()?;
            let tip = fields.next()?;
            let upstream = fields.next()?;
            let track = fields.next().unwrap_or("");
            if upstream.is_empty() || !track.starts_with("[behind ") {
                return None;
            }
            Some(Behind {
                branch: branch.to_string(),
                tip: tip.to_string(),
                upstream: upstream.to_string(),
            })
        })
        .collect())
}

/// Takes one branch to its remote end, where nothing is in the way. Whether it
/// went is the answer; why it did not is nobody's news.
///
/// A branch nobody is standing in is a ref and moves as one — no checkout and
/// no index, with the commit it was read at named so that a branch which moved
/// in between is left alone. A branch that is checked out has files under it
/// that git is about to rewrite, so it is only touched when nothing is
/// uncommitted there.
pub(super) fn forward(repo: &Path, behind: &Behind, checkout: Option<&PathBuf>) -> bool {
    match checkout {
        Some(dir) => {
            is_clean(dir).unwrap_or(false)
                && cmd::run(dir, &["merge", "--ff-only", "--quiet", &behind.upstream]).is_ok()
        }
        None => cmd::run(
            repo,
            &[
                "update-ref",
                "-m",
                NOTE,
                &format!("refs/heads/{}", behind.branch),
                &behind.upstream,
                &behind.tip,
            ],
        )
        .is_ok(),
    }
}

/// Whether `holder` already has `commit` behind it.
///
/// A failure reads as "no", which is the safe way round: the answer is only
/// used to skip asking git for a merge, and a merge nobody needed says so in
/// one line.
fn contains(repo: &Path, holder: &str, commit: &str) -> bool {
    cmd::run(repo, &["merge-base", "--is-ancestor", commit, holder]).is_ok()
}
