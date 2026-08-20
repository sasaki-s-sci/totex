use std::path::Path;
use std::process::{Command, Output};

/// A git process, built the one way this app builds them.
///
/// `dir` is the repository to run inside, or `None` for a question about git
/// itself. Every call is non-interactive: a repository with a credential prompt
/// or a stale lock must never block the scan.
fn git_command(dir: Option<&Path>) -> Command {
    let mut command = Command::new("git");
    if let Some(dir) = dir {
        command.arg("-C").arg(dir);
    }
    command
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_OPTIONAL_LOCKS", "0")
        .env("GIT_PAGER", "cat")
        .env("LC_ALL", "C");

    #[cfg(windows)]
    {
        // Keep git from flashing a console window on every invocation.
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }

    command
}

/// Runs it, saying what a git that is not there looks like.
fn output(mut command: Command) -> Result<Output, String> {
    command.output().map_err(|error| match error.kind() {
        std::io::ErrorKind::NotFound => "git-missing".to_string(),
        _ => error.to_string(),
    })
}

/// Runs git inside `dir` and returns stdout.
pub fn run(dir: &Path, args: &[&str]) -> Result<String, String> {
    let mut command = git_command(Some(dir));
    command.args(args);
    let output = output(command)?;

    if !output.status.success() {
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

pub fn version() -> Result<String, String> {
    let mut command = git_command(None);
    command.arg("--version");
    let output = output(command)?;
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}
