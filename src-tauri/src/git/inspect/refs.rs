//! The refs a repository has: its remotes, its branches, and which of them it
//! is standing on.

use std::path::Path;

use super::super::cmd;
use super::super::model::{Branch, BranchKind, Remote};
use super::{DEFAULT_BRANCH_CANDIDATES, REF_FORMAT};

pub(super) fn read_remotes(dir: &Path) -> Vec<Remote> {
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

pub(super) fn read_branches(
    dir: &Path,
    repo_id: &str,
    remotes: &[Remote],
) -> Result<Vec<Branch>, String> {
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
pub(crate) fn classify(ref_name: &str, remotes: &[Remote]) -> (BranchKind, Option<String>, String) {
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
pub(crate) fn parse_track(track: &str) -> (u32, u32, bool) {
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

pub(super) fn read_head(dir: &Path) -> (Option<String>, bool) {
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

pub(super) fn read_default_branch(
    dir: &Path,
    branches: &[Branch],
    remotes: &[Remote],
) -> Option<String> {
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
