//! Repositories that are not on this machine, and refs fetched from elsewhere.

use std::path::Path;

use super::super::cmd;
use super::{TempDir, commit, git, scan};

/// The whole scan over a repository that is not on this machine at all: a
/// checkout inside a WSL distribution, addressed by the share — the path the
/// window has for it, and the one every id and every menu will carry.
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
    let status = super::super::workspace::status::read_status(&project).expect("a status");
    assert_eq!((status.added, status.deleted, status.modified), (0, 0, 1));
}

/// A fetch, end to end, against a remote that is another directory.
///
/// The point of the test is the ref: `git fetch <remote> <branch>` names one
/// branch, and what the graph draws is the remote-tracking ref that call
/// updates on its way past. Nothing here needs a server — a bare repository on
/// a path is a remote like any other, and it is the only kind a test can have.
#[test]
fn fetch_brings_one_branch_down() {
    let temp = TempDir::new("fetch");
    let root = temp.path();

    let bare = root.join("origin.git");
    git(root, &["init", "--bare", "-b", "main", "origin.git"]);

    let here = root.join("here");
    std::fs::create_dir_all(&here).expect("create here");
    git(&here, &["init", "-b", "main"]);
    commit(&here, "one.txt", "1");
    let bare_path = bare.to_str().expect("utf-8");
    git(&here, &["remote", "add", "origin", bare_path]);
    git(&here, &["push", "-u", "origin", "main"]);

    // Somebody else moves the branch on, which is the whole situation a fetch
    // is for: this checkout cannot know about it until it asks.
    let there = root.join("there");
    git(root, &["clone", bare_path, "there"]);
    commit(&there, "two.txt", "2");
    git(&there, &["push", "origin", "main"]);
    let moved = git(&there, &["rev-parse", "HEAD"]).trim().to_string();

    let tracking = |dir: &Path| {
        git(dir, &["rev-parse", "refs/remotes/origin/main"])
            .trim()
            .to_string()
    };
    assert_ne!(
        tracking(&here),
        moved,
        "the remote moved and nothing has asked about it yet"
    );

    super::super::remote::fetch_at(&here, "origin", "main").expect("fetch");

    assert_eq!(
        tracking(&here),
        moved,
        "fetching one branch by name updates its remote-tracking ref"
    );
    assert_eq!(
        git(&here, &["rev-parse", "refs/heads/main"]).trim(),
        git(&here, &["rev-parse", "HEAD"]).trim(),
        "a fetch writes refs and objects, and leaves the branch where it was"
    );

    // A remote this repository does not have is a URL git would go looking for,
    // so it is turned down before git is asked at all.
    assert_eq!(
        super::super::remote::fetch_at(&here, "elsewhere", "main"),
        Err("no-such-remote".to_string())
    );
    assert!(super::super::remote::fetch_at(&here, "origin", "bad..name").is_err());
}
