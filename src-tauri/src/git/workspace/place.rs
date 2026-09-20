//! Where a branch's worktree goes, derived rather than chosen so that the same
//! branch always comes back to the same directory.

use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager};

use crate::host::Host;

/// A short, filesystem-safe rendering of a branch name.
pub(super) fn slug(branch: &str) -> String {
    let cleaned: String = branch
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.') {
                character
            } else {
                '-'
            }
        })
        .collect();
    let trimmed: String = cleaned.trim_matches('-').chars().take(48).collect();
    if trimmed.is_empty() {
        "workspace".to_string()
    } else {
        trimmed
    }
}

fn digest(value: &str) -> u64 {
    let mut hasher = DefaultHasher::new();
    value.hash(&mut hasher);
    hasher.finish()
}

/// The repository is hashed into the path because two repositories under one
/// root may share a name, and the branch is hashed in beside its slug because
/// two branch names can slug to the same thing.
pub(super) fn worktree_path(host: &Host, root: &Path, repo_path: &str, branch: &str) -> PathBuf {
    host.join(
        &owner_dir(host, root, repo_path),
        &format!("{}-{:08x}", slug(branch), digest(branch) as u32),
    )
}

/// The directory one repository's worktrees share.
fn owner_dir(host: &Host, root: &Path, repo_path: &str) -> PathBuf {
    host.join(root, &format!("{:016x}", digest(repo_path)))
}

/// Where a repository's spare worktree waits. Beside the branches' own, so that
/// handing it to one is a rename within a directory, and under a name no branch
/// can land on: theirs all end in a digest.
pub(super) fn prepare_spare_path(root: &Path, repo: &Path) -> Result<PathBuf, String> {
    let host = Host::of(repo);
    let owner = owner_dir(&host, root, &host.native(repo));
    host.create_dir_all(&owner)?;
    Ok(host.join(&owner, "spare"))
}

/// The worktree path, with its parent directory made. The repository is hashed
/// by the name the machine holding it uses, not by the spelling this window has
/// it under — so a checkout inside a distribution comes back to the same
/// worktree whether it was opened from the Windows side or from inside, and
/// one on a machine across the network likewise.
pub(super) fn prepare_worktree_path(
    root: &Path,
    repo: &Path,
    branch: &str,
) -> Result<PathBuf, String> {
    let host = Host::of(repo);
    let path = worktree_path(&host, root, &host.native(repo), branch);
    if let Some(parent) = host.parent(&path) {
        host.create_dir_all(&parent)?;
    }
    Ok(path)
}

/// Where every managed worktree lives: under the data directory of the machine
/// the repository is on, not of the one the window is running on.
///
/// A worktree of a Linux checkout put on the Windows side would be a checkout
/// git reads over a network filesystem, with the wrong file modes, of files no
/// Windows account owns — and it is the same repository, so the two would fight.
/// A worktree of a repository on another machine has nowhere to go here at all.
pub(super) fn worktrees_root(app: &AppHandle, repo: &Path) -> Result<PathBuf, String> {
    let host = Host::of(repo);
    match &host {
        Host::Local => Ok(app
            .path()
            .app_data_dir()
            .map_err(|error| error.to_string())?
            .join("worktrees")),
        // The machine the repository is on, under its own user's home.
        Host::Wsl(_) | Host::Ssh(_) => {
            let home = host.home().ok_or_else(|| "no-home".to_string())?;
            let home = host.native(&home);
            Ok(host.canonical(&format!(
                "{home}/.local/share/{}/worktrees",
                app.config().identifier
            )))
        }
    }
}
