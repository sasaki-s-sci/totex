//! End-to-end coverage over a real repository built by `git` itself, because
//! every layer here is a wrapper around git's own output.

use std::path::{Path, PathBuf};
use std::process::Command;

use super::cmd;
use super::inspect::{classify, parse_track};
use super::model::{BranchKind, Remote, Repository, Workspace};
use super::session::Session;

/// The whole scan, as the window sees it on the first frame.
fn scan(root: String, commit_limit: Option<usize>) -> Result<Workspace, String> {
    Session::open(&root, commit_limit).map(|session| session.workspace())
}

/// A temporary directory that removes itself, so a failing test cannot leave a
/// repository behind.
pub(super) struct TempDir(PathBuf);

impl TempDir {
    pub(super) fn new(tag: &str) -> Self {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|elapsed| elapsed.as_nanos())
            .unwrap_or_default();
        let path =
            std::env::temp_dir().join(format!("totex-{tag}-{}-{unique}", std::process::id()));
        std::fs::create_dir_all(&path).expect("create temp dir");
        Self(path)
    }

    pub(super) fn path(&self) -> &Path {
        &self.0
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

/// Runs git in the fixture, isolated from whatever git config the machine has.
pub(super) fn git(dir: &Path, args: &[&str]) -> String {
    let output = Command::new("git")
        .arg("-C")
        .arg(dir)
        .args(args)
        .env("GIT_AUTHOR_NAME", "totex")
        .env("GIT_AUTHOR_EMAIL", "totex@example.invalid")
        .env("GIT_COMMITTER_NAME", "totex")
        .env("GIT_COMMITTER_EMAIL", "totex@example.invalid")
        .env("GIT_CONFIG_GLOBAL", "/dev/null")
        .env("GIT_CONFIG_SYSTEM", "/dev/null")
        .output()
        .expect("run git");
    assert!(
        output.status.success(),
        "git {args:?} failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8_lossy(&output.stdout).into_owned()
}

pub(super) fn commit(dir: &Path, name: &str, contents: &str) {
    std::fs::write(dir.join(name), contents).expect("write file");
    git(dir, &["add", "."]);
    git(dir, &["commit", "-m", &format!("add {name}")]);
}

fn find<'a>(repositories: &'a [Repository], name: &str) -> &'a Repository {
    repositories
        .iter()
        .find(|repository| repository.name == name)
        .unwrap_or_else(|| {
            panic!(
                "no repository named {name} in {:?}",
                repositories.iter().map(|r| &r.name).collect::<Vec<_>>()
            )
        })
}

/// Skips the git-backed tests when git is unavailable rather than failing.
fn git_available() -> bool {
    cmd::version(None).is_ok()
}

/// The whole scan, over a repository that is not on this machine at all: a
/// checkout inside a WSL distribution, addressed by the share — which is the
/// path the window has for it, and the one every id and every menu will carry.
///
/// Skipped where there is no WSL to reach, which is every machine the CI
/// builds on.
#[test]
fn scans_a_repository_inside_a_distribution() {
    let Some(distro) = crate::wsl::distros().into_iter().next() else {
        return;
    };
    let host = crate::host::Host::Wsl(distro);
    let root = host.canonical("/tmp/totex-git-remote");
    if cmd::version(Some(&root)).is_err() {
        return;
    }

    host.exec(None, &[], &["rm", "-rf", "/tmp/totex-git-remote"])
        .expect("a shell");
    host.exec(None, &[], &["mkdir", "-p", "/tmp/totex-git-remote/project"])
        .expect("a shell");

    let project = host.join(&root, "project");
    let identity = [
        ("GIT_AUTHOR_NAME", "totex"),
        ("GIT_AUTHOR_EMAIL", "totex@example.invalid"),
        ("GIT_COMMITTER_NAME", "totex"),
        ("GIT_COMMITTER_EMAIL", "totex@example.invalid"),
        ("GIT_CONFIG_GLOBAL", "/dev/null"),
        ("GIT_CONFIG_SYSTEM", "/dev/null"),
    ];
    let inside = |args: &[&str]| {
        let output = host.exec(Some(&project), &identity, args).expect("a shell");
        assert!(
            output.ok(),
            "{args:?}: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    };
    inside(&["git", "init", "-b", "main"]);
    inside(&["sh", "-c", "printf one > one.txt"]);
    inside(&["git", "add", "."]);
    inside(&["git", "commit", "-m", "one"]);
    inside(&["git", "branch", "topic"]);
    inside(&["sh", "-c", "printf two > two.txt"]);
    inside(&["git", "add", "."]);
    inside(&["git", "commit", "-m", "two"]);

    let workspace = scan(root.to_string_lossy().into_owned(), None).expect("a scan");
    assert_eq!(workspace.warnings, Vec::<String>::new());
    assert_eq!(workspace.repositories.len(), 1);

    let repository = &workspace.repositories[0];
    assert_eq!(repository.name, "project");
    assert_eq!(repository.head.as_deref(), Some("refs/heads/main"));
    assert_eq!(repository.commits.len(), 2);
    assert_eq!(repository.branches.len(), 2, "main and topic");

    // Everything git printed comes back spelled the way the window spells it,
    // because these are what the canvas keys on and what its menus hand back.
    for named in [repository.path.as_str(), repository.git_dir.as_str()] {
        assert!(
            named.starts_with(r"\\wsl.localhost\"),
            "git's own spelling leaked out: {named}"
        );
    }
    let main = repository
        .worktrees
        .iter()
        .find(|worktree| worktree.is_main)
        .expect("the checkout itself");
    assert!(main.exists, "the worktree it is standing in");
    assert_eq!(main.path, repository.path);

    // The status the graph draws a rim from is read by that distribution's git.
    inside(&["sh", "-c", "printf changed > one.txt"]);
    let status = super::workspace::read_status(&project).expect("a status");
    assert_eq!((status.added, status.deleted, status.modified), (0, 0, 1));
}

#[test]
fn parses_upstream_tracking() {
    assert_eq!(parse_track(""), (0, 0, false));
    assert_eq!(parse_track("[ahead 3]"), (3, 0, false));
    assert_eq!(parse_track("[behind 2]"), (0, 2, false));
    assert_eq!(parse_track("[ahead 3, behind 2]"), (3, 2, false));
    assert_eq!(parse_track("[gone]"), (0, 0, true));
}

#[test]
fn classifies_refs_against_configured_remotes() {
    let remotes = vec![
        Remote {
            name: "origin".into(),
            url: "https://example.invalid/a.git".into(),
        },
        // A remote whose name contains a slash must win over the naive split.
        Remote {
            name: "team/fork".into(),
            url: "https://example.invalid/b.git".into(),
        },
    ];

    let (kind, remote, name) = classify("refs/heads/feature/x", &remotes);
    assert_eq!(kind, BranchKind::Local);
    assert_eq!(remote, None);
    assert_eq!(name, "feature/x");

    let (kind, remote, name) = classify("refs/remotes/origin/main", &remotes);
    assert_eq!(kind, BranchKind::Remote);
    assert_eq!(remote.as_deref(), Some("origin"));
    assert_eq!(name, "origin/main");

    let (kind, remote, name) = classify("refs/remotes/team/fork/main", &remotes);
    assert_eq!(kind, BranchKind::Remote);
    assert_eq!(remote.as_deref(), Some("team/fork"));
    assert_eq!(name, "team/fork/main");
}

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

#[test]
fn history_stops_at_the_commit_limit() {
    if !git_available() {
        eprintln!("skipping: git is not on PATH");
        return;
    }

    let temp = TempDir::new("limit");
    let root = temp.path();
    let repo = root.join("delta");
    std::fs::create_dir_all(&repo).expect("create delta");
    git(&repo, &["init", "-b", "main"]);
    for index in 0..5 {
        commit(&repo, &format!("f{index}.txt"), "x");
    }

    let workspace = scan(root.to_string_lossy().into_owned(), Some(3)).expect("scan");
    let delta = find(&workspace.repositories, "delta");
    assert_eq!(delta.commits.len(), 3, "the newest three commits only");
    assert!(delta.history_truncated);
    // Newest first, so the head commit leads.
    assert_eq!(delta.commits[0].subject, "add f4.txt");
}

/// Two repositories side by side, so a refresh has something it must leave
/// alone as well as something it must re-read.
fn two_repositories(root: &Path) {
    let alpha = root.join("alpha");
    std::fs::create_dir_all(&alpha).expect("create alpha");
    git(&alpha, &["init", "-b", "main"]);
    commit(&alpha, "one.txt", "1");

    let beta = root.join("beta");
    std::fs::create_dir_all(&beta).expect("create beta");
    git(&beta, &["init", "-b", "main"]);
    commit(&beta, "one.txt", "1");
}

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
    let _watcher = super::watch::start(
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
        super::watch::relevant_paths(paths.iter()),
        vec![
            PathBuf::from("/repo/.git/refs/heads/main"),
            PathBuf::from("/repo/.git/HEAD"),
        ]
    );
}

#[test]
fn the_watcher_skips_git_lock_files() {
    assert!(!super::watch::is_relevant(Path::new(
        "/repo/.git/index.lock"
    )));
    assert!(super::watch::is_relevant(Path::new(
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

    let targets = super::watch::watch_targets(
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
        super::discover::count_repositories(&root.join(dir), super::SCAN_DEPTH, super::HOLD_BUDGET)
    };

    assert_eq!(held("repo"), 1, "a repository is one");
    assert_eq!(
        held("deep"),
        1,
        "a folder with one buried under it holds one"
    );
    assert_eq!(held("plain"), 0, "a folder of empty folders holds none");
    assert_eq!(
        super::discover::count_repositories(root, super::SCAN_DEPTH, super::HOLD_BUDGET),
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
        super::discover::count_repositories(root, super::SCAN_DEPTH, super::HOLD_BUDGET),
        3,
        "a worktree of one of them is not a fourth repository"
    );

    // Running out of budget answers with what was found rather than failing:
    // nothing turns on the number, and a folder can be put on the graph either
    // way.
    assert_eq!(
        super::discover::count_repositories(&root.join("plain"), super::SCAN_DEPTH, 1),
        0,
        "a walk that gave up says what it saw"
    );
}
