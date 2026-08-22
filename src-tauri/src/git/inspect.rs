use std::collections::HashMap;
use std::path::{Path, PathBuf};

use crate::host::Host;

use super::cmd;
use super::model::{Branch, BranchKind, Commit, Remote, Repository, Worktree};

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
    })
}

/// Reads the history reachable from every branch, newest first.
///
/// Worktree heads are passed explicitly so a detached worktree still lands in
/// the graph instead of pointing at a commit nobody drew.
fn read_commits(dir: &Path, limit: usize, worktrees: &[Worktree]) -> (Vec<Commit>, bool) {
    let mut args: Vec<String> = vec![
        "log".into(),
        "--topo-order".into(),
        "--max-count".into(),
        limit.to_string(),
        format!("--format={COMMIT_FORMAT}"),
        "--branches".into(),
        "--remotes".into(),
    ];
    for worktree in worktrees {
        if let Some(head) = worktree.head.as_deref() {
            args.push(head.to_string());
        }
    }
    // Everything before this point is a revision, never a path.
    args.push("--".into());

    let borrowed: Vec<&str> = args.iter().map(String::as_str).collect();
    // A repository without commits yet makes `git log` fail; that is not an error.
    let Some(output) = cmd::try_run(dir, &borrowed) else {
        return (Vec::new(), false);
    };

    let mut commits = Vec::new();
    for line in output.lines() {
        if line.is_empty() {
            continue;
        }
        let fields: Vec<&str> = line.split('\0').collect();
        if fields.len() < 5 {
            continue;
        }
        let id = fields[0].to_string();
        commits.push(Commit {
            short_id: id.chars().take(7).collect(),
            id,
            parents: fields[1]
                .split_whitespace()
                .map(str::to_string)
                .collect::<Vec<_>>(),
            committed_at: fields[2].to_string(),
            author: fields[3].to_string(),
            subject: fields[4].to_string(),
        });
    }

    let truncated = commits.len() >= limit;
    (commits, truncated)
}

fn read_remotes(dir: &Path) -> Vec<Remote> {
    let Some(output) = cmd::try_run(dir, &["remote", "-v"]) else {
        return Vec::new();
    };

    let mut remotes: Vec<Remote> = Vec::new();
    for line in output.lines() {
        let mut parts = line.split_whitespace();
        let (Some(name), Some(url)) = (parts.next(), parts.next()) else {
            continue;
        };
        if remotes.iter().any(|remote| remote.name == name) {
            continue;
        }
        remotes.push(Remote {
            name: name.to_string(),
            url: url.to_string(),
        });
    }
    remotes
}

fn read_branches(dir: &Path, repo_id: &str, remotes: &[Remote]) -> Result<Vec<Branch>, String> {
    let output = cmd::run(
        dir,
        &[
            "for-each-ref",
            &format!("--format={REF_FORMAT}"),
            "refs/heads",
            "refs/remotes",
        ],
    )?;

    let mut branches = Vec::new();
    for line in output.lines() {
        if line.is_empty() {
            continue;
        }
        let fields: Vec<&str> = line.split('\0').collect();
        if fields.len() < 9 {
            continue;
        }
        // A symbolic ref such as `refs/remotes/origin/HEAD` is an alias, not a
        // branch of its own.
        if !fields[3].is_empty() {
            continue;
        }

        let ref_name = fields[1].to_string();
        let (kind, remote, name) = classify(&ref_name, remotes);
        let logical_name = match &remote {
            Some(remote) => name
                .strip_prefix(&format!("{remote}/"))
                .unwrap_or(&name)
                .to_string(),
            None => name.clone(),
        };
        let commit = fields[0].to_string();
        let (ahead, behind, gone) = parse_track(fields[5]);

        branches.push(Branch {
            id: format!("{repo_id}\u{1}branch\u{1}{ref_name}"),
            repo_id: repo_id.to_string(),
            ref_name,
            name,
            logical_name,
            kind,
            remote,
            short_commit: commit.chars().take(7).collect(),
            commit,
            subject: fields[8].to_string(),
            author: fields[7].to_string(),
            committed_at: (!fields[6].is_empty()).then(|| fields[6].to_string()),
            is_head: fields[2] == "*",
            upstream: (!fields[4].is_empty()).then(|| fields[4].to_string()),
            ahead,
            behind,
            gone,
            checked_out_in: Vec::new(),
        });
    }

    branches.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(branches)
}

/// Splits a ref name into its kind, remote and display name. The remote is
/// matched against the configured remotes because a remote name may itself
/// contain a slash.
pub(super) fn classify(ref_name: &str, remotes: &[Remote]) -> (BranchKind, Option<String>, String) {
    if let Some(name) = ref_name.strip_prefix("refs/heads/") {
        return (BranchKind::Local, None, name.to_string());
    }

    if let Some(name) = ref_name.strip_prefix("refs/remotes/") {
        let remote = remotes
            .iter()
            .filter(|remote| name.starts_with(&format!("{}/", remote.name)))
            .max_by_key(|remote| remote.name.len())
            .map(|remote| remote.name.clone())
            .or_else(|| name.split('/').next().map(str::to_string));
        return (BranchKind::Remote, remote, name.to_string());
    }

    (BranchKind::Local, None, ref_name.to_string())
}

/// Parses `%(upstream:track)`, which reads `[ahead 3, behind 1]` or `[gone]`.
pub(super) fn parse_track(track: &str) -> (u32, u32, bool) {
    let Some(inner) = track
        .trim()
        .strip_prefix('[')
        .and_then(|t| t.strip_suffix(']'))
    else {
        return (0, 0, false);
    };
    if inner == "gone" {
        return (0, 0, true);
    }

    let mut ahead = 0;
    let mut behind = 0;
    for part in inner.split(',') {
        let mut words = part.split_whitespace();
        match (words.next(), words.next()) {
            (Some("ahead"), Some(count)) => ahead = count.parse().unwrap_or(0),
            (Some("behind"), Some(count)) => behind = count.parse().unwrap_or(0),
            _ => {}
        }
    }
    (ahead, behind, false)
}

fn read_worktrees(dir: &Path, repo_id: &str, common_dir: &Path) -> Vec<Worktree> {
    let Some(output) = cmd::try_run(dir, &["worktree", "list", "--porcelain"]) else {
        return Vec::new();
    };
    let host = Host::of(dir);

    let mut worktrees: Vec<Worktree> = Vec::new();
    for block in output.split("\n\n") {
        let mut current: Option<Worktree> = None;
        for line in block.lines() {
            let (key, value) = match line.split_once(' ') {
                Some((key, value)) => (key, Some(value)),
                None => (line, None),
            };

            // `worktree` opens a block and every other key fills the one it
            // opened, so the block's own line is handled first and the rest
            // share one guard rather than each repeating it.
            if key == "worktree" {
                let path = cmd::path_of(dir, value.unwrap_or_default());
                let name = host.name(&path);
                // The main worktree is the one whose git directory is the
                // common directory itself.
                let is_main = host.is_dir(&host.join(&path, ".git")) || path == *common_dir;
                current = Some(Worktree {
                    id: format!("{repo_id}\u{1}worktree\u{1}{}", path.display()),
                    repo_id: repo_id.to_string(),
                    name,
                    exists: host.is_dir(&path),
                    path: path.to_string_lossy().into_owned(),
                    head: None,
                    short_head: None,
                    branch: None,
                    detached: false,
                    bare: false,
                    locked: false,
                    lock_reason: None,
                    prunable: false,
                    prunable_reason: None,
                    is_main,
                });
                continue;
            }

            // A key before any `worktree` line belongs to no block.
            let Some(worktree) = current.as_mut() else {
                continue;
            };

            match key {
                "HEAD" => {
                    let head = value.unwrap_or_default().to_string();
                    worktree.short_head = Some(head.chars().take(7).collect());
                    worktree.head = Some(head);
                }
                "branch" => worktree.branch = value.map(str::to_string),
                "detached" => worktree.detached = true,
                "bare" => worktree.bare = true,
                "locked" => {
                    worktree.locked = true;
                    worktree.lock_reason = value.map(str::to_string);
                }
                "prunable" => {
                    worktree.prunable = true;
                    worktree.prunable_reason = value.map(str::to_string);
                }
                _ => {}
            }
        }

        if let Some(worktree) = current {
            worktrees.push(worktree);
        }
    }

    // `git worktree list` always reports the main worktree first; trust that
    // over the heuristic above when nothing else matched.
    if !worktrees.iter().any(|worktree| worktree.is_main)
        && let Some(first) = worktrees.first_mut()
    {
        first.is_main = true;
    }

    worktrees
}

fn link_worktrees(branches: &mut [Branch], worktrees: &[Worktree]) {
    let mut by_ref: HashMap<&str, Vec<String>> = HashMap::new();
    for worktree in worktrees.iter() {
        if let Some(branch) = worktree.branch.as_deref() {
            by_ref.entry(branch).or_default().push(worktree.id.clone());
        }
    }

    for branch in branches.iter_mut() {
        if let Some(ids) = by_ref.get(branch.ref_name.as_str()) {
            branch.checked_out_in = ids.clone();
        }
    }
}

fn read_head(dir: &Path) -> (Option<String>, bool) {
    match cmd::try_run(dir, &["symbolic-ref", "--quiet", "HEAD"]) {
        Some(head) if !head.trim().is_empty() => (Some(head.trim().to_string()), false),
        _ => {
            let commit = cmd::try_run(dir, &["rev-parse", "HEAD"])
                .map(|commit| commit.trim().to_string())
                .filter(|commit| !commit.is_empty());
            (commit, true)
        }
    }
}

fn read_default_branch(dir: &Path, branches: &[Branch], remotes: &[Remote]) -> Option<String> {
    for remote in remotes {
        let head_ref = format!("refs/remotes/{}/HEAD", remote.name);
        if let Some(target) = cmd::try_run(dir, &["symbolic-ref", "--quiet", &head_ref]) {
            let target = target.trim();
            if !target.is_empty() {
                // Prefer the local branch of the same name when it exists.
                let logical = target.rsplit('/').next().unwrap_or_default();
                let local = format!("refs/heads/{logical}");
                if branches.iter().any(|branch| branch.ref_name == local) {
                    return Some(local);
                }
                return Some(target.to_string());
            }
        }
    }

    for candidate in DEFAULT_BRANCH_CANDIDATES {
        let ref_name = format!("refs/heads/{candidate}");
        if branches.iter().any(|branch| branch.ref_name == ref_name) {
            return Some(ref_name);
        }
    }

    branches
        .iter()
        .find(|branch| branch.is_head)
        .map(|branch| branch.ref_name.clone())
}
