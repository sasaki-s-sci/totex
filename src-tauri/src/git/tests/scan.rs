//! The first frame: branches, worktrees and nested repositories, read whole.

use super::super::model::BranchKind;
use super::{TempDir, commit, find, git, git_available, scan};

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

#[test]
fn rejects_a_root_that_is_not_a_directory() {
    let error = scan("/definitely/not/here".into(), None).expect_err("must fail");
    assert_eq!(error, "not-a-directory");
}
