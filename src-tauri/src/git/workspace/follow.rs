//! Keeping every branch up with the remote end it follows, while the window is
//! left open.
//!
//! Nobody's press, which is the whole of what shapes it. The gesture that
//! brings one branch level with its remote is `sync_branch`, over in `history`:
//! somebody asking for what is out there, on the branch they asked it on, and
//! there to be told how far it got. This is a timer instead, over every branch
//! at once, in a window that may not be being looked at. So it takes only the
//! branches that were purely behind and leaves every other one exactly where it
//! was -- a window that made merge commits while nobody was watching would be a
//! window nobody could leave open.

use std::path::{Path, PathBuf};

use tauri::AppHandle;

use super::probe::{is_clean, worktrees_by_branch};
use crate::git::cmd;
use crate::git::session::{report_all, repository_dir};

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
