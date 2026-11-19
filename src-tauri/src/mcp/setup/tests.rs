use super::*;

#[test]
fn local_setup_runs_the_app_registration_without_session_credentials() {
    let setup = prepare("/projects/app", 26374).unwrap();
    assert!(setup.command.contains(" --register-codex-mcp"));
    assert!(!setup.command.contains("TOKEN"));
    assert!(!setup.environment.is_empty());
}

#[test]
fn an_ssh_terminal_is_not_offered_a_local_connection() {
    assert!(
        prepare("ssh://example/projects/app", 26374)
            .unwrap_err()
            .contains("SSH")
    );
}

#[test]
fn commands_reject_relative_paths_and_line_breaks() {
    for path in [
        "relative",
        "/home/a\nnext",
        "/home/a\rnext",
        "/home/a\0next",
    ] {
        assert!(local_command(path, false).is_err());
        assert!(wsl_command(path, "Ubuntu").is_err());
    }
    assert!(wsl_command("/app/totex.exe", "Ubuntu\nextra").is_err());
    assert!(local_command("relative", true).is_err());
    assert!(local_command("C:relative", true).is_err());
    assert_eq!(
        local_command(r"C:\User's apps\totex.exe", true).unwrap(),
        r"& 'C:\User''s apps\totex.exe' --register-codex-mcp | Out-Host"
    );
}

#[cfg(unix)]
#[test]
fn a_wsl_command_preserves_quotes_and_expands_only_codex_home() {
    use std::os::unix::fs::PermissionsExt;
    use std::{fs, process::Command};
    let dir =
        std::env::temp_dir().join(format!("totex-registration-quotes-{}", std::process::id()));
    fs::create_dir_all(&dir).unwrap();
    let executable = dir.join("totex's $(not-run).exe");
    fs::write(&executable, "#!/bin/sh\nprintf '%s\\0' \"$@\"\n").unwrap();
    fs::set_permissions(&executable, fs::Permissions::from_mode(0o700)).unwrap();
    let command = wsl_command(executable.to_str().unwrap(), "Ubuntu's $name").unwrap();
    let result = Command::new("sh")
        .args(["-c", &command])
        .env("CODEX_HOME", "/home/a/custom's $config")
        .output()
        .unwrap();
    assert!(result.status.success(), "{result:?}");
    assert_eq!(
        String::from_utf8(result.stdout)
            .unwrap()
            .split_terminator('\0')
            .collect::<Vec<_>>(),
        [
            "--register-codex-mcp",
            "--wsl",
            "Ubuntu's $name",
            "--codex-home",
            "/home/a/custom's $config"
        ]
    );
    fs::remove_dir_all(dir).unwrap();
}
