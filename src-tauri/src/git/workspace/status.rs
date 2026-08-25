//! What is uncommitted in a worktree, counted in files.

use std::collections::HashMap;
use std::path::Path;

use super::WorktreeStatus;
use crate::git::{changes, cmd, parallel_map};

/// What is uncommitted in every worktree the window is drawing, in one crossing.
///
/// One call rather than one per directory: the window asks about all of them on
/// a clock, so asking one at a time paid for a round trip per worktree. A
/// directory git will not answer for is left out rather than failing the call,
/// and the window keeps whatever that one last said.
#[tauri::command]
pub async fn workspace_statuses(
    paths: Vec<String>,
) -> Result<HashMap<String, WorktreeStatus>, String> {
    off_thread!({
        let answers = parallel_map(paths, |path| {
            let status = read_status(Path::new(&path))?;
            Some((path, status))
        });
        Ok(answers.into_iter().flatten().collect())
    })
}

/// Reads what is uncommitted in a worktree, as a count of files of each kind.
///
/// Two commands rather than `git status`: `diff HEAD --name-status` is
/// everything git has been told about, staged or not — the two are the same fact
/// to anyone looking at the folder — and it says what became of each file. What
/// that diff cannot see, files not in the index at all, is listed below.
///
/// Nothing here reads a file, so a directory just unpacked is counted as fast as
/// git can list it. `None` is a directory git would not answer for.
pub(crate) fn read_status(dir: &Path) -> Option<WorktreeStatus> {
    let untracked = cmd::try_run(dir, &["ls-files", "--others", "--exclude-standard", "-z"])?;

    let mut status = WorktreeStatus::default();
    if let Some(listing) = cmd::try_run(dir, &["diff", "HEAD", "--name-status", "-z"]) {
        count_name_status(&listing, &mut status);
    }
    status.added += count_untracked(&untracked);
    Some(status)
}

/// Counts `git diff --name-status -z`, whatever the record says about how a file
/// got that way. The walk itself belongs to [`crate::git::changes`], which reads
/// the same output for the folder column; the difference is only what a record
/// is taken to mean. A rename is one file that changed here, because nothing
/// arrived and nothing was lost as far as the branch is concerned.
pub(super) fn count_name_status(listing: &str, status: &mut WorktreeStatus) {
    changes::walk_name_status(listing, |letter, _, _| match letter {
        // A copy is a file the worktree has and the commit does not.
        'A' | 'C' => status.added += 1,
        'D' => status.deleted += 1,
        // Everything else is a file both have and differ over.
        _ => status.modified += 1,
    });
}

/// How many files git has not been told about. Listed by `ls-files` rather than
/// taken from `git status`, which collapses a whole new directory into a single
/// entry and quotes anything unusual in a path.
fn count_untracked(listing: &str) -> u32 {
    let files = listing.split('\0').filter(|path| !path.is_empty()).count();
    u32::try_from(files).unwrap_or(u32::MAX)
}
