//! The directories a repository is checked out in, and the branches standing
//! in them.

use std::collections::HashMap;
use std::path::Path;

use crate::host::Host;

use super::super::cmd;
use super::super::model::{Branch, Worktree};

pub(super) fn read_worktrees(dir: &Path, repo_id: &str, common_dir: &Path) -> Vec<Worktree> {
    let Some(output) = cmd::try_run(dir, &["worktree", "list", "--porcelain"]) else {
        return Vec::new();
    };
    let host = Host::of(dir);

    let mut worktrees: Vec<Worktree> = Vec::new();
    for block in output.split("\n\n") {
        let mut current: Option<Worktree> = None;
        for line in block.lines() {
            let (key, value) = match line.split_once(' ') {
                Some((key, value)) => (key, Some(value)),
                None => (line, None),
            };

            // `worktree` opens a block and every other key fills the one it
            // opened, so the block's own line is handled first and the rest
            // share one guard rather than each repeating it.
            if key == "worktree" {
                let path = cmd::path_of(dir, value.unwrap_or_default());
                let name = host.name(&path);
                // The main worktree is the one whose git directory is the
                // common directory itself.
                let is_main = host.is_dir(&host.join(&path, ".git")) || path == *common_dir;
                current = Some(Worktree {
                    id: format!("{repo_id}\u{1}worktree\u{1}{}", path.display()),
                    repo_id: repo_id.to_string(),
                    name,
                    exists: host.is_dir(&path),
                    path: path.to_string_lossy().into_owned(),
                    head: None,
                    short_head: None,
                    branch: None,
                    detached: false,
                    bare: false,
                    locked: false,
                    lock_reason: None,
                    prunable: false,
                    prunable_reason: None,
                    is_main,
                });
                continue;
            }

            // A key before any `worktree` line belongs to no block.
            let Some(worktree) = current.as_mut() else {
                continue;
            };

            match key {
                "HEAD" => {
                    let head = value.unwrap_or_default().to_string();
                    worktree.short_head = Some(head.chars().take(7).collect());
                    worktree.head = Some(head);
                }
                "branch" => worktree.branch = value.map(str::to_string),
                "detached" => worktree.detached = true,
                "bare" => worktree.bare = true,
                "locked" => {
                    worktree.locked = true;
                    worktree.lock_reason = value.map(str::to_string);
                }
                "prunable" => {
                    worktree.prunable = true;
                    worktree.prunable_reason = value.map(str::to_string);
                }
                _ => {}
            }
        }

        if let Some(worktree) = current {
            worktrees.push(worktree);
        }
    }

    // `git worktree list` always reports the main worktree first; trust that
    // over the heuristic above when nothing else matched.
    if !worktrees.iter().any(|worktree| worktree.is_main)
        && let Some(first) = worktrees.first_mut()
    {
        first.is_main = true;
    }

    worktrees
}

pub(super) fn link_worktrees(branches: &mut [Branch], worktrees: &[Worktree]) {
    let mut by_ref: HashMap<&str, Vec<String>> = HashMap::new();
    for worktree in worktrees.iter() {
        if let Some(branch) = worktree.branch.as_deref() {
            by_ref.entry(branch).or_default().push(worktree.id.clone());
        }
    }

    for branch in branches.iter_mut() {
        if let Some(ids) = by_ref.get(branch.ref_name.as_str()) {
            branch.checked_out_in = ids.clone();
        }
    }
}
