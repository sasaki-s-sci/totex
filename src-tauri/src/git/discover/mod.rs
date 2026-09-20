//! Finding the repositories under a folder.
//!
//! The walk is breadth-first and asks a whole level at once rather than a
//! directory at a time. That shape is not for tidiness: a folder on a remote
//! machine — a WSL distribution, or one across the network — is walked by
//! asking that machine, and a question per directory would be a round trip per
//! directory — thousands of them, for a folder somebody expects to open. One
//! question per level is a dozen.

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

/// Every repository under `root`: itself, or anywhere under it.
///
/// What the repository pane lists. The same walk as `discover`, with two
/// differences that make it a list of projects rather than a list of
/// candidates:
///
/// * a checkout is not descended into. What is inside a repository belongs to
///   that repository — submodules included — and a folder of five projects
///   should list five however they are built.
/// * only a checkout of its own is listed, so a repository and the worktrees
///   this window made for its branches are one row and not four.
///
/// So this can differ from the bands the graph draws for the same folder, by
/// a submodule or by a repository checked out inside another. It is the list
/// of projects in the folder, which is the question being asked of it.
///
/// `found` is told about each repository as the walk reaches it, which is what
/// lets a pane fill in row by row while the rest of a slow tree is still being
/// read. `go_on` is asked before every directory, and a `false` ends the walk
/// where it is: the pane that asked has gone, and nothing is waiting on the
/// rest.
///
/// `budget` is directories visited, not depth: a walk that runs out of it
/// answers with what it found and says so through `truncated`. Nothing turns
/// on the list being complete — every folder can be put on the graph either
/// way — so a short answer costs nothing but a pane that says less than it
/// could.
pub fn list_repositories(
    root: &Path,
    max_depth: usize,
    budget: usize,
    mut found: impl FnMut(&Path),
    go_on: impl Fn() -> bool,
) -> Listed {
    let host = Host::of(root);
    let mut repositories = Vec::new();
    let mut warnings = Vec::new();

    let walked = walk(
        &host,
        root,
        max_depth,
        budget,
        &mut warnings,
        |dir, children| {
            if !go_on() {
                return Descend::Stop;
            }
            if is_checkout(children) {
                found(dir);
                repositories.push(dir.to_path_buf());
                return Descend::No;
            }
            Descend::Yes
        },
    );

    Listed {
        repositories,
        truncated: matches!(walked, Walked::OutOfBudget),
        stopped: matches!(walked, Walked::Stopped),
        warnings,
    }
}

/// Which of `roots` hold a repository: are one, or have one anywhere under
/// them. What a folder's row asks before it offers to list repositories.
///
/// The same descent as `list_repositories`, so a row offers the list exactly
/// where the list would have a row. All the roots are walked as one, a level
/// of every root per question, because a pane asks this of every folder it
/// draws and a walk per folder would be a round trip per folder per level. A
/// root is dropped from the walk the moment a repository turns up under it:
/// nothing past the first one changes the answer, so a checkout answers at its
/// own level and only a folder with no repository in it is read to the bottom.
///
/// A root the budget ran out on is said to hold one. It could not be ruled
/// out, and a list offered that comes back empty costs less than a list
/// withheld from a folder that has one.
///
/// Roots are taken to be on one host, the first one's: they are the rows of
/// one directory.
pub fn holding(roots: &[PathBuf], max_depth: usize, budget: usize) -> Vec<PathBuf> {
    let Some(first) = roots.first() else {
        return Vec::new();
    };
    let host = Host::of(first);
    let mut holds = vec![false; roots.len()];
    // Each directory with the root it was reached from.
    let mut frontier: Vec<(usize, PathBuf)> = roots.iter().cloned().enumerate().collect();
    let mut visited = 0usize;

    'levels: for depth in 0..=max_depth {
        if frontier.is_empty() {
            break;
        }
        let dirs: Vec<PathBuf> = frontier.iter().map(|(_, dir)| dir.clone()).collect();
        let (listing, _) = host.children(&dirs);

        let mut next = Vec::new();
        for (root, dir) in &frontier {
            if holds[*root] {
                continue;
            }
            visited += 1;
            if visited > budget {
                for (undecided, _) in frontier.iter().chain(&next) {
                    holds[*undecided] = true;
                }
                break 'levels;
            }
            let Some(children) = listing.get(dir) else {
                continue;
            };
            if is_checkout(children) {
                holds[*root] = true;
            } else if depth < max_depth {
                next.extend(
                    descendable(&host, dir, children)
                        .into_iter()
                        .map(|child| (*root, child)),
                );
            }
        }
        next.retain(|(root, _)| !holds[*root]);
        frontier = next;
    }

    roots
        .iter()
        .zip(holds)
        .filter(|(_, held)| *held)
        .map(|(root, _)| root.clone())
        .collect()
}

/// What `list_repositories` found, and why it may not be everything.
pub struct Listed {
    pub repositories: Vec<PathBuf>,
    /// The directory budget ran out before the walk did.
    pub truncated: bool,
    /// The walk was told to stop, so what is here is whatever came first.
    pub stopped: bool,
    pub warnings: Vec<String>,
}

enum Descend {
    Yes,
    No,
    /// Not this directory, and none of the others either: the caller has
    /// stopped wanting an answer.
    Stop,
}

/// How a walk ended.
enum Walked {
    /// Every directory it was allowed to look at, it did.
    Finished,
    /// `visit` asked it to stop.
    Stopped,
    /// The directory budget ran out first.
    OutOfBudget,
}

/// The walk both of the above are: one question per level, `visit` called for
/// every directory that answered, and a budget on how many that may be.
///
/// The budget is directories visited rather than depth, and it is spent in
/// level order — so a walk that runs out of it has looked at everything near
/// the root, which is where the answer usually is. Running out is reported
/// both ways: as a warning, which is what the window shows, and as how the
/// walk ended, which is what a caller decides by.
fn walk(
    host: &Host,
    root: &Path,
    max_depth: usize,
    budget: usize,
    warnings: &mut Vec<String>,
    mut visit: impl FnMut(&Path, &[Child]) -> Descend,
) -> Walked {
    let mut frontier = vec![root.to_path_buf()];
    let mut visited = 0usize;

    for depth in 0..=max_depth {
        if frontier.is_empty() {
            return Walked::Finished;
        }
        let (listing, said) = host.children(&frontier);
        warnings.extend(said);

        let mut next = Vec::new();
        for dir in &frontier {
            visited += 1;
            if visited > budget {
                warnings.push("directory-budget".to_string());
                return Walked::OutOfBudget;
            }
            // Absent rather than empty: the directory would not open, which
            // `host` has already said whatever there was to say about.
            let Some(children) = listing.get(dir) else {
                continue;
            };
            match visit(dir, children) {
                Descend::Yes if depth < max_depth => {
                    next.extend(descendable(host, dir, children));
                }
                Descend::Yes | Descend::No => {}
                Descend::Stop => return Walked::Stopped,
            }
        }
        frontier = next;
    }
    Walked::Finished
}
