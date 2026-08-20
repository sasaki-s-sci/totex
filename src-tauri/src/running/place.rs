//! Where a directory is, in the terms the graph is drawn in.
//!
//! An agent knows a working directory and nothing else; the canvas is drawn in
//! repositories, worktrees and branches. This turns the one into the other by
//! reading what git already wrote down — `.git`, `HEAD`, `commondir` — rather
//! than by running git.
//!
//! Not running git is the point. This is asked again for every agent on every
//! sweep of the machine, several times a minute, and a process per agent per
//! sweep is a cost the window would feel. Two small reads is not.

use std::path::{Component, Path, PathBuf};

/// A directory, placed: the repository it belongs to and what is checked out.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Place {
    /// The repository itself — the main checkout, not a linked worktree of it.
    pub repo: PathBuf,
    /// The checkout the directory is actually inside, which is what the agent
    /// is editing. The same as `repo` unless it is a linked worktree.
    pub worktree: PathBuf,
    /// The branch checked out there, or `None` on a detached head.
    pub branch: Option<String>,
    /// The commit the head is on, for the detached case.
    pub head: Option<String>,
}

/// Places `cwd`, or answers `None` when it is not in a repository at all.
///
/// An agent is perfectly entitled to be run somewhere that is not a checkout —
/// a scratch directory, a home folder — and that is drawn as a plain directory
/// rather than dropped.
pub fn locate(cwd: &Path) -> Option<Place> {
    for dir in cwd.ancestors() {
        let dot = dir.join(".git");
        let git_dir = if dot.is_dir() {
            dot
        } else if dot.is_file() {
            // A linked worktree keeps a line of text where its `.git` would be,
            // pointing at the directory the repository keeps for it.
            let pointer = std::fs::read_to_string(&dot).ok()?;
            let target = pointer.trim().strip_prefix("gitdir:")?.trim();
            absolute(dir, target)
        } else {
            continue;
        };

        let (branch, head) = read_head(&git_dir);
        return Some(Place {
            repo: repo_of(&git_dir),
            worktree: dir.to_path_buf(),
            branch,
            head,
        });
    }
    None
}

/// The repository a git directory belongs to.
///
/// A linked worktree's git directory carries a `commondir` pointing back at the
/// repository's own, which is how a worktree and the checkout it was made from
/// are drawn as one repository rather than as two.
fn repo_of(git_dir: &Path) -> PathBuf {
    let common = match std::fs::read_to_string(git_dir.join("commondir")) {
        Ok(pointer) => absolute(git_dir, pointer.trim()),
        Err(_) => git_dir.to_path_buf(),
    };
    // `/repo/.git` is the repository at `/repo`. A bare one has no directory
    // above it to name it by, so it is the repository itself.
    match common.file_name().and_then(|name| name.to_str()) {
        Some(".git") => common.parent().unwrap_or(&common).to_path_buf(),
        _ => common,
    }
}

/// The branch and the commit written in a git directory's `HEAD`.
fn read_head(git_dir: &Path) -> (Option<String>, Option<String>) {
    match std::fs::read_to_string(git_dir.join("HEAD")) {
        Ok(content) => parse_head(&content),
        Err(_) => (None, None),
    }
}

/// `HEAD` is either a symbolic ref to a branch, or a commit on its own.
pub fn parse_head(content: &str) -> (Option<String>, Option<String>) {
    let line = content.trim();
    if let Some(reference) = line.strip_prefix("ref:") {
        let reference = reference.trim();
        let branch = reference.strip_prefix("refs/heads/").unwrap_or(reference);
        return (Some(branch.to_string()), None);
    }
    if line.len() >= 7 && line.chars().all(|c| c.is_ascii_hexdigit()) {
        return (None, Some(line.to_string()));
    }
    (None, None)
}

/// `value` as an absolute path, read the way git writes them: relative to the
/// directory the file naming it lives in, and with the `..` steps taken.
///
/// Taken rather than followed: `commondir` is `../..` from a worktree's git
/// directory nine times out of ten, and a path that still says `..` in the
/// middle will not compare equal to the same directory named plainly, which is
/// what the window matches these against.
fn absolute(base: &Path, value: &str) -> PathBuf {
    let joined = if Path::new(value).is_absolute() {
        PathBuf::from(value)
    } else {
        base.join(value)
    };
    normalise(&joined)
}

/// The same path with `.` and `..` resolved, without touching the disk.
fn normalise(path: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for part in path.components() {
        match part {
            Component::ParentDir => {
                // Nothing to climb above a root, and a leading `..` in a
                // relative path has to stay put to still mean anything.
                if !out.pop() {
                    out.push("..");
                }
            }
            Component::CurDir => {}
            other => out.push(other.as_os_str()),
        }
    }
    out
}
