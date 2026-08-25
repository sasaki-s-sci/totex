//! A refresh re-reads what moved and leaves the rest of the workspace alone.

use std::path::PathBuf;

use super::super::session::Session;
use super::{TempDir, commit, find, git, git_available, two_repositories};

#[test]
fn a_refresh_reports_only_what_moved() {
    if !git_available() {
        eprintln!("skipping: git is not on PATH");
        return;
    }

    let temp = TempDir::new("refresh");
    let root = temp.path();
    two_repositories(root);

    let mut session = Session::open(&root.to_string_lossy(), None).expect("open");
    let workspace = session.workspace();
    let alpha = find(&workspace.repositories, "alpha").clone();
    let beta = find(&workspace.repositories, "beta").clone();

    // Nothing has happened yet, so a refresh has nothing to say.
    assert!(
        session.refresh(None).expect("refresh").is_empty(),
        "an unchanged workspace must produce no delta"
    );

    commit(&root.join("alpha"), "two.txt", "2");
    let touched = vec![PathBuf::from(&alpha.git_dir).join("refs/heads/main")];
    let delta = session.refresh(Some(&touched)).expect("refresh");

    assert!(delta.added.is_empty() && delta.removed.is_empty());
    assert_eq!(delta.changed.len(), 1, "only alpha moved: {delta:?}");

    let changed = &delta.changed[0];
    assert_eq!(changed.id, alpha.id);
    // The head ref did not change name, so the scalars stayed put.
    assert!(changed.summary.is_none(), "{:?}", changed.summary);
    assert!(changed.branches.is_some(), "main advanced");

    let commits = changed.commits.as_ref().expect("history changed");
    assert_eq!(
        commits.added.len(),
        1,
        "only the new commit travels: {:?}",
        commits.added
    );
    assert_eq!(commits.added[0].subject, "add two.txt");
    assert_eq!(
        commits.order.len(),
        2,
        "the order carries the whole history"
    );
    assert_eq!(commits.order[0], commits.added[0].id, "newest first");

    // Beta was never re-read, so it cannot have produced a delta.
    assert!(
        !delta.changed.iter().any(|entry| entry.id == beta.id),
        "an untouched repository must not be reported"
    );
    assert!(session.refresh(None).expect("refresh").is_empty());
}

#[test]
fn a_refresh_re_reads_only_the_repository_a_change_pointed_at() {
    if !git_available() {
        eprintln!("skipping: git is not on PATH");
        return;
    }

    let temp = TempDir::new("targeted");
    let root = temp.path();
    two_repositories(root);

    let mut session = Session::open(&root.to_string_lossy(), None).expect("open");
    let beta = find(&session.workspace().repositories, "beta").clone();

    // A commit in alpha, reported as a change in beta: the refresh reads what
    // it was pointed at and nothing else, which is the whole point of it.
    commit(&root.join("alpha"), "two.txt", "2");
    let touched = vec![PathBuf::from(&beta.git_dir).join("refs/heads/main")];
    assert!(
        session.refresh(Some(&touched)).expect("refresh").is_empty(),
        "a change in one repository must not cost a read of another"
    );

    // Asking for everything still finds it.
    let delta = session.refresh(None).expect("refresh");
    assert_eq!(delta.changed.len(), 1);
    assert_eq!(
        delta.changed[0]
            .commits
            .as_ref()
            .expect("history")
            .order
            .len(),
        2
    );
}

#[test]
fn a_change_inside_a_nested_repository_belongs_to_the_nested_one() {
    if !git_available() {
        eprintln!("skipping: git is not on PATH");
        return;
    }

    let temp = TempDir::new("nested");
    let root = temp.path();

    let outer = root.join("outer");
    std::fs::create_dir_all(&outer).expect("create outer");
    git(&outer, &["init", "-b", "main"]);
    commit(&outer, "one.txt", "1");

    // A repository inside another one's worktree, which is what a submodule
    // looks like from here: both of them own the path that changed.
    let inner = outer.join("inner");
    std::fs::create_dir_all(&inner).expect("create inner");
    git(&inner, &["init", "-b", "main"]);
    commit(&inner, "one.txt", "1");

    let mut session = Session::open(&root.to_string_lossy(), None).expect("open");
    let inner_repo = find(&session.workspace().repositories, "inner").clone();

    commit(&inner, "two.txt", "2");
    let touched = vec![PathBuf::from(&inner_repo.git_dir).join("refs/heads/main")];
    let delta = session.refresh(Some(&touched)).expect("refresh");

    assert_eq!(delta.changed.len(), 1, "{delta:?}");
    assert_eq!(
        delta.changed[0].id, inner_repo.id,
        "the innermost repository owns the change"
    );
}

#[test]
fn a_repository_that_appears_arrives_whole_and_one_that_leaves_is_named() {
    if !git_available() {
        eprintln!("skipping: git is not on PATH");
        return;
    }

    let temp = TempDir::new("structure");
    let root = temp.path();
    two_repositories(root);

    let mut session = Session::open(&root.to_string_lossy(), None).expect("open");

    let gamma = root.join("gamma");
    std::fs::create_dir_all(&gamma).expect("create gamma");
    git(&gamma, &["init", "-b", "main"]);
    commit(&gamma, "one.txt", "1");

    // A path under no known repository is the tree itself moving, so the walk
    // runs again even though this is not a full refresh.
    let touched = vec![gamma.clone()];
    let delta = session.refresh(Some(&touched)).expect("refresh");
    assert_eq!(delta.added.len(), 1, "a new repository comes in full");
    assert_eq!(delta.added[0].name, "gamma");
    assert_eq!(delta.added[0].commits.len(), 1);
    assert!(delta.changed.is_empty(), "the other two did not move");
    assert_eq!(
        delta.order.as_ref().map(Vec::len),
        Some(3),
        "the display order comes with a set that changed"
    );

    let removed_id = delta.added[0].id.clone();
    std::fs::remove_dir_all(&gamma).expect("remove gamma");
    let delta = session.refresh(Some(&touched)).expect("refresh");
    assert_eq!(delta.removed, vec![removed_id]);
    assert!(delta.added.is_empty() && delta.changed.is_empty());
}
