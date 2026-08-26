//! Branches kept up with the remote ends they follow.
//!
//! The remote is a bare repository on a path, which is a remote like any other
//! and the only kind a test can have. What is being checked throughout is the
//! rule the automatic round turns on: a branch that is purely behind moves, and
//! everything else — a branch with commits of its own, a branch nothing is
//! tracking, a worktree with work in it — is left exactly where it was.

use std::path::{Path, PathBuf};

use super::super::follow::{Behind, behind_branches, forward};
use super::super::probe::{in_branch_worktree, run_or_abort};
use super::head_of;
use crate::git::tests::{TempDir, commit, git};

/// A repository with a remote, a branch pushed to it, and somebody else's
/// checkout of that remote to push the news from.
///
/// `here` is the repository under test and `there` is the other person. Both
/// point at the same bare repository, which is what makes a fetch mean anything.
struct Pair {
    here: PathBuf,
    there: PathBuf,
}

fn pair(temp: &TempDir, branches: &[&str]) -> Pair {
    let root = temp.path();
    let bare = root.join("origin.git");
    git(root, &["init", "--bare", "-b", "main", "origin.git"]);
    let bare_path = bare.to_str().expect("utf-8");

    let here = root.join("here");
    std::fs::create_dir_all(&here).expect("create here");
    git(&here, &["init", "--quiet", "-b", "main"]);
    git(&here, &["config", "user.name", "totex"]);
    git(&here, &["config", "user.email", "totex@example.invalid"]);
    commit(&here, "one.txt", "one");
    git(&here, &["remote", "add", "origin", bare_path]);
    git(&here, &["push", "--quiet", "-u", "origin", "main"]);
    for branch in branches {
        git(&here, &["branch", branch]);
        git(&here, &["push", "--quiet", "-u", "origin", branch]);
    }

    let there = root.join("there");
    git(root, &["clone", "--quiet", bare_path, "there"]);
    git(&there, &["config", "user.name", "totex"]);
    git(&there, &["config", "user.email", "totex@example.invalid"]);

    Pair { here, there }
}

/// Somebody else moves a branch on, which is the whole situation being followed.
fn push_from_there(there: &Path, branch: &str, file: &str) -> String {
    git(
        there,
        &[
            "checkout",
            "--quiet",
            "-B",
            branch,
            &format!("origin/{branch}"),
        ],
    );
    commit(there, file, file);
    git(there, &["push", "--quiet", "origin", branch]);
    head_of(there, "HEAD")
}

#[test]
fn only_a_branch_that_is_purely_behind_is_taken() {
    let temp = TempDir::new("behind");
    let Pair { here, there } = pair(&temp, &["topic", "parted"]);

    // A branch nothing on the remote knows about. It follows nothing, so there
    // is nothing for it to be behind.
    git(&here, &["branch", "solo"]);

    push_from_there(&there, "topic", "two.txt");
    push_from_there(&there, "parted", "three.txt");

    // And this end puts a commit of its own on one of them, so that branch is
    // now two ends that have parted rather than one that is merely behind.
    git(&here, &["checkout", "--quiet", "parted"]);
    commit(&here, "mine.txt", "mine");
    git(&here, &["checkout", "--quiet", "main"]);

    crate::git::remote::fetch_at(&here, "origin", "topic").expect("fetch topic");
    crate::git::remote::fetch_at(&here, "origin", "parted").expect("fetch parted");

    let taken: Vec<String> = behind_branches(&here)
        .expect("read the branches")
        .into_iter()
        .map(|behind| behind.branch)
        .collect();

    assert_eq!(taken, vec!["topic".to_string()], "the wrong branches moved");
}

#[test]
fn a_branch_nobody_is_standing_in_moves_as_a_ref() {
    let temp = TempDir::new("forward-ref");
    let Pair { here, there } = pair(&temp, &["topic"]);
    let moved = push_from_there(&there, "topic", "two.txt");
    crate::git::remote::fetch_at(&here, "origin", "topic").expect("fetch");

    let behind = behind_branches(&here).expect("read the branches");
    let topic = behind.first().expect("topic is behind");
    assert!(forward(&here, topic, None), "the ref did not move");
    assert_eq!(head_of(&here, "topic"), moved, "topic is not at the remote");

    // No checkout was made for it, and the branch that is checked out here is
    // untouched: this is a ref moving and nothing else.
    assert!(!here.join("two.txt").exists(), "a working tree was written");
    assert_eq!(
        git(&here, &["worktree", "list", "--porcelain"])
            .matches("worktree ")
            .count(),
        1,
        "a worktree was left behind"
    );

    // A branch that moved since it was read is left alone rather than reset:
    // the commit it was read at is named, and this one no longer stands there.
    let stale = Behind {
        branch: topic.branch.clone(),
        tip: "0000000000000000000000000000000000000000".to_string(),
        upstream: topic.upstream.clone(),
    };
    assert!(!forward(&here, &stale, None), "a stale read moved a branch");
}

#[test]
fn a_worktree_with_work_in_it_is_left_where_it_is() {
    let temp = TempDir::new("forward-tree");
    let Pair { here, there } = pair(&temp, &[]);
    let moved = push_from_there(&there, "main", "two.txt");
    crate::git::remote::fetch_at(&here, "origin", "main").expect("fetch");

    let was = head_of(&here, "main");
    std::fs::write(here.join("one.txt"), "uncommitted").expect("write");

    let behind = behind_branches(&here).expect("read the branches");
    let main = behind.first().expect("main is behind");
    assert!(
        !forward(&here, main, Some(&here)),
        "a dirty worktree was written over"
    );
    assert_eq!(head_of(&here, "main"), was, "main moved anyway");

    // Put the file back and the same branch goes, files and all.
    git(&here, &["checkout", "--", "one.txt"]);
    assert!(
        forward(&here, main, Some(&here)),
        "a clean worktree refused"
    );
    assert_eq!(head_of(&here, "main"), moved, "main is not at the remote");
    assert!(here.join("two.txt").exists(), "the files did not follow");
}

/// The merge a drop asks for, refused: what comes back has to be git's own
/// words, because those words are the whole of what the window can show. Git
/// writes some of a stopped merge to stdout and the rest to stderr — see
/// `cmd::run`, which is where the two are put back together.
#[test]
fn a_refusal_comes_back_in_gits_own_words() {
    let temp = TempDir::new("refused");
    let Pair { here, there } = pair(&temp, &[]);

    // The same file, written differently at both ends: a merge git cannot do
    // on its own.
    git(&there, &["checkout", "--quiet", "main"]);
    commit(&there, "one.txt", "theirs");
    git(&there, &["push", "--quiet", "origin", "main"]);
    commit(&here, "one.txt", "mine");
    crate::git::remote::fetch_at(&here, "origin", "main").expect("fetch");

    let refused = in_branch_worktree(&here, "main", "follow", |dir| {
        Ok(run_or_abort(
            dir,
            &["merge", "--no-edit", "refs/remotes/origin/main"],
            &["merge", "--abort"],
        )
        .err())
    })
    .expect("the merge ran")
    .expect("the merge was refused");

    assert!(!refused.is_empty(), "the refusal said nothing");
    assert!(
        refused.to_lowercase().contains("conflict"),
        "git's words did not survive: {refused}"
    );
    // And the worktree is back where it was, rather than left half merged.
    assert_eq!(
        std::fs::read_to_string(here.join("one.txt")).expect("read"),
        "mine",
        "the aborted merge was left in the worktree"
    );
}
