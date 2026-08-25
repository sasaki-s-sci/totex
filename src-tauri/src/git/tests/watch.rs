//! Which paths a repository is watched at, and what a change there reports.

use std::path::{Path, PathBuf};

use super::{TempDir, commit, find, git, git_available, scan};

#[test]
fn the_watcher_reports_a_ref_change() {
    if !git_available() {
        eprintln!("skipping: git is not on PATH");
        return;
    }

    let temp = TempDir::new("watch");
    let root = temp.path();
    let repo = root.join("epsilon");
    std::fs::create_dir_all(&repo).expect("create epsilon");
    git(&repo, &["init", "-b", "main"]);
    commit(&repo, "one.txt", "1");

    let workspace = scan(root.to_string_lossy().into_owned(), None).expect("scan");
    let repository = find(&workspace.repositories, "epsilon");

    let (sender, receiver) = std::sync::mpsc::channel();
    let _watcher = super::super::watch::start(
        &workspace.root,
        std::slice::from_ref(&repository.git_dir),
        std::slice::from_ref(&repository.path),
        move |touched| {
            let _ = sender.send(touched);
        },
    )
    .expect("start the watcher");

    // What `git branch` does, without racing the watcher against git's own
    // temporary files.
    let head = std::fs::read_to_string(repo.join(".git/refs/heads/main")).expect("read main");
    std::fs::write(repo.join(".git/refs/heads/probe"), head).expect("write probe ref");

    let touched = receiver
        .recv_timeout(std::time::Duration::from_secs(10))
        .expect("a ref change must be reported");
    // The refresh reads the paths to decide which repository to re-read, so a
    // report that does not name one is a report it cannot act on.
    assert!(
        touched
            .iter()
            .any(|path| path.starts_with(&repository.git_dir)),
        "the change must be reported under the repository it happened in: {touched:?}"
    );
}

#[test]
fn the_watcher_reports_each_relevant_path_once() {
    let paths = [
        PathBuf::from("/repo/.git/refs/heads/main"),
        PathBuf::from("/repo/.git/index.lock"),
        PathBuf::from("/repo/.git/refs/heads/main"),
        PathBuf::from("/repo/.git/HEAD"),
    ];

    assert_eq!(
        super::super::watch::relevant_paths(paths.iter()),
        vec![
            PathBuf::from("/repo/.git/refs/heads/main"),
            PathBuf::from("/repo/.git/HEAD"),
        ]
    );
}

#[test]
fn the_watcher_skips_git_lock_files() {
    assert!(!super::super::watch::targets::is_relevant(Path::new(
        "/repo/.git/index.lock"
    )));
    assert!(super::super::watch::targets::is_relevant(Path::new(
        "/repo/.git/refs/heads/main"
    )));
}

#[test]
fn the_watch_set_covers_refs_and_the_shallow_tree() {
    let temp = TempDir::new("targets");
    let root = temp.path();
    let git_dir = root.join("zeta").join(".git");
    std::fs::create_dir_all(git_dir.join("refs")).expect("create refs");
    std::fs::create_dir_all(root.join("nested").join("deeper")).expect("create nested");

    let targets = super::super::watch::watch_targets(
        &crate::host::Host::Local,
        &root.to_string_lossy(),
        &[git_dir.to_string_lossy().into_owned()],
        &[root.join("zeta").to_string_lossy().into_owned()],
    );
    let paths: Vec<&Path> = targets.iter().map(|target| target.path.as_path()).collect();

    assert!(paths.contains(&git_dir.as_path()), "the git dir itself");
    assert!(paths.contains(&git_dir.join("refs").as_path()), "its refs");
    assert!(paths.contains(&root), "the scanned root");
    assert!(
        paths.contains(&root.join("nested").as_path()),
        "a directory a new repository could appear in"
    );
    // `worktrees` does not exist here, so it must not have been registered.
    assert!(!paths.contains(&git_dir.join("worktrees").as_path()));
}
