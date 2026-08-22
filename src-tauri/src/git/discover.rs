//! Finding the repositories under a folder.
//!
//! The walk is breadth-first and asks a whole level at once rather than a
//! directory at a time. That shape is not for tidiness: a folder inside a WSL
//! distribution is walked by asking the distribution, and a question per
//! directory would be a round trip per directory — thousands of them, for a
//! folder somebody expects to open. One question per level is a dozen.

use std::path::{Path, PathBuf};

use crate::host::{Child, Host};

/// Directories that never contain a repository worth graphing but are large
/// enough to dominate the walk if we descend into them.
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

/// Upper bound on visited directories so a scan of a huge tree still returns.
const DIRECTORY_BUDGET: usize = 60_000;

/// True for directories the walk refuses to descend into.
pub fn is_skipped(name: &str) -> bool {
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
fn descendable(host: &Host, dir: &Path, children: &[Child]) -> Vec<PathBuf> {
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
fn is_repository(children: &[Child]) -> bool {
    children.iter().any(|child| child.name == ".git") || is_bare(children)
}

/// A repository in its own right, as against a link into one.
///
/// A `.git` file is a link into somebody else's git directory — a linked
/// worktree, which this very window makes one of per branch — so only a `.git`
/// directory counts here.
fn is_checkout(children: &[Child]) -> bool {
    children
        .iter()
        .any(|child| child.name == ".git" && child.stat.is_dir)
        || is_bare(children)
}

fn is_bare(children: &[Child]) -> bool {
    let has = |name: &str, folder: bool| {
        children
            .iter()
            .any(|child| child.name == name && child.stat.is_dir == folder)
    };
    has("HEAD", false) && has("objects", true) && has("refs", true)
}

pub struct Discovery {
    pub candidates: Vec<PathBuf>,
    pub warnings: Vec<String>,
}

/// Breadth-first walk of `root` collecting every directory that looks like a
/// git repository, either a worktree (it has a `.git` entry) or a bare
/// repository. Repositories are not pruned from the walk, so nested
/// repositories and submodules are found too.
pub fn discover(root: &Path, max_depth: usize) -> Discovery {
    let host = Host::of(root);
    let mut candidates = Vec::new();
    let mut warnings = Vec::new();

    walk(
        &host,
        root,
        max_depth,
        DIRECTORY_BUDGET,
        &mut warnings,
        |dir, children| {
            if is_repository(children) {
                candidates.push(dir.to_path_buf());
            }
            // Nothing is pruned: a repository inside a repository is one.
            Descend::Yes
        },
    );

    Discovery {
        candidates,
        warnings,
    }
}

/// How many repositories `root` holds: itself, or anywhere under it.
///
/// What the folder column puts on its mark. The same walk as `discover`, with
/// two differences that make it a number somebody can read rather than a count
/// of candidates:
///
/// * a checkout is not descended into. What is inside a repository belongs to
///   that repository — submodules included — and a folder of five projects
///   should say five however they are built.
/// * only a checkout of its own counts, so a repository and the worktrees this
///   window made for its branches are one repository and not four.
///
/// So this can differ from the number of bands the graph draws, by a submodule
/// or by a repository checked out inside another. It is the number of projects
/// in the folder, which is the question being asked of it.
///
/// `budget` is directories visited, not depth: a walk that runs out of it
/// answers with what it found. Nothing turns on the number — every folder can
/// be put on the graph either way — so a low answer costs nothing but a mark
/// that says less than it could.
pub fn count_repositories(root: &Path, max_depth: usize, budget: usize) -> usize {
    let host = Host::of(root);
    let mut found = 0usize;
    let mut warnings = Vec::new();

    walk(
        &host,
        root,
        max_depth,
        budget,
        &mut warnings,
        |_, children| {
            if is_checkout(children) {
                found += 1;
                return Descend::No;
            }
            Descend::Yes
        },
    );

    found
}

enum Descend {
    Yes,
    No,
}

/// The walk both of the above are: one question per level, `visit` called for
/// every directory that answered, and a budget on how many that may be.
///
/// The budget is directories visited rather than depth, and it is spent in
/// level order — so a walk that runs out of it has looked at everything near
/// the root, which is where the answer usually is.
fn walk(
    host: &Host,
    root: &Path,
    max_depth: usize,
    budget: usize,
    warnings: &mut Vec<String>,
    mut visit: impl FnMut(&Path, &[Child]) -> Descend,
) {
    let mut frontier = vec![root.to_path_buf()];
    let mut visited = 0usize;

    for depth in 0..=max_depth {
        if frontier.is_empty() {
            return;
        }
        let (listing, said) = host.children(&frontier);
        warnings.extend(said);

        let mut next = Vec::new();
        for dir in &frontier {
            visited += 1;
            if visited > budget {
                warnings.push("directory-budget".to_string());
                return;
            }
            // Absent rather than empty: the directory would not open, which
            // `host` has already said whatever there was to say about.
            let Some(children) = listing.get(dir) else {
                continue;
            };
            let descend = visit(dir, children);
            if depth < max_depth && matches!(descend, Descend::Yes) {
                next.extend(descendable(host, dir, children));
            }
        }
        frontier = next;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("totex-walk-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("temp dir");
        dir
    }

    fn checkout(at: &Path) {
        std::fs::create_dir_all(at.join(".git")).expect("a checkout");
    }

    /// What was found, named relative to the root, in one spelling.
    ///
    /// On the string rather than through `Path::strip_prefix`, because half of
    /// these paths are a distribution's — and a Linux build reads one of those
    /// as a single component with no prefix to strip.
    fn under(root: &Path, found: &[PathBuf]) -> Vec<String> {
        let root = format!("{}", root.to_string_lossy());
        let mut named: Vec<String> = found
            .iter()
            .map(|path| {
                path.to_string_lossy()
                    .strip_prefix(&root)
                    .unwrap_or_default()
                    .trim_start_matches(['/', '\\'])
                    .replace('\\', "/")
            })
            .collect();
        named.sort();
        named
    }

    #[test]
    fn finds_a_repository_at_every_depth_it_is_allowed() {
        let dir = temp_dir("depth");
        checkout(&dir.join("one"));
        checkout(&dir.join("nested/two"));
        std::fs::create_dir_all(dir.join("node_modules/three/.git")).expect("noise");

        let found = discover(&dir, 12);
        assert_eq!(
            under(&dir, &found.candidates),
            ["nested/two", "one"],
            "and never into node_modules"
        );

        assert_eq!(discover(&dir, 1).candidates.len(), 1, "one level only");
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn counts_projects_rather_than_checkouts_of_them() {
        let dir = temp_dir("count");
        checkout(&dir.join("one"));
        // A linked worktree keeps a line of text where its `.git` would be.
        std::fs::create_dir_all(dir.join("one-topic")).expect("a worktree");
        std::fs::write(
            dir.join("one-topic/.git"),
            "gitdir: ../one/.git/worktrees/topic",
        )
        .expect("a pointer");
        // A submodule belongs to the project holding it.
        checkout(&dir.join("one/sub"));

        assert_eq!(count_repositories(&dir, 12, 1_000), 1);
        // The walk still offers all three to the scan, which resolves them.
        assert_eq!(discover(&dir, 12).candidates.len(), 3);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn a_bare_repository_is_one_too() {
        let dir = temp_dir("bare");
        let bare = dir.join("thing.git");
        std::fs::create_dir_all(bare.join("objects")).expect("a bare repo");
        std::fs::create_dir_all(bare.join("refs")).expect("a bare repo");
        std::fs::write(bare.join("HEAD"), "ref: refs/heads/main\n").expect("a head");

        assert_eq!(discover(&dir, 12).candidates, vec![bare.clone()]);
        assert_eq!(count_repositories(&dir, 12, 1_000), 1);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn a_walk_that_runs_out_of_budget_says_so() {
        let dir = temp_dir("budget");
        for index in 0..8 {
            std::fs::create_dir_all(dir.join(format!("folder-{index}"))).expect("a folder");
        }
        let mut warnings = Vec::new();
        walk(&Host::Local, &dir, 12, 3, &mut warnings, |_, _| {
            Descend::Yes
        });
        assert_eq!(warnings, vec!["directory-budget".to_string()]);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    /// The same walk, over a folder inside a distribution. Skipped where there
    /// is no WSL to reach, which is every machine the CI builds on.
    #[test]
    fn walks_a_folder_inside_a_distribution() {
        let Some(distro) = crate::wsl::distros().into_iter().next() else {
            return;
        };
        let host = Host::Wsl(distro);
        let root = host.canonical("/tmp/totex-walk-remote");
        host.exec(None, &[], &["rm", "-rf", "/tmp/totex-walk-remote"])
            .expect("a shell");
        host.exec(
            None,
            &[],
            &[
                "mkdir",
                "-p",
                "/tmp/totex-walk-remote/one/.git",
                "/tmp/totex-walk-remote/deep/two/.git",
                "/tmp/totex-walk-remote/node_modules/three/.git",
            ],
        )
        .expect("a shell");

        let found = discover(&root, 12);
        assert_eq!(under(&root, &found.candidates), ["deep/two", "one"]);
        assert_eq!(count_repositories(&root, 12, 1_000), 2);
        assert_eq!(
            levels(&host, &root, 1).len(),
            3,
            "the root and the two folders under it that are not noise"
        );
    }
}
