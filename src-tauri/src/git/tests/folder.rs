//! The question the folder column asks about every folder it lists: how many
//! repositories are in here?

use super::{TempDir, git};

/// The question the folder column asks about every folder it lists: how many
/// repositories are in here?
#[test]
fn a_folder_is_marked_with_how_many_repositories_it_holds() {
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

    let held = |dir: &str| {
        super::super::discover::count_repositories(
            &root.join(dir),
            super::super::SCAN_DEPTH,
            super::super::HOLD_BUDGET,
        )
    };

    assert_eq!(held("repo"), 1, "a repository is one");
    assert_eq!(
        held("deep"),
        1,
        "a folder with one buried under it holds one"
    );
    assert_eq!(held("plain"), 0, "a folder of empty folders holds none");
    assert_eq!(
        super::super::discover::count_repositories(
            root,
            super::super::SCAN_DEPTH,
            super::super::HOLD_BUDGET
        ),
        3,
        "the folder they are all in holds the lot"
    );

    // A linked worktree is the same repository checked out again, not another
    // one: this window makes one per branch, and a folder of one project would
    // otherwise count as a folder of four.
    git(
        &root.join("repo"),
        &["commit", "--allow-empty", "-m", "one"],
    );
    git(
        &root.join("repo"),
        &["worktree", "add", "-b", "side", "../repo-side"],
    );
    assert_eq!(
        super::super::discover::count_repositories(
            root,
            super::super::SCAN_DEPTH,
            super::super::HOLD_BUDGET
        ),
        3,
        "a worktree of one of them is not a fourth repository"
    );

    // Running out of budget answers with what was found rather than failing:
    // nothing turns on the number, and a folder can be put on the graph either
    // way.
    assert_eq!(
        super::super::discover::count_repositories(
            &root.join("plain"),
            super::super::SCAN_DEPTH,
            1
        ),
        0,
        "a walk that gave up says what it saw"
    );
}
