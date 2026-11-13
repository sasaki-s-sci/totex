use std::os::unix::fs::PermissionsExt;
use std::path::PathBuf;
use std::process::Command;

use super::{TempDir, cmd, git, scan};

#[test]
fn repository_helpers_require_the_users_git_trust() {
    const FIXTURE: &str = "TOTEX_GIT_TRUST_FIXTURE";
    if let Some(root) = std::env::var_os(FIXTURE) {
        let root = PathBuf::from(root);
        let repo = root.join("repo");
        let result = cmd::run(&repo, &["ls-files", "--others", "--exclude-standard", "-z"]);
        if std::env::var_os("TOTEX_GIT_TRUSTED").is_some() {
            result.expect("the user's trusted repository is readable");
            assert!(repo.join("helper-ran").exists());
        } else {
            assert!(result.unwrap_err().contains("dubious ownership"));
            assert!(!repo.join("helper-ran").exists());
            let workspace = scan(root.to_string_lossy().into_owned(), None).expect("scan");
            assert!(workspace.repositories.is_empty());
            assert!(
                workspace
                    .warnings
                    .iter()
                    .any(|warning| warning.contains("dubious ownership"))
            );
        }
        return;
    }

    let temp = TempDir::new("git-trust");
    let repo = temp.path().join("repo");
    std::fs::create_dir(&repo).expect("repository directory");
    git(&repo, &["init", "--quiet", "-b", "main"]);
    let helper = repo.join("monitor");
    std::fs::write(
        &helper,
        "#!/bin/sh\nprintf ran > helper-ran\nprintf '\\0'\n",
    )
    .expect("filesystem monitor helper");
    std::fs::set_permissions(&helper, std::fs::Permissions::from_mode(0o700))
        .expect("executable helper");
    git(
        &repo,
        &["config", "core.fsmonitor", helper.to_str().unwrap()],
    );

    let config = temp.path().join("gitconfig");
    std::fs::write(&config, "").expect("isolated git configuration");
    for trusted in [false, true] {
        if trusted {
            git(
                &repo,
                &[
                    "config",
                    "--file",
                    config.to_str().unwrap(),
                    "safe.directory",
                    repo.to_str().unwrap(),
                ],
            );
        }
        // A child process keeps Git's ownership override away from parallel tests.
        let mut child = Command::new(std::env::current_exe().expect("test executable"));
        child
            .args([
                "--exact",
                "git::tests::trust::repository_helpers_require_the_users_git_trust",
                "--nocapture",
            ])
            .env(FIXTURE, temp.path())
            .env("GIT_TEST_ASSUME_DIFFERENT_OWNER", "1")
            .env("GIT_CONFIG_GLOBAL", &config)
            .env("GIT_CONFIG_SYSTEM", "/dev/null")
            .env("GIT_CONFIG_COUNT", "0")
            .env_remove("GIT_CONFIG_PARAMETERS")
            .env_remove("TOTEX_GIT_TRUSTED");
        if trusted {
            child.env("TOTEX_GIT_TRUSTED", "1");
        }
        let output = child.output().expect("isolated trust test");
        assert!(
            output.status.success(),
            "{}\n{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
    }
}
