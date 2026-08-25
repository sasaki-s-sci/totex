//! What a directory is, and which of its children a walk may go into.

use std::path::{Path, PathBuf};

use crate::host::{Child, Host};

/// Upper bound on visited directories so a scan of a huge tree still returns.
pub(super) const DIRECTORY_BUDGET: usize = 60_000;

const SKIPPED: &[&str] = &[
    "node_modules",
    "target",
    "dist",
    "build",
    "out",
    "vendor",
    "venv",
    ".venv",
    ".next",
    ".nuxt",
    ".svelte-kit",
    ".turbo",
    ".cache",
    ".gradle",
    ".terraform",
    "__pycache__",
    "Pods",
    "DerivedData",
];

/// True for directories the walk refuses to descend into.
pub(super) fn is_skipped(name: &str) -> bool {
    SKIPPED.contains(&name)
}

/// The children of `dir` a walk is allowed to descend into.
///
/// The whole descent policy, in one place: `.git` and the noise directories are
/// skipped, and only real directories are returned — symlinks are dropped
/// outright, because following them can loop and a linked repository is
/// reported through its real path anyway.
///
/// Every walk over a tree goes through here. `discover` and `count_repositories`
/// must agree about what is under a folder or the mark on a folder counts what
/// the scan will never draw, and the watch must agree with both or it arms
/// directories the scan will never look at.
pub(super) fn descendable(host: &Host, dir: &Path, children: &[Child]) -> Vec<PathBuf> {
    children
        .iter()
        .filter(|child| child.stat.is_dir && !child.stat.is_symlink)
        .filter(|child| child.name != ".git" && !is_skipped(&child.name))
        .map(|child| host.join(dir, &child.name))
        .collect()
}

/// Every directory from `root` down to `depth`, `root` included.
///
/// Level by level, so a remote tree costs one question per level rather than
/// one per directory. What the watch arms to catch a repository appearing.
pub fn levels(host: &Host, root: &Path, depth: usize) -> Vec<PathBuf> {
    let mut found = vec![root.to_path_buf()];
    let mut frontier = vec![root.to_path_buf()];

    for _ in 0..depth {
        let (listing, _) = host.children(&frontier);
        let mut next = Vec::new();
        for dir in &frontier {
            if let Some(children) = listing.get(dir) {
                next.extend(descendable(host, dir, children));
            }
        }
        found.extend(next.iter().cloned());
        frontier = next;
    }

    found
}

/// Whether a directory holding these children is a repository — a worktree or a
/// bare one.
///
/// Read off the listing the walk already has rather than asked for: a `.git`
/// entry is a `.git` entry whether it is the directory of a checkout or the
/// line of text a linked worktree keeps in its place.
pub(super) fn is_repository(children: &[Child]) -> bool {
    children.iter().any(|child| child.name == ".git") || is_bare(children)
}

/// A repository in its own right, as against a link into one.
///
/// A `.git` file is a link into somebody else's git directory — a linked
/// worktree, which this very window makes one of per branch — so only a `.git`
/// directory counts here.
pub(super) fn is_checkout(children: &[Child]) -> bool {
    children
        .iter()
        .any(|child| child.name == ".git" && child.stat.is_dir)
        || is_bare(children)
}

pub(super) fn is_bare(children: &[Child]) -> bool {
    let has = |name: &str, folder: bool| {
        children
            .iter()
            .any(|child| child.name == name && child.stat.is_dir == folder)
    };
    has("HEAD", false) && has("objects", true) && has("refs", true)
}
