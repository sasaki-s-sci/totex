//! What is uncommitted in a worktree, counted by what became of each file.

use std::path::Path;

use super::super::WorktreeStatus;
use super::super::status::{count_name_status, read_status};
use super::repository;
use crate::git::tests::{TempDir, git};

/// What is uncommitted in a directory, as the three counts.
fn count(dir: &Path) -> (u32, u32, u32) {
    let status = read_status(dir).expect("status");
    (status.added, status.deleted, status.modified)
}

#[test]
fn what_arrived_is_counted_apart_from_what_left() {
    let mut status = WorktreeStatus::default();
    count_name_status(
        concat!(
            "M\0edited.txt\0",
            "A\0arrived.txt\0",
            "D\0left.txt\0",
            // Two paths, and the file is neither new nor gone.
            "R100\0was.txt\0is.txt\0",
            "T\0now-a-link\0",
        ),
        &mut status,
    );

    assert_eq!(status.added, 1);
    assert_eq!(status.deleted, 1);
    assert_eq!(status.modified, 3);
}

#[test]
fn a_rename_does_not_eat_the_letter_after_it() {
    let mut status = WorktreeStatus::default();
    // The second path of a rename is a path and not the next file's letter:
    // reading it as one would count `A` as a file that arrived.
    count_name_status("R100\0was.txt\0A\0D\0gone.txt\0", &mut status);

    assert_eq!(status.added, 0);
    assert_eq!(status.deleted, 1);
    assert_eq!(status.modified, 1);
}

#[test]
fn status_counts_the_files_a_worktree_has_that_its_commit_does_not() {
    let temp = TempDir::new("status");
    let repo = repository(&temp, &["one.txt", "two.txt"]);
    assert_eq!(count(&repo), (0, 0, 0));

    std::fs::write(repo.join("one.txt"), "a\nb\n").expect("write");
    assert_eq!(count(&repo), (0, 0, 1));

    // Staged or not is the same fact to anyone looking at the folder.
    git(&repo, &["add", "one.txt"]);
    assert_eq!(count(&repo), (0, 0, 1));

    // A file git has never heard of is a file the worktree has and the commit
    // does not, which is what a new file is.
    std::fs::write(repo.join("three.txt"), "new\nfile\n").expect("write");
    assert_eq!(count(&repo), (1, 0, 1));

    // And one that has gone is counted where it went, not where it was.
    std::fs::remove_file(repo.join("two.txt")).expect("remove");
    assert_eq!(count(&repo), (1, 1, 1));
}
