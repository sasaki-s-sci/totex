//! One repository, read out of git's own answers about it.

mod commits;
mod ignore;
pub(crate) mod refs;
mod worktree;

use std::path::{Path, PathBuf};

use commits::read_commits;
use ignore::graph_ignore;
use refs::{read_branches, read_default_branch, read_head, read_remotes};
use worktree::{link_worktrees, read_worktrees};

use crate::host::Host;

use super::cmd;
use super::model::Repository;

/// Field separator for `for-each-ref`; NUL can never appear inside a ref name,
/// an author name or a commit subject.
const REF_FORMAT: &str = concat!(
    "%(objectname)%00",
    "%(refname)%00",
    "%(HEAD)%00",
    "%(symref)%00",
    "%(upstream)%00",
    "%(upstream:track)%00",
    "%(committerdate:iso-strict)%00",
    "%(authorname)%00",
    "%(contents:subject)",
);

/// Same NUL separation for `git log`, but pretty formats spell a raw byte
/// `%x00` rather than `%00`. `%P` is the space-separated parent list.
const COMMIT_FORMAT: &str = "%H%x00%P%x00%cI%x00%an%x00%s";

const DEFAULT_BRANCH_CANDIDATES: &[&str] = &["main", "master", "develop", "trunk"];

/// A repository resolved to its canonical location.
#[derive(Debug, Clone)]
pub struct Located {
    /// Shared by every linked worktree, so it identifies the repository.
    pub common_dir: PathBuf,
    /// Where git commands are run from: the main worktree, or the git
    /// directory itself for a bare repository.
    pub path: PathBuf,
    pub bare: bool,
}

/// Resolves a candidate directory found by the walk into the repository it
/// belongs to. A linked worktree resolves to the same `common_dir` as its main
/// worktree, which is how duplicates are collapsed.
pub fn locate(dir: &Path) -> Result<Located, String> {
    let bare = cmd::run(dir, &["rev-parse", "--is-bare-repository"])?
        .trim()
        .eq("true");
    // git answers in the terms of the machine it ran on, so a repository inside
    // a distribution says `/home/a/repo/.git`. Everything above compares that
    // against paths the folder tree produced, which spell the same directory as
    // the share — see `cmd::path_of`.
    let common_dir = cmd::path_of(
        dir,
        &cmd::run(
            dir,
            &["rev-parse", "--path-format=absolute", "--git-common-dir"],
        )?,
    );

    let path = if bare {
        common_dir.clone()
    } else {
        // The main worktree, not the linked one we happened to walk into.
        main_worktree(dir).unwrap_or_else(|| dir.to_path_buf())
    };

    Ok(Located {
        common_dir,
        path,
        bare,
    })
}

fn main_worktree(dir: &Path) -> Option<PathBuf> {
    let output = cmd::try_run(dir, &["worktree", "list", "--porcelain"])?;
    let first = output.lines().next()?;
    first
        .strip_prefix("worktree ")
        .map(|path| cmd::path_of(dir, path))
}

/// The id every layer agrees on: the common git directory, which is shared by
/// a repository's worktrees and survives a rescan.
pub fn id_of(located: &Located) -> String {
    located.common_dir.to_string_lossy().into_owned()
}

pub fn inspect(located: &Located, commit_limit: usize) -> Result<Repository, String> {
    let dir = located.path.as_path();
    let id = id_of(located);

    let remotes = read_remotes(dir);
    let mut branches = read_branches(dir, &id, &remotes)?;
    let worktrees = read_worktrees(dir, &id, &located.common_dir);

    link_worktrees(&mut branches, &worktrees);
    let (commits, history_truncated) = read_commits(dir, commit_limit, &worktrees);

    let (head, head_detached) = read_head(dir);
    let default_branch = read_default_branch(dir, &branches, &remotes);

    let name = Host::of(dir).name(&located.path);
    let name = if name.is_empty() { id.clone() } else { name };

    Ok(Repository {
        id,
        name,
        path: located.path.to_string_lossy().into_owned(),
        git_dir: located.common_dir.to_string_lossy().into_owned(),
        bare: located.bare,
        head,
        head_detached,
        default_branch,
        remotes,
        branches,
        worktrees,
        commits,
        history_truncated,
        graph_ignore: graph_ignore(dir),
    })
}
