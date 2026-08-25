//! End-to-end coverage over a real repository built by `git` itself, because
//! every layer here is a wrapper around git's own output.

mod folder;
mod history;
mod refresh;
mod remote;
mod scan;
mod watch;

use std::path::{Path, PathBuf};
use std::process::Command;

use super::cmd;
use super::model::{Repository, Workspace};
use super::session::Session;

/// The whole scan, as the window sees it on the first frame.
pub(super) fn scan(root: String, commit_limit: Option<usize>) -> Result<Workspace, String> {
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

pub(super) fn find<'a>(repositories: &'a [Repository], name: &str) -> &'a Repository {
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
pub(super) fn git_available() -> bool {
    cmd::version(None).is_ok()
}

/// Two repositories side by side, so a refresh has something it must leave
/// alone as well as something it must re-read.
pub(super) fn two_repositories(root: &Path) {
    let alpha = root.join("alpha");
    std::fs::create_dir_all(&alpha).expect("create alpha");
    git(&alpha, &["init", "-b", "main"]);
    commit(&alpha, "one.txt", "1");

    let beta = root.join("beta");
    std::fs::create_dir_all(&beta).expect("create beta");
    git(&beta, &["init", "-b", "main"]);
    commit(&beta, "one.txt", "1");
}
