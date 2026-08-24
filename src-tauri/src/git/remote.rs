//! What this repository can ask a remote for.
//!
//! Nothing here touches a working tree. A fetch writes refs and objects and
//! stops there, which is what lets it run on a branch somebody is working in —
//! the graph redraws with the remote end further along, and the codebase under
//! the hand is exactly where it was left.

use std::path::Path;

use tauri::AppHandle;

use super::cmd;
use super::session::{report_all, repository_dir};
use super::workspace::validate_branch;

/// Brings one branch down from one remote.
///
/// One branch rather than the whole remote, because the gesture that asks for
/// this is on a branch and what it asks for should be what it says. A named
/// branch still updates its own remote-tracking ref along the way — git has
/// done that opportunistically since 1.8.4 — and that ref is what the graph
/// draws, so the one call answers both.
#[tauri::command]
pub async fn fetch_branch(
    app: AppHandle,
    repo_id: String,
    remote: String,
    branch: String,
) -> Result<(), String> {
    off_thread!({
        let repo = repository_dir(&app, &repo_id)?;
        fetch_at(&repo, &remote, &branch)?;
        report_all(&app)
    })
}

pub(super) fn fetch_at(repo: &Path, remote: &str, branch: &str) -> Result<(), String> {
    let remote = remote.trim();
    let branch = branch.trim();
    validate_remote(repo, remote)?;
    validate_branch(repo, branch)?;

    // Both names go on the command line in the position an option could take,
    // which is why neither reaches it unchecked.
    cmd::run(repo, &["fetch", "--quiet", remote, branch]).map(|_| ())
}

/// Proof that a remote is one this repository has.
///
/// Asked of git rather than judged by shape: a repository is the only authority
/// on which remotes it has, and a name that is not one of them is a name that
/// would be read as a URL — a fetch nobody asked for, to somewhere nobody named.
fn validate_remote(dir: &Path, remote: &str) -> Result<(), String> {
    let listed = cmd::run(dir, &["remote"])?;
    if listed.lines().any(|name| name.trim() == remote) {
        Ok(())
    } else {
        Err("no-such-remote".to_string())
    }
}
