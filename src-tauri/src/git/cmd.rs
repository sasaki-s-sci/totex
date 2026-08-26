//! The one way this app runs git.
//!
//! A repository is not always on the machine the window is running on: a folder
//! under `\\wsl.localhost\<distro>` is a Linux checkout, and the git that has
//! to read it is the distribution's own. Which one runs is decided here, from
//! the directory, so that nothing above this file has to know — see
//! [`crate::host`].

use std::path::{Path, PathBuf};

use crate::host::{Host, Output};
use crate::wsl;

/// How every git this app runs is told to behave.
///
/// Non-interactive throughout: a repository with a credential prompt or a stale
/// lock must never block the scan.
const ENVIRONMENT: [(&str, &str); 4] = [
    ("GIT_TERMINAL_PROMPT", "0"),
    ("GIT_OPTIONAL_LOCKS", "0"),
    ("GIT_PAGER", "cat"),
    ("LC_ALL", "C"),
];

/// Says this one directory belongs to whoever is asking.
///
/// git refuses to read a repository whose files are somebody else's, because a
/// repository is a directory that can run programs — its hooks, and its config
/// naming the commands git shells out to. Most checkouts are the user's own,
/// but not all: one left by another account, or by `sudo`, is otherwise a scan
/// that fails on every call it makes — and the whole scan failing is the red
/// rule along the top of the canvas.
///
/// Named one directory at a time rather than as `*`: the exception covers the
/// folder that was opened here and nothing else on the machine. It goes on the
/// command line because that is one of the three places git will read it from —
/// the point of the setting is that a repository cannot vouch for itself, so
/// neither its own config nor the environment is trusted with it.
fn safe_directory(dir: &str) -> String {
    format!("safe.directory={dir}")
}

/// An argument that names a path, as the machine running git spells it.
///
/// The app carries a WSL path in its Windows spelling, and every one of these
/// arguments — a worktree to add, a directory to remove — was got from
/// somewhere that spells it that way. Only the distribution git is about to run
/// in is rewritten: an argument naming another one is not a path this git can
/// reach, and passing it through unchanged is what says so.
fn native_argument(host: &Host, argument: &str) -> String {
    match wsl::locate(argument) {
        Some(found) if Some(found.distro.as_str()) == host.distro() => found.path,
        _ => argument.to_string(),
    }
}

/// Runs git inside `dir` and hands back everything it said.
///
/// Where both of the calls below start: which git runs is decided from the
/// directory, and so is the spelling of every argument that names a path.
fn exec(dir: &Path, args: &[&str]) -> Result<Output, String> {
    let host = Host::of(dir);
    let here = host.native(dir);
    let safe = safe_directory(&here);
    let arguments: Vec<String> = args
        .iter()
        .map(|argument| native_argument(&host, argument))
        .collect();

    let mut argv = vec!["git", "-c", safe.as_str(), "-C", here.as_str()];
    argv.extend(arguments.iter().map(String::as_str));

    host.exec(None, &ENVIRONMENT, &argv).map_err(missing)
}

/// Runs git inside `dir` and returns stdout.
pub fn run(dir: &Path, args: &[&str]) -> Result<String, String> {
    let output = exec(dir, args)?;
    if !output.ok() {
        // A shell that could not find git says so with the code a shell uses
        // for it, which is how a distribution with no git installed reads the
        // same as a machine with none.
        if output.code == 127 {
            return Err("git-missing".to_string());
        }
        // git's own words, whatever they are, and nothing added to them: the
        // window never draws this, and whatever reads it wants git and not us.
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(stderr.trim().to_string());
    }

    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

/// Same as [`run`], but a non-zero exit code yields `None` instead of an error.
/// Used for lookups that are legitimately absent, such as `refs/remotes/origin/HEAD`.
pub fn try_run(dir: &Path, args: &[&str]) -> Option<String> {
    run(dir, args).ok()
}

/// Runs git for an answer it gives in its exit code, and hands back that code
/// along with whatever it said about it.
///
/// [`run`] reads a non-zero exit as a failure, because that is what it nearly
/// always is: git was asked for something and would not do it. One question is
/// not like that. Whether a merge would conflict is answered by `merge-tree`
/// refusing, and there the refusal is the answer rather than an error — so the
/// code has to come back rather than be turned into one. A git that could not
/// be run at all is still an error, because that is not an answer to anything.
pub fn code(dir: &Path, args: &[&str]) -> Result<(i32, String), String> {
    let output = exec(dir, args)?;
    if output.code == 127 {
        return Err("git-missing".to_string());
    }
    Ok((
        output.code,
        String::from_utf8_lossy(&output.stderr).trim().to_string(),
    ))
}

/// A path git printed, in the spelling the rest of the app stores.
///
/// git answers in the terms of the machine it ran on, so a repository inside a
/// distribution says `/home/a/repo` — and everything above this compares those
/// against paths that came from the folder tree, which spells them as the
/// share. One or the other has to give, and it is this one: the UNC spelling is
/// the one that says which distribution as well as where.
pub fn path_of(dir: &Path, printed: &str) -> PathBuf {
    Host::of(dir).canonical(printed.trim())
}

fn missing(error: String) -> String {
    if error == "not-found" {
        "git-missing".to_string()
    } else {
        error
    }
}

/// The git that would run for `dir`, and what it calls itself.
///
/// Asked of a directory rather than of the machine, because those are two
/// different gits: a Windows window that opens a Linux folder runs the
/// distribution's git and never touches the one beside it — which may not be
/// installed at all, and that is not a failure worth drawing.
pub fn version(dir: Option<&Path>) -> Result<String, String> {
    let host = dir.map(Host::of).unwrap_or(Host::Local);
    let output = host
        .exec(None, &ENVIRONMENT, &["git", "--version"])
        .map_err(missing)?;
    if !output.ok() {
        return Err("git-missing".to_string());
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}
