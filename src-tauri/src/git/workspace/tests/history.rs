//! Merging, reverting and undoing, run in the branch's own worktree.

use super::super::history::sync_at;
use super::super::probe::{DIRTY, ensure_clean, in_branch_worktree, run_or_abort};
use super::super::probe::{branch_tip, resolve_commit, validate_branch};
use super::{head_of, repository};
use crate::git::cmd;
use crate::git::tests::{TempDir, commit, git};

use std::path::PathBuf;

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

/// A repository with a bare remote beside it and one commit pushed to it, plus
/// a second checkout of that remote to be somebody else working in.
///
/// A bare repository on a path is a remote like any other, and it is the only
/// kind a test can have — see `git::tests::remote`, which builds the same thing
/// for the fetch on its own.
fn paired(temp: &TempDir) -> (PathBuf, PathBuf) {
    let root = temp.path();
    git(root, &["init", "--bare", "-b", "main", "origin.git"]);
    let bare = root.join("origin.git");
    let url = bare.to_str().expect("utf-8").to_string();

    let here = repository(temp, &["one.txt"]);
    git(&here, &["remote", "add", "origin", &url]);
    git(&here, &["push", "-u", "origin", "main"]);

    git(root, &["clone", &url, "there"]);
    let there = root.join("there");
    (here, there)
}

#[test]
fn syncing_brings_the_whole_of_the_remote_down_when_nothing_is_in_the_way() {
    let temp = TempDir::new("sync-clean");
    let (here, there) = paired(&temp);

    commit(&there, "two.txt", "theirs");
    commit(&there, "three.txt", "theirs");
    git(&there, &["push", "origin", "main"]);

    let brought = sync_at(&here, "origin", "main").expect("sync");
    assert_eq!(
        (brought.taken, brought.left, brought.blocked),
        (2, 0, false),
        "the sync did not take everything that was there"
    );
    assert_eq!(
        head_of(&here, "main"),
        head_of(&here, "refs/remotes/origin/main"),
        "the branch did not come level with its remote end"
    );
    assert!(here.join("three.txt").exists(), "the work did not arrive");
}

/// The situation the gesture is for: both ends have moved, and one of the
/// commits out there touches the same file this branch did. What is behind that
/// commit is somebody else's work that needs nobody, and it comes across; the
/// commit that needs a decision is left where it is.
#[test]
fn syncing_stops_at_the_commit_that_would_have_to_be_settled_by_hand() {
    let temp = TempDir::new("sync-stop");
    let (here, there) = paired(&temp);

    commit(&there, "two.txt", "theirs");
    let clean = head_of(&there, "HEAD");
    commit(&there, "one.txt", "theirs");
    let contested = head_of(&there, "HEAD");
    git(&there, &["push", "origin", "main"]);

    // This end moves on the same file, which is what makes the second of those
    // a decision rather than a fast-forward.
    commit(&here, "one.txt", "ours");

    let brought = sync_at(&here, "origin", "main").expect("sync");
    assert_eq!(
        (brought.taken, brought.left, brought.blocked),
        (1, 1, true),
        "the sync did not stop where the conflict is"
    );
    assert!(
        here.join("two.txt").exists(),
        "what would have merged did not come across"
    );
    assert_eq!(
        std::fs::read_to_string(here.join("one.txt")).expect("read one.txt"),
        "ours",
        "the contested commit was taken anyway"
    );
    assert_eq!(
        head_of(&here, "main^2"),
        clean,
        "the merge stopped somewhere other than the last commit that would go"
    );
    assert_eq!(
        head_of(&here, "refs/remotes/origin/main"),
        contested,
        "the remote end did not keep what the branch has not taken"
    );
}

#[test]
fn syncing_a_branch_that_is_already_level_takes_nothing_and_says_so() {
    let temp = TempDir::new("sync-level");
    let (here, _) = paired(&temp);

    let before = head_of(&here, "main");
    let brought = sync_at(&here, "origin", "main").expect("sync");
    assert_eq!(
        (brought.taken, brought.left, brought.blocked),
        (0, 0, false),
        "a branch with nothing to take reported something"
    );
    assert_eq!(head_of(&here, "main"), before, "the branch moved anyway");
}

/// A conflict on the very first commit is a sync that did nothing, and it has
/// to read as that rather than as a branch that was already level.
#[test]
fn a_sync_stopped_at_the_first_commit_is_a_sync_that_took_nothing() {
    let temp = TempDir::new("sync-none");
    let (here, there) = paired(&temp);

    commit(&there, "one.txt", "theirs");
    git(&there, &["push", "origin", "main"]);
    commit(&here, "one.txt", "ours");
    let before = head_of(&here, "main");

    let brought = sync_at(&here, "origin", "main").expect("sync");
    assert_eq!(
        (brought.taken, brought.left, brought.blocked),
        (0, 1, true),
        "a sync that could take nothing did not say so"
    );
    assert_eq!(
        head_of(&here, "main"),
        before,
        "the branch moved with nothing to move it"
    );
}
