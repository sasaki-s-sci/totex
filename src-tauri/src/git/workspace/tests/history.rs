//! Merging, reverting and undoing, run in the branch's own worktree.

use super::super::probe::{DIRTY, ensure_clean, in_branch_worktree, run_or_abort};
use super::super::probe::{branch_tip, resolve_commit, validate_branch};
use super::{head_of, repository};
use crate::git::cmd;
use crate::git::tests::{TempDir, commit, git};

#[test]
fn merging_moves_the_target_and_leaves_the_source_alone() {
    let temp = TempDir::new("merge");
    let repo = repository(&temp, &["one.txt"]);
    git(&repo, &["checkout", "--quiet", "-b", "topic"]);
    commit(&repo, "two.txt", "two");
    let topic = head_of(&repo, "topic");
    git(&repo, &["checkout", "--quiet", "main"]);

    let merged = in_branch_worktree(&repo, "main", "merge", |dir| {
        ensure_clean(dir)?;
        run_or_abort(dir, &["merge", "--no-edit", "topic"], &["merge", "--abort"])
    })
    .expect("merge");

    assert!(!merged.is_empty(), "merge said nothing");
    assert_eq!(head_of(&repo, "main"), topic, "main did not fast-forward");
    assert_eq!(head_of(&repo, "topic"), topic, "topic moved");
}

#[test]
fn a_dirty_worktree_refuses_the_operation_rather_than_half_doing_it() {
    let temp = TempDir::new("dirty");
    let repo = repository(&temp, &["one.txt"]);
    std::fs::write(repo.join("one.txt"), "uncommitted").expect("write");

    let refused = ensure_clean(&repo);
    assert!(refused.is_err(), "a dirty worktree was accepted");
    assert_eq!(refused.unwrap_err(), DIRTY, "the refusal was not the one");
}

#[test]
fn reverting_adds_a_commit_that_undoes_the_named_one() {
    let temp = TempDir::new("revert");
    let repo = repository(&temp, &["one.txt", "two.txt"]);
    let before = head_of(&repo, "main");

    in_branch_worktree(&repo, "main", "revert", |dir| {
        run_or_abort(
            dir,
            &["revert", "--no-edit", &before],
            &["revert", "--abort"],
        )
        .map(|_| ())
    })
    .expect("revert");

    assert_ne!(head_of(&repo, "main"), before, "nothing was committed");
    assert!(
        !repo.join("two.txt").exists(),
        "the reverted change is still there"
    );
}

#[test]
fn undoing_the_tip_moves_the_branch_back_one_commit() {
    let temp = TempDir::new("undo");
    let repo = repository(&temp, &["one.txt", "two.txt"]);
    let tip = head_of(&repo, "main");
    let parent = git(&repo, &["rev-parse", "main^"]).trim().to_string();

    in_branch_worktree(&repo, "main", "undo", |dir| {
        cmd::run(dir, &["reset", "--hard", &parent]).map(|_| ())
    })
    .expect("undo");

    assert_eq!(head_of(&repo, "main"), parent, "main did not move back");
    assert_ne!(parent, tip);
    assert!(!repo.join("two.txt").exists(), "the commit is still there");
}

#[test]
fn what_does_not_exist_is_reported_rather_than_guessed_at() {
    let temp = TempDir::new("missing");
    let repo = repository(&temp, &["one.txt"]);
    assert!(branch_tip(&repo, "nothing").is_err());
    assert!(validate_branch(&repo, "bad name").is_err());
    assert!(validate_branch(&repo, "feature/x").is_ok());
    assert!(resolve_commit(&repo, "deadbeef").is_err());
    assert!(resolve_commit(&repo, "main").is_ok());
}
