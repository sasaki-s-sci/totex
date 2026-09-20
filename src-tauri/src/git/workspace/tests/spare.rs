//! A worktree made ahead of time, and a branch taking it over.

use std::path::Path;

use super::super::spare::{drop_spare, is_a_place, make_spare, spare_of, take_spare};
use super::{head_of, repository};
use crate::git::inspect;
use crate::git::tests::{TempDir, commit, git};

/// The worktrees the window would be told about.
fn drawn(repo: &Path) -> Vec<String> {
    let located = inspect::locate(repo).expect("locate");
    inspect::inspect(&located, 10)
        .expect("inspect")
        .worktrees
        .into_iter()
        .map(|worktree| worktree.path)
        .collect()
}

#[test]
fn a_spare_is_listed_by_git_and_drawn_by_nothing() {
    let temp = TempDir::new("spare-hidden");
    let repo = repository(&temp, &["one.txt"]);
    let root = temp.path().join("worktrees");

    make_spare(&root, &repo, "HEAD").expect("make");

    let spare = spare_of(&repo).expect("look").expect("a spare");
    assert!(spare.join("one.txt").is_file());
    assert_eq!(drawn(&repo).len(), 1, "only the main worktree is a place");

    // Asking twice is asking once.
    make_spare(&root, &repo, "HEAD").expect("make again");
    assert_eq!(spare_of(&repo).expect("look"), Some(spare));
}

#[test]
fn a_branch_takes_the_spare_to_its_own_path() {
    let temp = TempDir::new("spare-taken");
    let repo = repository(&temp, &["one.txt", "two.txt"]);
    let root = temp.path().join("worktrees");
    let first = head_of(&repo, "main~1");
    make_spare(&root, &repo, "HEAD").expect("make");
    let spare = spare_of(&repo).expect("look").expect("a spare");

    let path = root.join("topic");
    assert!(take_spare(&repo, "topic", &first, &path));

    assert_eq!(head_of(&repo, "topic"), first);
    assert!(path.join("one.txt").is_file());
    assert!(
        !path.join("two.txt").exists(),
        "switched to the older commit"
    );
    assert!(!spare.exists());
    assert_eq!(spare_of(&repo).expect("look"), None);
    assert_eq!(drawn(&repo).len(), 2, "unlocked, so it is a place now");
    assert_eq!(
        git(&path, &["status", "--porcelain"]).trim(),
        "",
        "the branch starts clean"
    );
}

#[test]
fn a_spare_somebody_has_been_in_is_thrown_away_rather_than_handed_over() {
    let temp = TempDir::new("spare-dirty");
    let repo = repository(&temp, &["one.txt"]);
    let root = temp.path().join("worktrees");
    make_spare(&root, &repo, "HEAD").expect("make");
    let spare = spare_of(&repo).expect("look").expect("a spare");
    std::fs::write(spare.join("stray.txt"), "stray").expect("write");

    assert!(!take_spare(&repo, "topic", "HEAD", &root.join("topic")));

    assert!(!spare.exists());
    assert!(git(&repo, &["branch", "--list", "topic"]).trim().is_empty());
}

#[test]
fn a_name_already_taken_leaves_the_spare_alone() {
    let temp = TempDir::new("spare-name");
    let repo = repository(&temp, &["one.txt"]);
    let root = temp.path().join("worktrees");
    git(&repo, &["branch", "topic"]);
    make_spare(&root, &repo, "HEAD").expect("make");

    assert!(!take_spare(&repo, "topic", "HEAD", &root.join("topic")));
    assert!(spare_of(&repo).expect("look").is_some());
}

#[test]
fn without_a_spare_there_is_nothing_to_take() {
    let temp = TempDir::new("spare-none");
    let repo = repository(&temp, &["one.txt"]);
    assert!(!take_spare(
        &repo,
        "topic",
        "HEAD",
        &temp.path().join("topic")
    ));
    assert!(git(&repo, &["branch", "--list", "topic"]).trim().is_empty());
}

#[test]
fn dropping_a_spare_takes_the_directory_with_it() {
    let temp = TempDir::new("spare-drop");
    let repo = repository(&temp, &["one.txt"]);
    let root = temp.path().join("worktrees");
    make_spare(&root, &repo, "HEAD").expect("make");
    let spare = spare_of(&repo).expect("look").expect("a spare");

    drop_spare(&repo).expect("drop");
    assert!(!spare.exists());
    assert_eq!(spare_of(&repo).expect("look"), None);
    drop_spare(&repo).expect("drop nothing");
}

#[test]
fn a_worktree_still_being_checked_out_is_not_drawn() {
    let temp = TempDir::new("spare-initializing");
    let repo = repository(&temp, &["one.txt"]);
    let side = temp.path().join("side");
    git(
        &repo,
        &["worktree", "add", "-b", "topic", &side.to_string_lossy()],
    );
    commit(&side, "two.txt", "two");
    assert_eq!(drawn(&repo).len(), 2);

    // What `worktree add` writes first and removes last.
    let lock = repo.join(".git/worktrees/side/locked");
    std::fs::write(&lock, "initializing").expect("lock");
    assert_eq!(drawn(&repo).len(), 1);

    std::fs::remove_file(&lock).expect("unlock");
    assert_eq!(drawn(&repo).len(), 2);

    // Locked for a reason of somebody's own is still somewhere to work.
    assert!(is_a_place(Some("on a usb stick")));
    assert!(is_a_place(None));
}
