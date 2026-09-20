//! One worktree made ahead of time, so that cutting a branch does not wait on a
//! checkout.
//!
//! What is slow about a new branch is writing every file of the repository into
//! a new directory. A spare is that directory written before anybody asked: a
//! detached worktree beside the branches' own, which a new branch takes over by
//! switching to its commit — only the files that differ are written — and being
//! renamed to the path the branch would have been given anyway. The rule that a
//! branch's worktree is where its name says it is holds either way.
//!
//! The spare is told apart by the reason it is locked for, not by where it is:
//! the lock is what git itself reports in every listing, on whichever machine
//! the repository is, and it keeps `worktree prune` and a stray `worktree
//! remove` off it as well. Nothing drawn ever sees one — see [`is_a_place`].

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use tauri::AppHandle;

use super::place::{prepare_spare_path, worktrees_root};
use super::probe::{branch_tip, is_clean};
use crate::git::cmd;
use crate::git::session::repository_dir;

/// The reason a spare is locked for, which is how it is known.
const SPARE: &str = "totex-spare";

/// The reason git locks a worktree for while `worktree add` is still checking
/// it out. Read as written because every git here runs under `LC_ALL=C`.
const INITIALIZING: &str = "initializing";

/// The repositories whose spare is being made or removed right now. A spare is
/// listed from the moment its checkout starts, so without this a branch could be
/// handed one that is half written.
static BUSY: Mutex<Vec<PathBuf>> = Mutex::new(Vec::new());

/// One repository's turn at its spare, given back when dropped.
struct Turn(PathBuf);

impl Turn {
    /// `None` while somebody else has it.
    fn take(repo: &Path) -> Option<Self> {
        let mut busy = BUSY.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        if busy.iter().any(|held| held == repo) {
            return None;
        }
        busy.push(repo.to_path_buf());
        Some(Self(repo.to_path_buf()))
    }
}

impl Drop for Turn {
    fn drop(&mut self) {
        let mut busy = BUSY.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        busy.retain(|held| *held != self.0);
    }
}

/// Whether a listed worktree is somewhere to work, going by what it is locked
/// for.
///
/// A spare is nobody's until a branch takes it. One still being checked out is
/// not there yet: its files arrive before its index does, so anything that
/// counted it now would find every file either missing or unheard of. Both are
/// left out of what the window is told, and the write that ends either state is
/// inside the watched git directory, so the worktree arrives whole and once.
pub(crate) fn is_a_place(lock_reason: Option<&str>) -> bool {
    !matches!(lock_reason, Some(SPARE | INITIALIZING))
}

/// The repository's spare, if it has one.
pub(super) fn spare_of(repo: &Path) -> Result<Option<PathBuf>, String> {
    let listing = cmd::run(repo, &["worktree", "list", "--porcelain"])?;
    let wanted = format!("locked {SPARE}");
    for block in listing.split("\n\n") {
        if !block.lines().any(|line| line == wanted) {
            continue;
        }
        let path = block
            .lines()
            .find_map(|line| line.strip_prefix("worktree "));
        if let Some(path) = path {
            return Ok(Some(cmd::path_of(repo, path)));
        }
    }
    Ok(None)
}

/// Checks a spare out at `at`, unless the repository already has one.
pub(super) fn make_spare(root: &Path, repo: &Path, at: &str) -> Result<(), String> {
    // Somebody else at it is somebody else seeing to it.
    let Some(_turn) = Turn::take(repo) else {
        return Ok(());
    };
    if spare_of(repo)?.is_some() {
        return Ok(());
    }
    let path = prepare_spare_path(root, repo)?;
    // Locked by the same call that makes it, so there is no moment at which it
    // is listed as an ordinary worktree.
    cmd::run(
        repo,
        &[
            "worktree",
            "add",
            "--quiet",
            "--detach",
            "--lock",
            "--reason",
            SPARE,
            &path.to_string_lossy(),
            at,
        ],
    )
    .map(|_| ())
}

/// Takes the repository's spare away, whatever is in it.
pub(super) fn drop_spare(repo: &Path) -> Result<(), String> {
    let Some(_turn) = Turn::take(repo) else {
        return Err("spare-busy".to_string());
    };
    let Some(spare) = spare_of(repo)? else {
        return Ok(());
    };
    discard(repo, &spare)
}

// Twice, because once is not enough for a locked worktree.
fn discard(repo: &Path, spare: &Path) -> Result<(), String> {
    cmd::run(
        repo,
        &[
            "worktree",
            "remove",
            "--force",
            "--force",
            &spare.to_string_lossy(),
        ],
    )
    .map(|_| ())
}

/// Cuts `branch` at `oid` in the repository's spare and moves it to `path`.
///
/// `false` is a spare that could not be used, with nothing of the branch left
/// behind — the caller makes the worktree the long way, and whatever was wrong
/// with the request is that call's to report. The spare stays locked until it
/// is standing at `path` on its branch, so the window never draws the steps in
/// between.
pub(super) fn take_spare(repo: &Path, branch: &str, oid: &str, path: &Path) -> bool {
    // One being made right now is not one to wait for: the long way is no
    // slower than the rest of that checkout.
    let Some(_turn) = Turn::take(repo) else {
        return false;
    };
    let Ok(Some(spare)) = spare_of(repo) else {
        return false;
    };
    // A name already taken is refused by the long way, in its own words.
    if branch_tip(repo, branch).is_ok() {
        return false;
    }
    // A checkout that was cut short, or that somebody has been in. Switching
    // would carry what is in it onto the new branch.
    if !matches!(is_clean(&spare), Ok(true)) {
        let _ = discard(repo, &spare);
        return false;
    }
    if cmd::run(&spare, &["checkout", "--quiet", "-b", branch, oid]).is_err() {
        let _ = discard(repo, &spare);
        return false;
    }

    let moved = cmd::run(
        repo,
        &[
            "worktree",
            "move",
            "--force",
            "--force",
            &spare.to_string_lossy(),
            &path.to_string_lossy(),
        ],
    );
    if moved.is_err() {
        // The branch is checked out where no branch belongs. Both go, and the
        // long way starts from a repository that has neither.
        let _ = discard(repo, &spare);
        let _ = cmd::run(repo, &["branch", "--delete", "--force", "--", branch]);
        return false;
    }

    // A worktree left locked is only one that cannot be removed without saying
    // so twice; the branch is standing where it should either way.
    let _ = cmd::run(repo, &["worktree", "unlock", &path.to_string_lossy()]);
    true
}

/// Makes the next spare without anybody waiting on it.
pub(super) fn replenish(app: &AppHandle, repo: PathBuf, at: String) {
    let app = app.clone();
    std::thread::spawn(move || {
        if let Ok(root) = worktrees_root(&app, &repo) {
            let _ = make_spare(&root, &repo, &at);
        }
    });
}

/// Sees to it that each repository has a spare, or that none of them does.
///
/// Best effort throughout: a spare that could not be made is a branch cut the
/// long way, and one that could not be removed is a directory nothing draws.
#[tauri::command]
pub async fn tend_spares(
    app: AppHandle,
    repo_ids: Vec<String>,
    wanted: bool,
) -> Result<(), String> {
    off_thread!({
        // One after another: each is a whole checkout, and several at once only
        // take turns at the disk.
        for repo_id in repo_ids {
            let Ok(repo) = repository_dir(&app, &repo_id) else {
                continue;
            };
            if !wanted {
                let _ = drop_spare(&repo);
                continue;
            }
            if let Ok(root) = worktrees_root(&app, &repo) {
                let _ = make_spare(&root, &repo, "HEAD");
            }
        }
        Ok(())
    })
}
