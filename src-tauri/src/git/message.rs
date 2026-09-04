//! The whole of what one commit says.
//!
//! Every commit the graph draws carries its subject, because a line beside a
//! mark on a canvas is one line long. This is the rest of the same message —
//! everything under that first line, which is usually where the reason for a
//! change is — and it is asked for one commit at a time, the moment somebody
//! stops on one. Carried with the rest, it would be a page of prose per dot
//! down every band, read again on every scan and looked at almost never.

use std::path::Path;

use tauri::AppHandle;

use super::cmd;
use super::session::repository_dir;

/// What one commit says, in full: its subject and everything under it.
#[tauri::command]
pub async fn commit_message(
    app: AppHandle,
    repo_id: String,
    oid: String,
) -> Result<String, String> {
    off_thread!({
        let repo = repository_dir(&app, &repo_id)?;
        read_message(&repo, &oid)
    })
}

/// Asks git for one commit's message.
///
/// The blank line git keeps at the end of a message is cut here rather than
/// wherever this is drawn: what comes back is what somebody wrote, and the
/// newline a file ends with is not part of that.
fn read_message(repo: &Path, oid: &str) -> Result<String, String> {
    // `--` because everything before it is a revision: a repository that holds
    // a file named like a commit is still being asked about the commit.
    let said = cmd::run(repo, &["log", "-1", "--format=%B", oid, "--"])?;
    Ok(said.trim_end().to_string())
}

#[cfg(test)]
mod tests {
    use super::read_message;
    use crate::git::tests::{TempDir, git};

    /// A repository with one commit in it, said in as many lines as given.
    fn repository(temp: &TempDir, said: &[&str]) -> (std::path::PathBuf, String) {
        let repo = temp.path().join("repo");
        std::fs::create_dir_all(&repo).expect("create repo dir");
        git(&repo, &["init", "--quiet", "-b", "main"]);
        std::fs::write(repo.join("one.txt"), "one").expect("write file");
        git(&repo, &["add", "."]);

        let mut args = vec!["commit"];
        for line in said {
            args.push("-m");
            args.push(line);
        }
        git(&repo, &args);

        let head = git(&repo, &["rev-parse", "HEAD"]).trim().to_string();
        (repo, head)
    }

    #[test]
    fn everything_written_under_the_subject_comes_back_with_it() {
        let temp = TempDir::new("message");
        let (repo, head) = repository(&temp, &["add one.txt", "Because the graph had no words."]);

        assert_eq!(
            read_message(&repo, &head).expect("read the message"),
            "add one.txt\n\nBecause the graph had no words."
        );
    }

    #[test]
    fn a_commit_that_only_has_a_subject_comes_back_as_that_line() {
        let temp = TempDir::new("message-subject");
        let (repo, head) = repository(&temp, &["add one.txt"]);

        assert_eq!(
            read_message(&repo, &head).expect("read the message"),
            "add one.txt"
        );
    }

    #[test]
    fn a_commit_the_repository_does_not_hold_is_a_refusal() {
        let temp = TempDir::new("message-unknown");
        let (repo, _) = repository(&temp, &["add one.txt"]);

        assert!(read_message(&repo, "0000000000000000000000000000000000000000").is_err());
    }
}
