//! The worktree an operation runs in: the branch's own where it has one, and a
//! scratch one borrowed and given back where it does not.

use std::path::PathBuf;

use super::super::probe::in_branch_worktree;
use super::{repository, side_worktree};
use crate::git::cmd;
use crate::git::tests::TempDir;
use crate::host::Host;

#[test]
fn an_operation_runs_in_the_branchs_own_worktree_when_it_has_one() {
    let temp = TempDir::new("reuse");
    let repo = repository(&temp, &["one.txt"]);
    let side = side_worktree(&temp, &repo, "topic");

    let used = in_branch_worktree(&repo, "topic", "probe", |dir| Ok(dir.to_path_buf()))
        .expect("run in the worktree");
    assert_eq!(used.canonicalize().ok(), side.canonicalize().ok());
}

#[test]
fn an_operation_borrows_a_worktree_and_gives_it_back() {
    let temp = TempDir::new("scratch");
    let repo = repository(&temp, &["one.txt"]);
    crate::git::tests::git(&repo, &["branch", "topic"]);

    let borrowed = in_branch_worktree(&repo, "topic", "probe", |dir| Ok(dir.to_path_buf()))
        .expect("run in a scratch worktree");
    assert!(!borrowed.exists(), "the scratch worktree was left behind");

    // A failure is still cleaned up after, and the failure itself is what comes
    // back — not whatever the cleanup had to say.
    let failed: Result<PathBuf, String> = in_branch_worktree(&repo, "topic", "probe", |dir| {
        Err(dir.display().to_string())
    });
    let left = PathBuf::from(failed.expect_err("the action failed"));
    assert!(!left.exists(), "the scratch worktree outlived its failure");
}

/// Borrowing a worktree in a repository that is not on this machine: every path
/// crosses the boundary twice, and the worktree git lists comes back the other
/// way to be removed again. Skipped where there is no WSL to reach.
#[test]
fn an_operation_borrows_a_worktree_inside_a_distribution() {
    let Some(distro) = crate::wsl::distros().into_iter().next() else {
        return;
    };
    let host = Host::Wsl(distro);
    let repo = host.canonical("/tmp/totex-worktree-remote/project");
    if cmd::version(Some(&repo)).is_err() {
        return;
    }

    let identity = [
        ("GIT_AUTHOR_NAME", "totex"),
        ("GIT_AUTHOR_EMAIL", "totex@example.invalid"),
        ("GIT_COMMITTER_NAME", "totex"),
        ("GIT_COMMITTER_EMAIL", "totex@example.invalid"),
        ("GIT_CONFIG_GLOBAL", "/dev/null"),
        ("GIT_CONFIG_SYSTEM", "/dev/null"),
    ];
    host.exec(None, &[], &["rm", "-rf", "/tmp/totex-worktree-remote"])
        .expect("a shell");
    host.exec(
        None,
        &[],
        &["mkdir", "-p", "/tmp/totex-worktree-remote/project"],
    )
    .expect("a shell");
    for args in [
        &["git", "init", "-b", "main"][..],
        &["sh", "-c", "printf one > one.txt"],
        &["git", "add", "."],
        &["git", "commit", "-m", "one"],
        &["git", "branch", "topic"],
    ] {
        let output = host.exec(Some(&repo), &identity, args).expect("a shell");
        assert!(
            output.ok(),
            "{args:?}: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    let (borrowed, was_there) = in_branch_worktree(&repo, "topic", "probe", |dir| {
        Ok((dir.to_path_buf(), Host::of(dir).is_dir(dir)))
    })
    .expect("run in a scratch worktree");

    assert!(
        borrowed.to_string_lossy().starts_with(r"\\wsl.localhost\"),
        "the scratch worktree was named in git's own spelling: {borrowed:?}"
    );
    assert!(was_there, "the scratch worktree was never checked out");
    assert!(!host.is_dir(&borrowed), "the scratch worktree was left");

    // The branch's own worktree is found and reused, spelled the way the window
    // spells it — this is what the menus hand back as a directory.
    let side = host.canonical("/tmp/totex-worktree-remote/side");
    let output = host
        .exec(
            Some(&repo),
            &identity,
            &[
                "git",
                "worktree",
                "add",
                "--quiet",
                &host.native(&side),
                "topic",
            ],
        )
        .expect("a shell");
    assert!(output.ok(), "{}", String::from_utf8_lossy(&output.stderr));

    let used = in_branch_worktree(&repo, "topic", "probe", |dir| Ok(dir.to_path_buf()))
        .expect("run in the worktree");
    assert_eq!(used, side);
}
