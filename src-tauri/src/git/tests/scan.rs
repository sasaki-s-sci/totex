//! The first frame: branches, worktrees and nested repositories, read whole.

use super::super::model::BranchKind;
use super::{TempDir, commit, find, git, git_available, scan, scan_repository};

#[test]
fn scans_branches_worktrees_and_nested_repositories() {
    if !git_available() {
        eprintln!("skipping: git is not on PATH");
        return;
    }

    let temp = TempDir::new("scan");
    let root = temp.path();

    // A repository with a remote branch, a tracking local branch and a fork.
    let alpha = root.join("alpha");
    std::fs::create_dir_all(&alpha).expect("create alpha");
    git(&alpha, &["init", "-b", "main"]);
    commit(&alpha, "one.txt", "1");
    commit(&alpha, "two.txt", "2");

    git(
        &alpha,
        &[
            "remote",
            "add",
            "origin",
            "https://example.invalid/alpha.git",
        ],
    );
    // Stand in for a fetched remote branch without needing a real server.
    git(&alpha, &["update-ref", "refs/remotes/origin/main", "HEAD"]);
    git(&alpha, &["branch", "--set-upstream-to=origin/main", "main"]);

    git(&alpha, &["branch", "feature/x"]);
    git(&alpha, &["checkout", "feature/x"]);
    commit(&alpha, "three.txt", "3");
    git(&alpha, &["checkout", "main"]);

    // A linked worktree, placed inside the scanned root on purpose: it must
    // collapse into `alpha` instead of showing up as its own repository.
    let linked = root.join("alpha-feature");
    git(
        &alpha,
        &[
            "worktree",
            "add",
            linked.to_str().expect("utf-8"),
            "feature/x",
        ],
    );

    // A second repository nested one level deeper.
    let beta = root.join("nested").join("beta");
    std::fs::create_dir_all(&beta).expect("create beta");
    git(&beta, &["init", "-b", "trunk"]);
    commit(&beta, "readme.md", "beta");

    let workspace = scan(root.to_string_lossy().into_owned(), None).expect("scan");

    assert_eq!(
        workspace.repositories.len(),
        2,
        "linked worktrees must not be separate repositories: {:?}",
        workspace
            .repositories
            .iter()
            .map(|r| &r.path)
            .collect::<Vec<_>>()
    );

    let alpha_repo = find(&workspace.repositories, "alpha");
    assert!(!alpha_repo.bare);
    assert_eq!(alpha_repo.head.as_deref(), Some("refs/heads/main"));
    assert_eq!(alpha_repo.remotes.len(), 1);

    let main = alpha_repo
        .branches
        .iter()
        .find(|branch| branch.ref_name == "refs/heads/main")
        .expect("main branch");
    assert_eq!(main.kind, BranchKind::Local);
    assert!(main.is_head);
    assert_eq!(main.upstream.as_deref(), Some("refs/remotes/origin/main"));
    assert_eq!((main.ahead, main.behind, main.gone), (0, 0, false));

    let origin_main = alpha_repo
        .branches
        .iter()
        .find(|branch| branch.ref_name == "refs/remotes/origin/main")
        .expect("origin/main");
    assert_eq!(origin_main.kind, BranchKind::Remote);
    assert_eq!(origin_main.remote.as_deref(), Some("origin"));
    assert_eq!(origin_main.name, "origin/main");
    assert_eq!(origin_main.logical_name, "main");

    let feature = alpha_repo
        .branches
        .iter()
        .find(|branch| branch.ref_name == "refs/heads/feature/x")
        .expect("feature/x");
    assert_eq!(
        feature.checked_out_in.len(),
        1,
        "feature/x is checked out in the linked worktree"
    );

    // Two commits on main plus the one on feature/x, newest first.
    assert_eq!(alpha_repo.commits.len(), 3);
    assert!(!alpha_repo.history_truncated);
    let tip = alpha_repo
        .commits
        .iter()
        .find(|commit| commit.id == feature.commit)
        .expect("feature tip is in the history");
    assert_eq!(tip.parents, vec![main.commit.clone()]);
    assert_eq!(tip.subject, "add three.txt");
    assert_eq!(tip.author, "totex");
    assert!(!tip.committed_at.is_empty());

    let root = alpha_repo
        .commits
        .last()
        .expect("the oldest commit is the root");
    assert!(root.parents.is_empty());

    assert_eq!(alpha_repo.worktrees.len(), 2);
    let main_worktree = alpha_repo
        .worktrees
        .iter()
        .find(|worktree| worktree.is_main)
        .expect("main worktree");
    assert_eq!(main_worktree.branch.as_deref(), Some("refs/heads/main"));
    assert!(main_worktree.exists);

    let linked_worktree = alpha_repo
        .worktrees
        .iter()
        .find(|worktree| !worktree.is_main)
        .expect("linked worktree");
    assert_eq!(
        linked_worktree.branch.as_deref(),
        Some("refs/heads/feature/x")
    );
    assert!(!linked_worktree.detached);

    let beta_repo = find(&workspace.repositories, "beta");
    assert_eq!(beta_repo.branches.len(), 1);
    assert_eq!(beta_repo.branches[0].name, "trunk");
    assert_eq!(beta_repo.worktrees.len(), 1);
    assert_eq!(beta_repo.commits.len(), 1);
}

#[test]
fn reports_bare_repositories() {
    if !git_available() {
        eprintln!("skipping: git is not on PATH");
        return;
    }

    let temp = TempDir::new("bare");
    let root = temp.path();
    let bare = root.join("gamma.git");
    std::fs::create_dir_all(&bare).expect("create bare");
    git(&bare, &["init", "--bare", "-b", "main"]);

    let workspace = scan(root.to_string_lossy().into_owned(), None).expect("scan");
    assert_eq!(workspace.repositories.len(), 1);
    assert!(workspace.repositories[0].bare);
    assert!(workspace.repositories[0].commits.is_empty());
}

/// A row of the repository pane puts one repository on the canvas: what is
/// inside it stays inside it, and a folder is not a repository.
#[test]
fn a_repository_opened_alone_is_read_alone() {
    if !git_available() {
        eprintln!("skipping: git is not on PATH");
        return;
    }

    let temp = TempDir::new("alone");
    let root = temp.path();

    let alpha = root.join("alpha");
    std::fs::create_dir_all(&alpha).expect("create alpha");
    git(&alpha, &["init", "-b", "main"]);
    commit(&alpha, "one.txt", "1");

    // A repository inside the one being opened: a folder scan would draw it,
    // and the pane the row came from would have listed alpha alone.
    let inner = alpha.join("vendor-fork");
    std::fs::create_dir_all(&inner).expect("create inner");
    git(&inner, &["init", "-b", "main"]);
    commit(&inner, "one.txt", "1");

    let workspace = scan_repository(alpha.to_string_lossy().into_owned()).expect("scan");
    assert_eq!(
        workspace
            .repositories
            .iter()
            .map(|repository| repository.name.as_str())
            .collect::<Vec<_>>(),
        ["alpha"],
        "the repository, and not the one inside it"
    );
    assert_eq!(workspace.root, alpha.to_string_lossy());
    assert!(workspace.warnings.is_empty(), "{:?}", workspace.warnings);

    // The same folder opened as a folder still draws both.
    let folder = scan(alpha.to_string_lossy().into_owned(), None).expect("scan");
    assert_eq!(folder.repositories.len(), 2);

    // A plain folder cannot be opened as a repository: there is nothing to
    // draw, and an empty graph would say the folder had no branches.
    let plain = root.join("plain");
    std::fs::create_dir_all(&plain).expect("create plain");
    scan_repository(plain.to_string_lossy().into_owned())
        .expect_err("a folder is not a repository");
    assert!(
        scan(plain.to_string_lossy().into_owned(), None)
            .expect("a folder scan")
            .repositories
            .is_empty()
    );
}

#[test]
fn rejects_a_root_that_is_not_a_directory() {
    let error = scan("/definitely/not/here".into(), None).expect_err("must fail");
    assert_eq!(error, "not-a-directory");
}

#[test]
fn reads_the_branches_a_repository_asks_to_leave_off_the_graph() {
    if !git_available() {
        eprintln!("skipping: git is not on PATH");
        return;
    }

    let temp = TempDir::new("graphignore");
    let root = temp.path();

    let alpha = root.join("alpha");
    std::fs::create_dir_all(&alpha).expect("create alpha");
    git(&alpha, &["init", "-b", "main"]);
    commit(&alpha, "one.txt", "1");

    // A repository that says nothing is a repository asking for nothing left
    // out, which is what every one of them asked for before the file existed.
    let beta = root.join("beta");
    std::fs::create_dir_all(&beta).expect("create beta");
    git(&beta, &["init", "-b", "main"]);
    commit(&beta, "one.txt", "1");

    let space = alpha.join(".totex");
    std::fs::create_dir_all(&space).expect("create space");
    std::fs::write(
        space.join(".graphignore"),
        "# what is not worth a row\n\nrelease/*\n  origin/*  \n!release/next\n",
    )
    .expect("write graphignore");

    let workspace = scan(root.to_string_lossy().into_owned(), None).expect("scan");
    // The furniture of the file is the file's own: what comes over is the list.
    assert_eq!(
        find(&workspace.repositories, "alpha").graph_ignore,
        vec![
            "release/*".to_string(),
            "origin/*".to_string(),
            "!release/next".to_string(),
        ]
    );
    assert!(
        find(&workspace.repositories, "beta")
            .graph_ignore
            .is_empty()
    );
}

#[test]
fn takes_the_list_from_the_space_a_repository_stands_in() {
    if !git_available() {
        eprintln!("skipping: git is not on PATH");
        return;
    }

    let temp = TempDir::new("graphignore-above");
    let root = temp.path();

    let alpha = root.join("alpha");
    std::fs::create_dir_all(&alpha).expect("create alpha");
    git(&alpha, &["init", "-b", "main"]);
    commit(&alpha, "one.txt", "1");

    // Written at the folder somebody put on the graph rather than in the
    // checkout, which is where one list for a whole tree of them goes.
    let space = root.join(".totex");
    std::fs::create_dir_all(&space).expect("create space");
    std::fs::write(space.join(".graphignore"), "origin/*\n").expect("write graphignore");

    let workspace = scan(root.to_string_lossy().into_owned(), None).expect("scan");
    assert_eq!(
        find(&workspace.repositories, "alpha").graph_ignore,
        vec!["origin/*".to_string()]
    );
}

#[test]
fn lays_repositories_out_in_one_alphabet_whatever_the_case() {
    if !git_available() {
        eprintln!("skipping: git is not on PATH");
        return;
    }

    let temp = TempDir::new("scan-order");
    let root = temp.path();
    for name in ["Zed", "abc", "notes", "Blender"] {
        let repository = root.join(name);
        std::fs::create_dir_all(&repository).expect("create repository");
        git(&repository, &["init", "-b", "main"]);
        commit(&repository, "readme.md", name);
    }

    let workspace = scan(root.to_string_lossy().into_owned(), None).expect("scan");
    let names: Vec<&str> = workspace
        .repositories
        .iter()
        .map(|repository| repository.name.as_str())
        .collect();
    assert_eq!(
        names,
        ["abc", "Blender", "notes", "Zed"],
        "a capital does not put a repository ahead of the alphabet"
    );
}
