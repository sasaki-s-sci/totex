//! Finding the repositories under a folder.
//!
//! The walk is breadth-first and asks a whole level at once rather than a
//! directory at a time. That shape is not for tidiness: a folder inside a WSL
//! distribution is walked by asking the distribution, and a question per
//! directory would be a round trip per directory — thousands of them, for a
//! folder somebody expects to open. One question per level is a dozen.

mod shape;

#[cfg(test)]
mod tests;

use std::path::{Path, PathBuf};

use crate::host::{Child, Host};

use shape::{DIRECTORY_BUDGET, descendable, is_checkout, is_repository};

pub use shape::levels;

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
