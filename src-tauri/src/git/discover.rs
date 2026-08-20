use std::collections::VecDeque;
use std::path::{Path, PathBuf};

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

/// The child directories of `dir` a walk is allowed to descend into.
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
///
/// A directory that will not open is handed back as the error rather than as an
/// empty list, because the scan reports those and the other two walks do not.
pub fn child_directories(dir: &Path) -> Result<Vec<PathBuf>, std::io::Error> {
    let entries = std::fs::read_dir(dir)?;

    let mut found = Vec::new();
    for entry in entries.flatten() {
        let name = entry.file_name();
        let Some(name) = name.to_str() else {
            continue;
        };
        if name == ".git" || is_skipped(name) {
            continue;
        }
        if matches!(entry.file_type(), Ok(file_type) if file_type.is_dir()) {
            found.push(entry.path());
        }
    }
    Ok(found)
}

/// Whether `dir` is itself a repository — a worktree or a bare one.
fn is_repository(dir: &Path) -> bool {
    dir.join(".git").exists() || is_bare(dir)
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
    let mut candidates = Vec::new();
    let mut warnings = Vec::new();
    let mut queue = VecDeque::from([(root.to_path_buf(), 0usize)]);
    let mut visited = 0usize;

    while let Some((dir, depth)) = queue.pop_front() {
        visited += 1;
        if visited > DIRECTORY_BUDGET {
            warnings.push("directory-budget".to_string());
            break;
        }

        if is_repository(&dir) {
            candidates.push(dir.clone());
        }

        if depth >= max_depth {
            continue;
        }

        match child_directories(&dir) {
            Ok(children) => {
                for child in children {
                    queue.push_back((child, depth + 1));
                }
            }
            // Reported rather than passed over in silence, which is the one
            // thing this walk does that the others do not.
            Err(error) => warnings.push(error.to_string()),
        }
    }

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
/// * only a checkout of its own counts: a `.git` directory, or a bare
///   repository. A `.git` file is a link into somebody else's git directory —
///   a linked worktree, which this very window makes one of per branch — and
///   counting those would say a repository and its worktrees were four
///   repositories.
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
    let mut queue = VecDeque::from([(root.to_path_buf(), 0usize)]);
    let mut visited = 0usize;
    let mut found = 0usize;

    while let Some((dir, depth)) = queue.pop_front() {
        visited += 1;
        if visited > budget {
            break;
        }

        if is_checkout(&dir) {
            found += 1;
            continue;
        }

        if depth >= max_depth {
            continue;
        }

        for child in child_directories(&dir).unwrap_or_default() {
            queue.push_back((child, depth + 1));
        }
    }

    found
}

/// Whether `dir` is a repository in its own right, as against a link into one.
fn is_checkout(dir: &Path) -> bool {
    dir.join(".git").is_dir() || is_bare(dir)
}

fn is_bare(dir: &Path) -> bool {
    dir.join("HEAD").is_file() && dir.join("objects").is_dir() && dir.join("refs").is_dir()
}
