//! The history reachable from every branch.

use std::path::Path;

use super::super::cmd;
use super::super::model::{Commit, Worktree};
use super::COMMIT_FORMAT;

/// Reads the history reachable from every branch, newest first.
///
/// Worktree heads are passed explicitly so a detached worktree still lands in
/// the graph instead of pointing at a commit nobody drew.
pub(super) fn read_commits(
    dir: &Path,
    limit: usize,
    worktrees: &[Worktree],
) -> (Vec<Commit>, bool) {
    let mut args: Vec<String> = vec![
        "log".into(),
        "--topo-order".into(),
        "--max-count".into(),
        limit.to_string(),
        format!("--format={COMMIT_FORMAT}"),
        "--branches".into(),
        "--remotes".into(),
    ];
    for worktree in worktrees {
        if let Some(head) = worktree.head.as_deref() {
            args.push(head.to_string());
        }
    }
    // Everything before this point is a revision, never a path.
    args.push("--".into());

    let borrowed: Vec<&str> = args.iter().map(String::as_str).collect();
    // A repository without commits yet makes `git log` fail; that is not an error.
    let Some(output) = cmd::try_run(dir, &borrowed) else {
        return (Vec::new(), false);
    };

    let mut commits = Vec::new();
    for line in output.lines() {
        if line.is_empty() {
            continue;
        }
        let fields: Vec<&str> = line.split('\0').collect();
        if fields.len() < 5 {
            continue;
        }
        let id = fields[0].to_string();
        commits.push(Commit {
            short_id: id.chars().take(7).collect(),
            id,
            parents: fields[1]
                .split_whitespace()
                .map(str::to_string)
                .collect::<Vec<_>>(),
            committed_at: fields[2].to_string(),
            author: fields[3].to_string(),
            subject: fields[4].to_string(),
        });
    }

    let truncated = commits.len() >= limit;
    (commits, truncated)
}
