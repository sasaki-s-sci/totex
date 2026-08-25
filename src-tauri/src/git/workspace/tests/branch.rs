//! Finding a branch's worktree, and taking the branch away with it.

use std::path::Path;

use super::super::probe::worktree_for;
use super::super::tree::delete_branch_at;
use super::{repository, side_worktree};
use crate::git::cmd;
use crate::git::tests::{TempDir, commit, git};

/// Whether the branch is still there at all.
fn still_there(repo: &Path, r#ref: &str) -> bool {
    cmd::try_run(repo, &["rev-parse", "--verify", r#ref]).is_some()
}

#[test]
fn a_worktree_is_found_by_the_branch_it_holds() {
    let temp = TempDir::new("find");
    let repo = repository(&temp, &["one.txt"]);

    assert_eq!(worktree_for(&repo, "topic").expect("look"), None);
    let side = side_worktree(&temp, &repo, "topic");

    let found = worktree_for(&repo, "topic").expect("look").expect("a path");
    assert_eq!(
        Path::new(&found).canonicalize().ok(),
        side.canonicalize().ok()
    );
    assert!(worktree_for(&repo, "main").expect("look").is_some());
    assert_eq!(worktree_for(&repo, "nothing").expect("look"), None);
}

#[test]
fn deleting_a_local_branch_leaves_its_remote_tracking_ref() {
    let temp = TempDir::new("delete-branch");
    let repo = repository(&temp, &["one.txt"]);
    git(&repo, &["checkout", "--quiet", "-b", "topic"]);
    commit(&repo, "two.txt", "two");
    git(
        &repo,
        &[
            "remote",
            "add",
            "origin",
            "https://example.invalid/repo.git",
        ],
    );
    git(&repo, &["update-ref", "refs/remotes/origin/topic", "topic"]);
    git(
        &repo,
        &["branch", "--set-upstream-to=origin/topic", "topic"],
    );
    git(&repo, &["checkout", "--quiet", "main"]);

    delete_branch_at(&repo, "topic").expect("delete local branch");

    assert!(!still_there(&repo, "refs/heads/topic"));
    assert!(
        still_there(&repo, "refs/remotes/origin/topic"),
        "the remote-tracking ref was deleted with the local branch"
    );
}

#[test]
fn deleting_a_branch_removes_its_clean_linked_worktree() {
    let temp = TempDir::new("delete-worktree-branch");
    let repo = repository(&temp, &["one.txt"]);
    let side = side_worktree(&temp, &repo, "topic");

    delete_branch_at(&repo, "topic").expect("delete branch and worktree");

    assert!(!side.exists(), "the branch's linked worktree was left");
    assert!(!still_there(&repo, "refs/heads/topic"));
}

#[test]
fn deleting_a_branch_takes_a_dirty_linked_worktree_with_it() {
    let temp = TempDir::new("delete-dirty-branch");
    let repo = repository(&temp, &["one.txt"]);
    let side = side_worktree(&temp, &repo, "topic");
    std::fs::write(side.join("uncommitted.txt"), "throw me away").expect("write dirty file");

    delete_branch_at(&repo, "topic").expect("delete branch and dirty worktree");

    assert!(!side.exists(), "the dirty worktree was left behind");
    assert!(!still_there(&repo, "refs/heads/topic"));
}

#[test]
fn deleting_an_unmerged_branch_takes_it_all_the_same() {
    let temp = TempDir::new("delete-unmerged-branch");
    let repo = repository(&temp, &["one.txt"]);
    let side = side_worktree(&temp, &repo, "topic");
    commit(&side, "two.txt", "two");

    delete_branch_at(&repo, "topic").expect("delete an unmerged branch");

    assert!(!side.exists(), "the unmerged branch's worktree was left");
    assert!(!still_there(&repo, "refs/heads/topic"));
}
