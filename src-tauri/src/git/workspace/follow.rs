//! Keeping every branch up with the remote end it follows, over a whole
//! repository at once.
//!
//! Every branch at once, which is the whole of what shapes it. The gesture that
//! brings one branch level with its remote is `sync_branch`, over in `history`:
//! somebody asking for what is out there, on the branch they asked it on, and
//! there to be told how far it got. This is the other reading -- the lot of
//! them, in a window that may not be being looked at. So it takes only the
//! branches that were purely behind and leaves every other one exactly where it
//! was: a window that made merge commits while nobody was watching would be a
//! window nobody could leave open.
//!
//! Two things ask for it, and the rule above is the same for both. A timer,
//! while the setting for it is on, which is a round nobody pressed for. And a
//! press on the settings page, which is one somebody is waiting on. The only
//! difference that makes is whether a remote that would not answer is said out
//! loud -- see `round`.

use std::path::{Path, PathBuf};

use tauri::AppHandle;

use super::probe::{is_clean, worktrees_by_branch};
use crate::git::cmd;
use crate::git::session::{report_all, repository_dir};

/// What a branch that moved on its own says in its reflog.
const NOTE: &str = "totex: followed the remote";

/// What one round found. Neither half is a failure: a round that reached
/// nothing still says so as an answer, because what it did before that is worth
/// having either way.
pub(super) struct Round {
    /// Whether anything actually moved. A rescan is the expensive half of a
    /// round, and one that found the world exactly as it left it has nothing to
    /// redraw.
    pub(super) moved: bool,
    /// Why a remote could not be reached, where one could not. Read by the
    /// caller somebody is waiting on and dropped by the one nobody is.
    pub(super) missed: Option<String>,
}

/// Asks every remote of one repository, and takes the branches that were only
/// behind up to what came back.
///
/// The whole of what both callers do, and the same rule for each. Fast-forward
/// and nothing else: a branch that has commits of its own is two ends that have
/// parted, and joining them is a decision somebody makes rather than something a
/// timer does. A branch that is checked out is somebody's directory as well as a
/// ref, so it is only moved when nothing is uncommitted in it.
///
/// A remote that would not answer is carried back rather than thrown, because it
/// does not stop the round: `--all` crosses to the others whatever one of them
/// did, and a remote that is down does not make the branches behind the ones
/// that are up any less behind. So what did answer is taken first, and who — if
/// anybody — is told about the one that did not is the caller's to decide.
pub(super) fn round(repo: &Path) -> Result<Round, String> {
    // One crossing for every remote rather than one for every branch: a round
    // that asked branch by branch would open a connection per branch, on a
    // timer, for a window nobody is necessarily looking at.
    let before = remote_refs(repo);
    let reached = cmd::run(repo, &["fetch", "--quiet", "--all"]);
    let mut moved = remote_refs(repo) != before;

    let checkouts = worktrees_by_branch(repo).unwrap_or_default();
    for behind in behind_branches(repo)? {
        if forward(repo, &behind, checkouts.get(&behind.branch)) {
            moved = true;
        }
    }
    Ok(Round {
        moved,
        missed: reached.err(),
    })
}

/// The round on a timer, while the window is told to follow.
///
/// Nobody's press, and nothing is reported because of it: there is no mark
/// waiting on this and no gesture to answer, so a remote that would not answer
/// is simply a branch that is where it was. Saying otherwise would be the window
/// complaining about a network nobody asked it to cross.
#[tauri::command]
pub async fn follow_repository(app: AppHandle, repo_id: String) -> Result<(), String> {
    off_thread!({
        let repo = repository_dir(&app, &repo_id)?;
        if round(&repo)?.moved {
            report_all(&app)?;
        }
        Ok(())
    })
}

/// The same round, asked for by hand.
///
/// The press behind the setting rather than a second kind of following: what it
/// does to the branches is exactly what the timer does, so there is nothing to
/// be had by pressing that leaving the window open would not have done on its
/// own. What is different is when — the news now, rather than in however much of
/// the round is left — and that somebody is there to be told.
///
/// Told last. A press is a question and a question that goes quiet has not been
/// answered, so a remote that could not be reached comes back as the reason it
/// could not; but the graph is redrawn before that is raised, because what did
/// answer has been taken and the graph is what says so.
///
/// Offered whether or not the window is following. The setting is about what
/// this window does unasked, and somebody who will not have it on their network
/// unasked still wants to ask.
#[tauri::command]
pub async fn fetch_repository(app: AppHandle, repo_id: String) -> Result<(), String> {
    off_thread!({
        let repo = repository_dir(&app, &repo_id)?;
        let done = round(&repo)?;
        if done.moved {
            report_all(&app)?;
        }
        match done.missed {
            Some(reason) => Err(reason),
            None => Ok(()),
        }
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
