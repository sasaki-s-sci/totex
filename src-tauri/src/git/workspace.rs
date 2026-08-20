//! Branches as places to work in.
//!
//! A branch you can only look at is a name; a branch you can work in is a
//! directory. Everything here turns the one into the other and back: it hands a
//! branch its own worktree, tells you what is dirty in it, and runs the history
//! operations that need a working tree to run in.
//!
//! Two rules hold throughout:
//!
//! - **One worktree per branch.** Checking a branch out twice leaves an index
//!   stale as soon as the shared ref moves, so every entry point either reuses
//!   the branch's existing worktree or makes its single canonical one.
//! - **Nothing is chosen for you and left behind.** A worktree's path is
//!   derived from the repository and the branch, so the same branch always
//!   lands in the same place and nobody has to invent one.

use std::collections::HashMap;
use std::collections::hash_map::DefaultHasher;
use std::fs;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::{AppHandle, Manager};

use super::cmd;
use super::session::{report_all, repository_dir};

/// A branch and the directory it is checked out in.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Workspace {
    pub repo_id: String,
    pub branch: String,
    pub path: String,
}

/// What is uncommitted in a worktree, counted in files by what became of them.
///
/// Files rather than lines: what a branch has done to the codebase since its
/// commit is which files arrived, which left and which were rewritten, and the
/// graph draws those three as the shares of the branch's rim. The menu counts
/// the same work in the same unit — the whole of it is these three added up.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeStatus {
    /// Files the worktree has that its commit does not — the ones git has been
    /// told about and the ones it has not heard of, alike.
    pub added: u32,
    /// Files its commit has that the worktree does not.
    pub deleted: u32,
    /// Files both have, with something different in them.
    pub modified: u32,
}

// ---------------------------------------------------------------- where

/// A short, filesystem-safe rendering of a branch name.
fn slug(branch: &str) -> String {
    let cleaned: String = branch
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.') {
                character
            } else {
                '-'
            }
        })
        .collect();
    let trimmed: String = cleaned.trim_matches('-').chars().take(48).collect();
    if trimmed.is_empty() {
        "workspace".to_string()
    } else {
        trimmed
    }
}

fn digest(value: &str) -> u64 {
    let mut hasher = DefaultHasher::new();
    value.hash(&mut hasher);
    hasher.finish()
}

/// Where a branch's worktree goes.
///
/// Derived rather than chosen, so the same branch always comes back to the same
/// directory. The repository is hashed into the path because two repositories
/// under one root are allowed to share a name, and the branch is hashed in
/// beside its slug because two branch names can slug to the same thing.
fn worktree_path(root: &Path, repo_path: &str, branch: &str) -> PathBuf {
    root.join(format!("{:016x}", digest(repo_path)))
        .join(format!("{}-{:08x}", slug(branch), digest(branch) as u32))
}

/// The worktree path, with its parent directory made.
fn prepare_worktree_path(root: &Path, repo: &Path, branch: &str) -> Result<PathBuf, String> {
    let path = worktree_path(root, &repo.to_string_lossy(), branch);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    Ok(path)
}

// ---------------------------------------------------------------- git

/// A worktree with work in it, which is what most of these refuse over. The
/// window asks the same question before it offers the operation at all, so this
/// is the answer to a race rather than to a mistake.
const DIRTY: &str = "dirty";

/// Every refusal here is a word the window matches on, never one it shows.
/// What is drawn instead is the mark that was pressed, in red — see the graph's
/// menus, which withhold whatever they can work out beforehand.
fn validate_branch(dir: &Path, branch: &str) -> Result<(), String> {
    cmd::run(dir, &["check-ref-format", "--branch", branch])
        .map(|_| ())
        .map_err(|_| "bad-branch-name".to_string())
}

/// The commit a branch points at, and proof that the branch exists.
fn branch_tip(dir: &Path, branch: &str) -> Result<String, String> {
    cmd::run(
        dir,
        &["rev-parse", "--verify", &format!("refs/heads/{branch}")],
    )
    .map(|out| out.trim().to_string())
    .map_err(|_| "no-such-branch".to_string())
}

fn resolve_commit(dir: &Path, oid: &str) -> Result<String, String> {
    cmd::run(
        dir,
        &["rev-parse", "--verify", &format!("{oid}^{{commit}}")],
    )
    .map(|out| out.trim().to_string())
    .map_err(|_| "no-such-commit".to_string())
}

/// The worktree a branch is already checked out in, if any.
fn worktree_for(dir: &Path, branch: &str) -> Result<Option<String>, String> {
    let listing = cmd::run(dir, &["worktree", "list", "--porcelain"])?;
    let wanted = format!("branch refs/heads/{branch}");
    let mut path: Option<&str> = None;
    for line in listing.lines() {
        if let Some(rest) = line.strip_prefix("worktree ") {
            path = Some(rest);
        } else if line.trim() == wanted {
            return Ok(path.map(str::to_string));
        }
    }
    Ok(None)
}

fn is_clean(dir: &Path) -> Result<bool, String> {
    Ok(cmd::run(dir, &["status", "--porcelain"])?.trim().is_empty())
}

fn ensure_clean(dir: &Path) -> Result<(), String> {
    if is_clean(dir)? {
        return Ok(());
    }
    Err(DIRTY.to_string())
}

/// Runs something that can leave a mess, and cleans it up when it does.
fn run_or_abort(dir: &Path, args: &[&str], abort: &[&str]) -> Result<String, String> {
    cmd::run(dir, args).inspect_err(|_| {
        let _ = cmd::run(dir, abort);
    })
}

/// Runs `action` in a worktree that has `branch` checked out.
///
/// Reuses the branch's own worktree when it has one; otherwise a scratch
/// worktree is made for the duration and taken away again. The removal always
/// runs, but its own failure is only raised when the action succeeded —
/// otherwise a temp directory that would not go away would be reported in place
/// of the merge conflict that is the actual news.
fn in_branch_worktree<T>(
    repo: &Path,
    branch: &str,
    label: &str,
    action: impl FnOnce(&Path) -> Result<T, String>,
) -> Result<T, String> {
    let mut scratch: Option<PathBuf> = None;
    let target = match worktree_for(repo, branch)? {
        Some(existing) => PathBuf::from(existing),
        None => {
            let stamp = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|since| since.as_nanos())
                .unwrap_or_default();
            let path = std::env::temp_dir().join(format!("totex-{label}-{stamp:x}"));
            cmd::run(
                repo,
                &[
                    "worktree",
                    "add",
                    "--quiet",
                    &path.to_string_lossy(),
                    branch,
                ],
            )?;
            scratch = Some(path.clone());
            path
        }
    };

    let result = action(&target);

    if let Some(path) = scratch {
        let removed = cmd::run(
            repo,
            &["worktree", "remove", "--force", &path.to_string_lossy()],
        );
        if result.is_ok() {
            removed?;
        }
    }
    result
}

// ---------------------------------------------------------------- plumbing

/// Where every managed worktree lives, under the app's own data directory.
fn worktrees_root(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("worktrees"))
}

// ---------------------------------------------------------------- commands

/// Cuts `branch` at `oid` and gives it a worktree to work in.
#[tauri::command]
pub async fn create_workspace(
    app: AppHandle,
    repo_id: String,
    branch: String,
    oid: String,
) -> Result<Workspace, String> {
    off_thread!({
        let repo = repository_dir(&app, &repo_id)?;
        let branch = branch.trim().to_string();
        validate_branch(&repo, &branch)?;
        let oid = resolve_commit(&repo, &oid)?;

        let path = prepare_worktree_path(&worktrees_root(&app)?, &repo, &branch)?;
        // One call, so a failure leaves neither the branch nor the directory.
        cmd::run(
            &repo,
            &[
                "worktree",
                "add",
                "-b",
                &branch,
                &path.to_string_lossy(),
                &oid,
            ],
        )?;

        report_all(&app)?;
        Ok(Workspace {
            repo_id,
            branch,
            path: path.to_string_lossy().into_owned(),
        })
    })
}

/// Gives an existing branch its worktree, or hands back the one it has.
#[tauri::command]
pub async fn open_workspace(
    app: AppHandle,
    repo_id: String,
    branch: String,
) -> Result<Workspace, String> {
    off_thread!({
        let repo = repository_dir(&app, &repo_id)?;
        let branch = branch.trim().to_string();
        branch_tip(&repo, &branch)?;

        if let Some(existing) = worktree_for(&repo, &branch)? {
            return Ok(Workspace {
                repo_id,
                branch,
                path: existing,
            });
        }

        let path = prepare_worktree_path(&worktrees_root(&app)?, &repo, &branch)?;
        cmd::run(
            &repo,
            &[
                "worktree",
                "add",
                "--quiet",
                &path.to_string_lossy(),
                &branch,
            ],
        )?;

        report_all(&app)?;
        Ok(Workspace {
            repo_id,
            branch,
            path: path.to_string_lossy().into_owned(),
        })
    })
}

/// Takes a worktree away. Refuses while it holds work that is not committed,
/// unless told plainly to discard it.
#[tauri::command]
pub async fn remove_workspace(
    app: AppHandle,
    repo_id: String,
    path: String,
    force: bool,
) -> Result<(), String> {
    off_thread!({
        let repo = repository_dir(&app, &repo_id)?;
        let target = Path::new(&path);
        if !force && !is_clean(target)? {
            return Err(DIRTY.to_string());
        }
        cmd::run(&repo, &["worktree", "remove", "--force", &path])?;
        report_all(&app)
    })
}

/// Deletes only a local branch. A clean linked worktree holding it is removed
/// first; Git itself refuses the main worktree and branches that are not fully
/// merged into their upstream (or HEAD when no upstream is configured).
#[tauri::command]
pub async fn delete_branch(app: AppHandle, repo_id: String, branch: String) -> Result<(), String> {
    off_thread!({
        let repo = repository_dir(&app, &repo_id)?;
        delete_branch_at(&repo, &branch)?;
        report_all(&app)
    })
}

fn delete_branch_at(repo: &Path, branch: &str) -> Result<(), String> {
    let branch = branch.trim();
    validate_branch(repo, branch)?;
    branch_tip(repo, branch)?;

    // Check the same condition as `git branch --delete` before taking a linked
    // worktree away. A branch that Git will refuse must be left wholly intact.
    let ref_name = format!("refs/heads/{branch}");
    let upstream = cmd::run(repo, &["for-each-ref", "--format=%(upstream)", &ref_name])?;
    let target = match upstream.trim() {
        "" => "HEAD",
        configured => configured,
    };
    cmd::run(repo, &["merge-base", "--is-ancestor", &ref_name, target])
        .map_err(|_| "not-merged".to_string())?;

    if let Some(path) = worktree_for(repo, branch)? {
        let target = Path::new(&path);
        ensure_clean(target)?;
        // `worktree remove` deliberately refuses the repository's main
        // worktree. In that case the branch remains checked out and untouched.
        cmd::run(repo, &["worktree", "remove", "--force", &path])?;
    }

    cmd::run(repo, &["branch", "--delete", "--", branch]).map(|_| ())
}

/// What is uncommitted in a worktree, as counts.
#[tauri::command]
pub async fn workspace_status(path: String) -> Result<WorktreeStatus, String> {
    off_thread!({ read_status(Path::new(&path)).ok_or_else(|| "no-status".to_string()) })
}

/// The same, for every worktree the window is drawing, in one crossing.
///
/// One call rather than one per directory: the window asks about all of them on
/// a clock, and each answer costs gits of its own — so asking one at a time paid
/// for a round trip per worktree and read them one after another. Here they are
/// read in parallel and come back together.
///
/// A directory git will not answer for is left out rather than failing the call.
/// One unreadable worktree is not worth losing the state of the others over, and
/// the window keeps whatever that one last said.
#[tauri::command]
pub async fn workspace_statuses(
    paths: Vec<String>,
) -> Result<HashMap<String, WorktreeStatus>, String> {
    off_thread!({
        let answers = super::parallel_map(paths, |path| {
            let status = read_status(Path::new(&path))?;
            Some((path, status))
        });
        Ok(answers.into_iter().flatten().collect())
    })
}

/// Reads what is uncommitted in a worktree, as a count of files of each kind.
///
/// Two commands rather than `git status`: `diff HEAD --name-status` is
/// everything git has been told about, staged or not — the two are the same
/// fact to anyone looking at the folder — and it says what became of each file
/// rather than only that it moved. What that diff cannot see, files that are
/// not in the index at all, is listed below and counted as what it is: files
/// the worktree has and the commit does not.
///
/// Nothing here reads a file. What the rim draws is a proportion of files, and
/// a directory that has just been unpacked is now counted as fast as git can
/// list it, however much text is in it.
///
/// `None` is a directory git would not answer for, which the window draws as
/// whatever that worktree last said. A repository with no commit in it yet is
/// not that: there is no HEAD to diff against, and everything in it is
/// untracked anyway.
fn read_status(dir: &Path) -> Option<WorktreeStatus> {
    let untracked = cmd::try_run(dir, &["ls-files", "--others", "--exclude-standard", "-z"])?;

    let mut status = WorktreeStatus::default();
    if let Some(listing) = cmd::try_run(dir, &["diff", "HEAD", "--name-status", "-z"]) {
        count_name_status(&listing, &mut status);
    }
    status.added += count_untracked(&untracked);
    Some(status)
}

/// Reads `git diff --name-status -z`: what became of a file and the path it
/// became of, each NUL-terminated rather than a line of its own, so that a path
/// with a newline or a quote in it arrives as git holds it.
///
/// A rename or a copy carries a similarity score on its letter and two paths
/// after it — where the file was and where it is now — which is why the paths
/// are stepped over by what the letter says rather than one at a time.
fn count_name_status(listing: &str, status: &mut WorktreeStatus) {
    let mut fields = listing.split('\0').filter(|field| !field.is_empty());

    while let Some(kind) = fields.next() {
        let Some(letter) = kind.chars().next() else {
            continue;
        };
        let paths = if letter == 'R' || letter == 'C' { 2 } else { 1 };
        for _ in 0..paths {
            if fields.next().is_none() {
                return;
            }
        }

        match letter {
            // A copy is a file the worktree has and the commit does not,
            // whatever it was made out of.
            'A' | 'C' => status.added += 1,
            'D' => status.deleted += 1,
            // Everything else is a file both have and differ over: rewritten,
            // renamed, turned into a symlink, or left unmerged. A rename is one
            // file that changed rather than one arriving and one leaving —
            // nothing was written and nothing was lost.
            _ => status.modified += 1,
        }
    }
}

/// How many files git has not been told about, which are files the worktree has
/// and its commit does not, however git would compare them.
///
/// Listed by `ls-files` rather than taken from `git status`, which collapses a
/// whole new directory into a single entry and quotes anything unusual in a
/// path.
fn count_untracked(listing: &str) -> u32 {
    let files = listing.split('\0').filter(|path| !path.is_empty()).count();
    u32::try_from(files).unwrap_or(u32::MAX)
}

/// Merges `source` into `target`, in `target`'s own worktree.
#[tauri::command]
pub async fn merge_branch(
    app: AppHandle,
    repo_id: String,
    source: String,
    target: String,
) -> Result<String, String> {
    off_thread!({
        let repo = repository_dir(&app, &repo_id)?;
        let source = source.trim().to_string();
        let target = target.trim().to_string();
        validate_branch(&repo, &source)?;
        validate_branch(&repo, &target)?;
        if source == target {
            return Err("same-branch".to_string());
        }
        branch_tip(&repo, &source)?;
        branch_tip(&repo, &target)?;

        let output = in_branch_worktree(&repo, &target, "merge", |dir| {
            ensure_clean(dir)?;
            run_or_abort(dir, &["merge", "--no-edit", &source], &["merge", "--abort"])
        })?;

        report_all(&app)?;
        Ok(output.trim().to_string())
    })
}

/// Replays one commit onto a branch, in that branch's own worktree.
///
/// Revert and cherry-pick are the same protocol with a different verb: check
/// the branch and the commit are real, run it where the branch is checked out,
/// and abort rather than leave a half-applied state behind. `verb` is git's own
/// subcommand, which is also what names the scratch worktree and what every
/// message this can fail with is written in terms of.
fn replay(
    app: &AppHandle,
    repo_id: &str,
    branch: &str,
    oid: &str,
    verb: &str,
    flags: &[&str],
) -> Result<(), String> {
    let repo = repository_dir(app, repo_id)?;
    let branch = branch.trim().to_string();
    validate_branch(&repo, &branch)?;
    branch_tip(&repo, &branch)?;
    let oid = resolve_commit(&repo, oid)?;

    let mut args = vec![verb];
    args.extend_from_slice(flags);
    args.push(&oid);

    in_branch_worktree(&repo, &branch, verb, |dir| {
        ensure_clean(dir)?;
        run_or_abort(dir, &args, &[verb, "--abort"]).map(|_| ())
    })?;
    report_all(app)
}

/// Undoes `oid` on `branch` by committing its inverse.
#[tauri::command]
pub async fn revert_commit(
    app: AppHandle,
    repo_id: String,
    branch: String,
    oid: String,
) -> Result<(), String> {
    off_thread!(replay(
        &app,
        &repo_id,
        &branch,
        &oid,
        "revert",
        &["--no-edit"]
    ))
}

/// Copies `oid` onto `branch`.
#[tauri::command]
pub async fn cherry_pick_commit(
    app: AppHandle,
    repo_id: String,
    branch: String,
    oid: String,
) -> Result<(), String> {
    off_thread!(replay(&app, &repo_id, &branch, &oid, "cherry-pick", &[]))
}

/// Drops the newest commit on `branch`.
///
/// Only ever the branch's own tip, checked here rather than trusted from the
/// window — a stale graph would otherwise reset past commits nobody meant to
/// lose.
#[tauri::command]
pub async fn undo_commit(
    app: AppHandle,
    repo_id: String,
    branch: String,
    oid: String,
) -> Result<(), String> {
    off_thread!({
        let repo = repository_dir(&app, &repo_id)?;
        let branch = branch.trim().to_string();
        validate_branch(&repo, &branch)?;
        let tip = branch_tip(&repo, &branch)?;
        let oid = resolve_commit(&repo, &oid)?;
        if tip != oid {
            return Err("behind".to_string());
        }
        let parent = resolve_commit(&repo, &format!("{oid}^")).map_err(|_| "root-commit")?;

        in_branch_worktree(&repo, &branch, "undo", |dir| {
            ensure_clean(dir)?;
            cmd::run(dir, &["reset", "--hard", &parent]).map(|_| ())
        })?;
        report_all(&app)
    })
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use super::*;
    // The fixture is the sibling suite's: one temp directory that cleans itself
    // up, and one git that is isolated from the machine's own config. Two
    // copies of that isolation is two places to correct it.
    use crate::git::tests::{TempDir, commit, git};

    /// A repository on `main` with one commit per named file.
    fn repository(temp: &TempDir, files: &[&str]) -> PathBuf {
        let path = temp.path().join("repo");
        std::fs::create_dir_all(&path).expect("create repo dir");
        git(&path, &["init", "--quiet", "-b", "main"]);
        // Set in the repository rather than passed as environment, because the
        // code under test runs git itself and does not — and must not — invent
        // an identity to commit under.
        git(&path, &["config", "user.name", "totex"]);
        git(&path, &["config", "user.email", "totex@example.invalid"]);
        for file in files {
            commit(&path, file, file);
        }
        path
    }

    fn head_of(repo: &Path, branch: &str) -> String {
        git(repo, &["rev-parse", branch]).trim().to_string()
    }

    /// `workspace_status` without the command wrapper around it.
    fn count(dir: &Path) -> (u32, u32, u32) {
        let status = read_status(dir).expect("status");
        (status.added, status.deleted, status.modified)
    }

    #[test]
    fn a_branch_always_lands_in_the_same_directory() {
        let root = Path::new("/data");
        let once = worktree_path(root, "/repo/a", "feature/x");
        assert_eq!(once, worktree_path(root, "/repo/a", "feature/x"));

        // The name is readable, and what makes it unique is not.
        let leaf = once.file_name().unwrap().to_string_lossy().into_owned();
        assert!(leaf.starts_with("feature-x-"), "unreadable leaf: {leaf}");

        // Two repositories may share a branch name without sharing a directory.
        assert_ne!(once, worktree_path(root, "/repo/b", "feature/x"));
        // Two branches may slug the same without sharing a directory.
        assert_ne!(once, worktree_path(root, "/repo/a", "feature+x"));
    }

    #[test]
    fn a_branch_with_no_usable_characters_still_gets_a_name() {
        assert_eq!(slug("///"), "workspace");
        assert_eq!(slug("release/1.2"), "release-1.2");
    }

    #[test]
    fn what_arrived_is_counted_apart_from_what_left() {
        let mut status = WorktreeStatus::default();
        count_name_status(
            concat!(
                "M\0edited.txt\0",
                "A\0arrived.txt\0",
                "D\0left.txt\0",
                // Two paths, and the file is neither new nor gone.
                "R100\0was.txt\0is.txt\0",
                "T\0now-a-link\0",
            ),
            &mut status,
        );

        assert_eq!(status.added, 1);
        assert_eq!(status.deleted, 1);
        assert_eq!(status.modified, 3);
    }

    #[test]
    fn a_rename_does_not_eat_the_letter_after_it() {
        let mut status = WorktreeStatus::default();
        // The second path of a rename is a path and not the next file's letter:
        // reading it as one would count `A` as a file that arrived.
        count_name_status("R100\0was.txt\0A\0D\0gone.txt\0", &mut status);

        assert_eq!(status.added, 0);
        assert_eq!(status.deleted, 1);
        assert_eq!(status.modified, 1);
    }

    #[test]
    fn status_counts_the_files_a_worktree_has_that_its_commit_does_not() {
        let temp = TempDir::new("status");
        let repo = repository(&temp, &["one.txt", "two.txt"]);
        assert_eq!(count(&repo), (0, 0, 0));

        std::fs::write(repo.join("one.txt"), "a\nb\n").expect("write");
        assert_eq!(count(&repo), (0, 0, 1));

        // Staged or not is the same fact to anyone looking at the folder, so
        // nothing here moves when git is told about it.
        git(&repo, &["add", "one.txt"]);
        assert_eq!(count(&repo), (0, 0, 1));

        // A file git has never heard of is a file the worktree has and the
        // commit does not, which is what a new file is.
        std::fs::write(repo.join("three.txt"), "new\nfile\n").expect("write");
        assert_eq!(count(&repo), (1, 0, 1));

        // And one that has gone is counted where it went, not where it was.
        std::fs::remove_file(repo.join("two.txt")).expect("remove");
        assert_eq!(count(&repo), (1, 1, 1));
    }

    #[test]
    fn a_worktree_is_found_by_the_branch_it_holds() {
        let temp = TempDir::new("find");
        let repo = repository(&temp, &["one.txt"]);
        let side = temp.path().join("side");

        assert_eq!(worktree_for(&repo, "topic").expect("look"), None);
        git(
            &repo,
            &["worktree", "add", "-b", "topic", &side.to_string_lossy()],
        );

        let found = worktree_for(&repo, "topic").expect("look").expect("a path");
        assert_eq!(
            Path::new(&found).canonicalize().ok(),
            side.canonicalize().ok()
        );
        assert!(worktree_for(&repo, "main").expect("look").is_some());
        assert_eq!(worktree_for(&repo, "nothing").expect("look"), None);
    }

    #[test]
    fn deleting_a_local_branch_leaves_its_remote_tracking_ref() {
        let temp = TempDir::new("delete-branch");
        let repo = repository(&temp, &["one.txt"]);
        git(&repo, &["checkout", "--quiet", "-b", "topic"]);
        commit(&repo, "two.txt", "two");
        git(
            &repo,
            &[
                "remote",
                "add",
                "origin",
                "https://example.invalid/repo.git",
            ],
        );
        git(&repo, &["update-ref", "refs/remotes/origin/topic", "topic"]);
        git(
            &repo,
            &["branch", "--set-upstream-to=origin/topic", "topic"],
        );
        git(&repo, &["checkout", "--quiet", "main"]);

        delete_branch_at(&repo, "topic").expect("delete local branch");

        assert!(cmd::try_run(&repo, &["rev-parse", "--verify", "refs/heads/topic"]).is_none());
        assert!(
            cmd::try_run(
                &repo,
                &["rev-parse", "--verify", "refs/remotes/origin/topic"]
            )
            .is_some(),
            "the remote-tracking ref was deleted with the local branch"
        );
    }

    #[test]
    fn deleting_a_branch_removes_its_clean_linked_worktree() {
        let temp = TempDir::new("delete-worktree-branch");
        let repo = repository(&temp, &["one.txt"]);
        let side = temp.path().join("side");
        git(
            &repo,
            &["worktree", "add", "-b", "topic", &side.to_string_lossy()],
        );

        delete_branch_at(&repo, "topic").expect("delete branch and worktree");

        assert!(
            !side.exists(),
            "the branch's linked worktree was left behind"
        );
        assert!(cmd::try_run(&repo, &["rev-parse", "--verify", "refs/heads/topic"]).is_none());
    }

    #[test]
    fn deleting_a_branch_refuses_a_dirty_linked_worktree() {
        let temp = TempDir::new("keep-dirty-branch");
        let repo = repository(&temp, &["one.txt"]);
        let side = temp.path().join("side");
        git(
            &repo,
            &["worktree", "add", "-b", "topic", &side.to_string_lossy()],
        );
        std::fs::write(side.join("uncommitted.txt"), "keep me").expect("write dirty file");

        assert_eq!(
            delete_branch_at(&repo, "topic").expect_err("dirty refusal"),
            DIRTY
        );
        assert!(side.exists(), "the dirty worktree was removed");
        assert!(cmd::try_run(&repo, &["rev-parse", "--verify", "refs/heads/topic"]).is_some());
    }

    #[test]
    fn deleting_an_unmerged_branch_leaves_its_worktree_in_place() {
        let temp = TempDir::new("keep-unmerged-branch");
        let repo = repository(&temp, &["one.txt"]);
        let side = temp.path().join("side");
        git(
            &repo,
            &["worktree", "add", "-b", "topic", &side.to_string_lossy()],
        );
        commit(&side, "two.txt", "two");

        assert_eq!(
            delete_branch_at(&repo, "topic").expect_err("unmerged refusal"),
            "not-merged"
        );
        assert!(side.exists(), "the unmerged branch's worktree was removed");
        assert!(cmd::try_run(&repo, &["rev-parse", "--verify", "refs/heads/topic"]).is_some());
    }

    #[test]
    fn an_operation_runs_in_the_branchs_own_worktree_when_it_has_one() {
        let temp = TempDir::new("reuse");
        let repo = repository(&temp, &["one.txt"]);
        let side = temp.path().join("side");
        git(
            &repo,
            &["worktree", "add", "-b", "topic", &side.to_string_lossy()],
        );

        let used = in_branch_worktree(&repo, "topic", "probe", |dir| Ok(dir.to_path_buf()))
            .expect("run in the worktree");
        assert_eq!(used.canonicalize().ok(), side.canonicalize().ok());
    }

    #[test]
    fn an_operation_borrows_a_worktree_and_gives_it_back() {
        let temp = TempDir::new("scratch");
        let repo = repository(&temp, &["one.txt"]);
        git(&repo, &["branch", "topic"]);

        let borrowed = in_branch_worktree(&repo, "topic", "probe", |dir| Ok(dir.to_path_buf()))
            .expect("run in a scratch worktree");
        assert!(!borrowed.exists(), "the scratch worktree was left behind");

        // A failure is still cleaned up after, and the failure itself is what
        // comes back — not whatever the cleanup had to say.
        let failed: Result<PathBuf, String> = in_branch_worktree(&repo, "topic", "probe", |dir| {
            Err(dir.display().to_string())
        });
        let left = PathBuf::from(failed.expect_err("the action failed"));
        assert!(!left.exists(), "the scratch worktree outlived its failure");
    }

    #[test]
    fn merging_moves_the_target_and_leaves_the_source_alone() {
        let temp = TempDir::new("merge");
        let repo = repository(&temp, &["one.txt"]);
        git(&repo, &["checkout", "--quiet", "-b", "topic"]);
        commit(&repo, "two.txt", "two");
        let topic = head_of(&repo, "topic");
        git(&repo, &["checkout", "--quiet", "main"]);

        let merged = in_branch_worktree(&repo, "main", "merge", |dir| {
            ensure_clean(dir)?;
            run_or_abort(dir, &["merge", "--no-edit", "topic"], &["merge", "--abort"])
        })
        .expect("merge");

        assert!(!merged.is_empty(), "merge said nothing");
        assert_eq!(head_of(&repo, "main"), topic, "main did not fast-forward");
        assert_eq!(head_of(&repo, "topic"), topic, "topic moved");
    }

    #[test]
    fn a_dirty_worktree_refuses_the_operation_rather_than_half_doing_it() {
        let temp = TempDir::new("dirty");
        let repo = repository(&temp, &["one.txt"]);
        std::fs::write(repo.join("one.txt"), "uncommitted").expect("write");

        let refused = ensure_clean(&repo);
        assert!(refused.is_err(), "a dirty worktree was accepted");
        assert_eq!(refused.unwrap_err(), DIRTY, "the refusal was not the one");
    }

    #[test]
    fn reverting_adds_a_commit_that_undoes_the_named_one() {
        let temp = TempDir::new("revert");
        let repo = repository(&temp, &["one.txt", "two.txt"]);
        let before = head_of(&repo, "main");

        in_branch_worktree(&repo, "main", "revert", |dir| {
            run_or_abort(
                dir,
                &["revert", "--no-edit", &before],
                &["revert", "--abort"],
            )
            .map(|_| ())
        })
        .expect("revert");

        assert_ne!(head_of(&repo, "main"), before, "nothing was committed");
        assert!(
            !repo.join("two.txt").exists(),
            "the reverted change is still there"
        );
    }

    #[test]
    fn undoing_the_tip_moves_the_branch_back_one_commit() {
        let temp = TempDir::new("undo");
        let repo = repository(&temp, &["one.txt", "two.txt"]);
        let tip = head_of(&repo, "main");
        let parent = git(&repo, &["rev-parse", "main^"]).trim().to_string();

        in_branch_worktree(&repo, "main", "undo", |dir| {
            cmd::run(dir, &["reset", "--hard", &parent]).map(|_| ())
        })
        .expect("undo");

        assert_eq!(head_of(&repo, "main"), parent, "main did not move back");
        assert_ne!(parent, tip);
        assert!(!repo.join("two.txt").exists(), "the commit is still there");
    }

    #[test]
    fn what_does_not_exist_is_reported_rather_than_guessed_at() {
        let temp = TempDir::new("missing");
        let repo = repository(&temp, &["one.txt"]);
        assert!(branch_tip(&repo, "nothing").is_err());
        assert!(validate_branch(&repo, "bad name").is_err());
        assert!(validate_branch(&repo, "feature/x").is_ok());
        assert!(resolve_commit(&repo, "deadbeef").is_err());
        assert!(resolve_commit(&repo, "main").is_ok());
    }
}
