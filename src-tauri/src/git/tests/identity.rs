use super::{TempDir, git};
use crate::git::identity::read;

#[test]
fn identity_matches_git_in_each_repository_and_refreshes() {
    for name in ["First Account", "Second Account"] {
        let dir = TempDir::new("identity");
        git(dir.path(), &["init", "-b", "main"]);
        git(dir.path(), &["config", "user.name", name]);
        git(
            dir.path(),
            &["config", "user.email", "account@example.invalid"],
        );
        git(dir.path(), &["config", "committer.name", name]);
        for role in ["author.email", "committer.email"] {
            git(dir.path(), &["config", role, "account@example.invalid"]);
        }
        for author in ["Original Author", "Updated Author"] {
            git(dir.path(), &["config", "author.name", author]);
            let found = serde_json::to_value(read(dir.path()).unwrap()).unwrap();
            for (key, role, configured) in [
                ("author", "AUTHOR", author),
                ("committer", "COMMITTER", name),
            ] {
                let name = std::env::var(format!("GIT_{role}_NAME"))
                    .unwrap_or_else(|_| configured.to_string());
                let email = std::env::var(format!("GIT_{role}_EMAIL"))
                    .unwrap_or_else(|_| "account@example.invalid".to_string());
                assert_eq!(found[key], format!("{name} <{email}>"));
            }
        }
    }
}

#[test]
fn identity_rejects_a_folder_without_a_repository() {
    let dir = TempDir::new("identity-outside");
    assert!(read(dir.path()).is_err());
}
