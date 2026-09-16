//! The question the repository pane asks about the folder it is pointed at:
//! which repositories are in here?

use std::path::Path;

use super::{TempDir, git};

/// The listing, named relative to `root` and in the order the pane shows.
fn listed(root: &Path) -> Vec<(String, String)> {
    let found = super::super::discover::list_repositories(
        root,
        super::super::SCAN_DEPTH,
        super::super::LIST_BUDGET,
        |_| {},
        || true,
    );
    assert!(!found.truncated && !found.stopped, "{:?}", found.warnings);
    let mut rows: Vec<(String, String)> = found
        .repositories
        .iter()
        .map(|path| {
            let name = path.file_name().unwrap().to_string_lossy().into_owned();
            let under = path
                .strip_prefix(root)
                .unwrap()
                .to_string_lossy()
                .replace('\\', "/");
            (name, under)
        })
        .collect();
    rows.sort();
    rows
}

#[test]
fn a_folder_lists_the_repositories_it_holds() {
    let temp = TempDir::new("holds");
    let root = temp.path();

    // Two repositories side by side, one nested a few levels down, and a folder
    // of neither.
    let plain = root.join("plain").join("a").join("b");
    std::fs::create_dir_all(&plain).expect("create plain");
    std::fs::create_dir_all(root.join("deep").join("one").join("two")).expect("create deep");
    git(root, &["init", "repo"]);
    git(root, &["init", "other"]);
    git(root, &["init", "deep/one/two/buried"]);

    assert_eq!(
        listed(&root.join("repo")),
        [("repo".to_string(), String::new())],
        "a repository lists itself, by its own name"
    );
    assert_eq!(
        listed(&root.join("deep")),
        [("buried".to_string(), "one/two/buried".to_string())],
        "a folder with one buried under it lists that one"
    );
    assert!(
        listed(&root.join("plain")).is_empty(),
        "a folder of empty folders lists none"
    );
    assert_eq!(
        listed(root),
        [
            ("buried".to_string(), "deep/one/two/buried".to_string()),
            ("other".to_string(), "other".to_string()),
            ("repo".to_string(), "repo".to_string()),
        ],
        "the folder they are all in lists the lot"
    );

    // A linked worktree is the same repository checked out again, not another
    // one: this window makes one per branch, and a folder of one project would
    // otherwise list it four times.
    git(
        &root.join("repo"),
        &["commit", "--allow-empty", "-m", "one"],
    );
    git(
        &root.join("repo"),
        &["worktree", "add", "-b", "side", "../repo-side"],
    );
    assert_eq!(
        listed(root).len(),
        3,
        "a worktree of one of them is not a fourth row"
    );

    // Running out of budget answers with what was found rather than failing:
    // nothing turns on the list being whole, and every row found is a row.
    let short = super::super::discover::list_repositories(
        &root.join("plain"),
        super::super::SCAN_DEPTH,
        1,
        |_| {},
        || true,
    );
    assert!(short.truncated, "a walk that gave up says so");
    assert!(short.repositories.is_empty());
}
