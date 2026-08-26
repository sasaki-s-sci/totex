//! What a card is told about the file it is holding.

use std::path::PathBuf;

use super::*;
// The same fixture the rest of the git suite is built on: a temp directory that
// cleans itself up, and a git isolated from whatever config the machine has.
use crate::git::tests::{TempDir, git};

/// A repository with one committed file in it.
fn repository(temp: &TempDir) -> PathBuf {
    let path = temp.path().join("repo");
    std::fs::create_dir_all(&path).expect("create dir");
    git(&path, &["init", "--quiet", "-b", "main"]);
    git(&path, &["config", "user.name", "totex"]);
    git(&path, &["config", "user.email", "totex@example.invalid"]);
    std::fs::write(path.join("read.txt"), "one\ntwo\nthree\nfour\n").expect("write file");
    git(&path, &["add", "."]);
    git(&path, &["commit", "-m", "first"]);
    path
}

#[test]
fn a_file_as_the_commit_under_it_has_it_has_nothing_to_show() {
    let temp = TempDir::new("patch-same");
    let repo = repository(&temp);
    let answer = read_diff(&repo.join("read.txt"));
    assert_eq!(answer.standing, Standing::Same);
    assert!(answer.patch.is_empty());
    assert!(answer.runs.is_empty());
}

#[test]
fn a_file_outside_a_repository_is_one_nothing_would_answer_for() {
    let temp = TempDir::new("patch-unknown");
    std::fs::write(temp.path().join("loose.txt"), "alone\n").expect("write file");
    assert_eq!(
        read_diff(&temp.path().join("loose.txt")).standing,
        Standing::Unknown
    );
}

#[test]
fn a_file_git_has_never_been_told_about_is_new_whole() {
    let temp = TempDir::new("patch-untracked");
    let repo = repository(&temp);
    std::fs::write(repo.join("arrived.txt"), "fresh\n").expect("write file");
    let answer = read_diff(&repo.join("arrived.txt"));
    assert_eq!(answer.standing, Standing::Untracked);
    // Nothing to say beyond that: what the card is already holding is the whole
    // of what arrived.
    assert!(answer.patch.is_empty());
}

#[test]
fn a_rewritten_file_carries_the_hunks_and_the_lines_they_landed_on() {
    let temp = TempDir::new("patch-changed");
    let repo = repository(&temp);
    std::fs::write(repo.join("read.txt"), "one\nTWO\nthree\nfour\nfive\n").expect("write file");

    let answer = read_diff(&repo.join("read.txt"));
    assert_eq!(answer.standing, Standing::Changed);
    assert!(!answer.truncated);
    // The header git names the file in is off, and the hunks are as it printed
    // them.
    assert!(answer.patch.starts_with("@@ "), "{}", answer.patch);
    assert!(answer.patch.contains("+TWO"));
    assert_eq!(
        answer.runs,
        vec![
            Run {
                line: 2,
                lines: 1,
                mark: Mark::Modified
            },
            Run {
                line: 5,
                lines: 1,
                mark: Mark::Added
            },
        ]
    );

    // Staged or not is the same fact to whoever is reading the file.
    git(&repo, &["add", "read.txt"]);
    assert_eq!(
        read_diff(&repo.join("read.txt")).standing,
        Standing::Changed
    );
}

/// A file whose name would be read as a pattern, or as an option, is one file.
#[test]
fn a_name_git_would_read_as_something_else_is_still_a_name() {
    let temp = TempDir::new("patch-pathspec");
    let repo = repository(&temp);
    for name in ["star*.txt", "-dash.txt"] {
        std::fs::write(repo.join(name), "first\n").expect("write file");
    }
    git(&repo, &["add", "."]);
    git(&repo, &["commit", "-m", "odd names"]);

    std::fs::write(repo.join("star*.txt"), "second\n").expect("write file");
    // The pattern would have caught the other file as well, and the diff would
    // then have held two of them.
    let answer = read_diff(&repo.join("star*.txt"));
    assert_eq!(answer.standing, Standing::Changed);
    assert_eq!(answer.patch.matches("@@ ").count(), 1, "{}", answer.patch);
    assert_eq!(read_diff(&repo.join("-dash.txt")).standing, Standing::Same);
}

#[test]
fn lines_that_went_and_left_nothing_stand_at_the_gap() {
    let runs = runs_of("@@ -1,4 +1,2 @@\n one\n-two\n-three\n four\n");
    assert_eq!(
        runs,
        vec![Run {
            line: 2,
            lines: 0,
            mark: Mark::Deleted
        }]
    );
}

/// A file cut short at the end has its gap one line past the end of it, which is
/// the only place the mark can stand.
#[test]
fn a_file_cut_short_has_its_gap_past_its_last_line() {
    let runs = runs_of("@@ -1,3 +1,2 @@\n one\n two\n-three\n");
    assert_eq!(
        runs,
        vec![Run {
            line: 3,
            lines: 0,
            mark: Mark::Deleted
        }]
    );
}

/// Every hunk of a patch is read, and the lines it lands on are its own.
#[test]
fn each_hunk_counts_from_where_it_says_it_lands() {
    let runs = runs_of(concat!(
        "@@ -1,3 +1,4 @@\n one\n+two\n three\n four\n",
        "@@ -20,3 +21,3 @@ fn thing()\n twenty\n-old\n+new\n twentytwo\n",
    ));
    assert_eq!(
        runs,
        vec![
            Run {
                line: 2,
                lines: 1,
                mark: Mark::Added
            },
            Run {
                line: 22,
                lines: 1,
                mark: Mark::Modified
            },
        ]
    );
}

/// The marker git writes about the line above it is not a line of the file.
#[test]
fn the_no_newline_marker_counts_for_nothing() {
    let runs = runs_of("@@ -1,2 +1,2 @@\n one\n-two\n+two\n\\ No newline at end of file\n");
    assert_eq!(
        runs,
        vec![Run {
            line: 2,
            lines: 1,
            mark: Mark::Modified
        }]
    );
}

#[test]
fn a_hunk_of_one_line_leaves_its_count_off() {
    assert_eq!(hunk_at("@@ -1 +1 @@"), Some(1));
    assert_eq!(hunk_at("@@ -1,4 +12,9 @@ fn thing()"), Some(12));
    assert_eq!(hunk_at(" one"), None);
}

#[test]
fn a_file_that_is_not_text_keeps_the_one_line_git_says_so_in() {
    let patch = body_of(
        "diff --git a/x.png b/x.png\nindex 1..2 100644\nBinary files a/x.png and b/x.png differ\n",
    );
    assert_eq!(patch, "Binary files a/x.png and b/x.png differ");
    assert!(runs_of(&patch).is_empty());
}

#[test]
fn a_patch_longer_than_a_card_could_hold_is_cut_at_a_line() {
    let long = std::iter::repeat_n("+a line of it\n", 40_000).collect::<String>();
    let (patch, truncated) = cut(format!("@@ -0,0 +1,40000 @@\n{long}"));
    assert!(truncated);
    assert!(patch.len() <= MAX_PATCH);
    assert!(patch.ends_with("+a line of it"));
}
