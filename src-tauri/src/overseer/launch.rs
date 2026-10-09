//! What starting an overseer leaves behind in the folder it is started in, and
//! the line typed to start it.
//!
//! The overseer is an agent like any other, run in a shell like any other, so
//! it is started the way somebody would start one by hand: with a file saying
//! where its server is, a file saying what it is for, and a command line. All
//! three are written into the folder's own `.totex`, beside whatever else the
//! folder keeps there, where the agent can read them with a relative path
//! whatever shell it is in and whichever machine the folder is on.

use std::path::Path;

use serde_json::json;

use crate::host::Host;

/// Prepare a private Linux directory, using the distribution's login PATH.
/// The MCP listener stays on Windows loopback, so mirrored networking is
/// required. Fail before opening a terminal if the CLI or route is unavailable.
pub fn wsl_directory(distro: &str) -> Result<String, String> {
    let output = crate::wsl::exec(distro, None, &[], &["bash", "-lc", WSL_PREPARE])?;
    wsl_directory_output(distro, output)
}

const WSL_PREPARE: &str = r#"
command -v claude >/dev/null || { echo 'Claude Code was not found in the WSL login PATH. Install and sign in inside this distribution.' >&2; exit 1; }
test "$(wslinfo --networking-mode 2>/dev/null)" = mirrored || { echo 'WSL monitoring requires mirrored networking. Set networkingMode=mirrored under [wsl2] in %UserProfile%/.wslconfig, then restart WSL.' >&2; exit 1; }
test -n "$HOME" && test "${HOME#/}" != "$HOME" || exit 1
dir="$HOME/.local/share/totex/windows-overseer"
mkdir -p -- "$dir" && chmod 700 -- "$dir" || exit 1
printf '%s' "$dir"
"#;

fn wsl_directory_output(distro: &str, output: crate::remote::Output) -> Result<String, String> {
    if !output.ok() {
        let message = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(format!(
            "{distro}: {}",
            if message.is_empty() {
                "Could not prepare WSL monitoring"
            } else {
                &message
            }
        ));
    }
    let native = output.text();
    if !native.starts_with('/') || native.contains(['\n', '\r', '\0']) {
        return Err(format!("{distro}: Invalid WSL monitoring directory"));
    }
    Ok(crate::wsl::unc(distro, &native))
}

/// Where under the folder the files go.
pub const DIR: &str = "overseer";

/// What the overseer is told to do, word for word.
pub const PROMPT: &str = include_str!("prompt.md");

/// The name the server is registered under, which is also the prefix of every
/// one of its tools in the agent's own permission rules.
pub const SERVER: &str = "totex-overseer";

/// The size the overseer's shell is opened at, before any terminal is drawn
/// for it: the same a window opens any shell at — see `src/lib/pty.ts`.
pub const ROWS: u16 = 24;
pub const COLS: u16 = 80;

/// The line typed into the shell.
///
/// The prompt comes first: `--mcp-config` and `--allowedTools` each take as
/// many words as follow them, and a prompt written after either would be read
/// as one more config file or one more tool. Double quotes and forward slashes
/// only, which bash, PowerShell and cmd all read the same way. The tools are
/// allowed up front because the whole of the overseer's work is calling them
/// over and over, and a loop that stops to ask permission for each call is not
/// a loop.
pub fn command() -> String {
    format!(
        "claude \"Read .totex/{DIR}/prompt.md and follow it.\" --mcp-config .totex/{DIR}/mcp.json --allowedTools mcp__{SERVER}\r"
    )
}

/// How the agent is to reach the server.
pub fn config(port: u16, token: &str) -> String {
    let config = json!({
        "mcpServers": {
            SERVER: {
                "type": "http",
                "url": format!("http://127.0.0.1:{port}/mcp"),
                "headers": { "Authorization": format!("Bearer {token}") },
            }
        }
    });
    let mut text = serde_json::to_string_pretty(&config).unwrap_or_default();
    text.push('\n');
    text
}

/// Writes the files into `cwd`, in place of whatever was there.
///
/// Beside them goes a `.gitignore` that ignores the lot: the config holds the
/// token, and a token committed to a repository is a token handed to whoever
/// can read it.
pub fn write(cwd: &str, port: u16, token: &str) -> Result<(), String> {
    let host = Host::of_str(cwd);
    let space = host.join(Path::new(cwd), totex_host::space::DIR);
    let dir = host.join(&space, DIR);
    host.create_dir_all(&dir)?;
    for (name, text) in [
        (".gitignore", "*\n".to_string()),
        ("mcp.json", config(port, token)),
        ("prompt.md", PROMPT.to_string()),
    ] {
        let file = host.join(&dir, name);
        match host.stat(&file) {
            Some(stat) => host.write(&file, &text, stat.size).map(|_| ())?,
            None => host.write_new(&file, text.as_bytes())?,
        }
    }
    Ok(())
}

#[cfg(test)]
mod wsl_tests {
    use super::*;

    #[test]
    fn linux_directory_routes_the_terminal_and_files_to_the_selected_distribution() {
        let cwd = wsl_directory_output(
            "Ubuntu",
            crate::remote::Output {
                code: 0,
                stdout: b"/home/a user/.local/share/totex/windows-overseer".to_vec(),
                stderr: vec![],
            },
        )
        .unwrap();
        assert_eq!(Host::of_str(&cwd), Host::Wsl("Ubuntu".into()));
        assert_eq!(
            Host::of_str(&cwd).native(Path::new(&cwd)),
            "/home/a user/.local/share/totex/windows-overseer"
        );
    }

    #[test]
    fn missing_cli_or_networking_does_not_become_a_directory() {
        let error = wsl_directory_output(
            "Ubuntu",
            crate::remote::Output {
                code: 1,
                stdout: vec![],
                stderr: b"Claude Code was not found".to_vec(),
            },
        )
        .unwrap_err();
        assert_eq!(error, "Ubuntu: Claude Code was not found");
        for path in ["", "C:\\Users\\a", "login banner\n/home/a", "/home/a\n"] {
            assert!(
                wsl_directory_output(
                    "Ubuntu",
                    crate::remote::Output {
                        code: 0,
                        stdout: path.as_bytes().to_vec(),
                        stderr: vec![],
                    }
                )
                .is_err()
            );
        }
    }
}
