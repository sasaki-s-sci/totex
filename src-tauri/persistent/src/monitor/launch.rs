//! Where an observer runs: a private folder on the terminal's host, a check
//! that the agent is installed there, and the process started inside it.
use std::{
    hash::{Hash, Hasher},
    path::PathBuf,
    process::{Command, ExitStatus, Stdio},
    sync::atomic::{AtomicBool, Ordering},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use tokio::io::AsyncWriteExt;
use totex_host::{host::Host, remote};

/// The directory belongs to one observation, including failed/cancelled turns.
/// No project instructions or project MCP configuration are loaded from it.
pub(super) struct Workspace {
    host: Host,
    directory: PathBuf,
}

impl Drop for Workspace {
    fn drop(&mut self) {
        let Some(reach) = self.host.reach() else {
            let _ = std::fs::remove_dir_all(&self.directory);
            return;
        };
        let directory = self.directory.to_string_lossy().into_owned();
        // Drop also runs during timeout cancellation. Do not block the runtime
        // on a disconnected SSH host while reclaiming our own transient folder.
        let _ = std::thread::Builder::new()
            .name("monitor-cleanup".into())
            .spawn(move || {
                let mut command = reach.command(&["rm", "-rf", "--", &directory]);
                command
                    .stdin(Stdio::null())
                    .stdout(Stdio::null())
                    .stderr(Stdio::null());
                let Ok(mut child) = command.spawn() else {
                    return;
                };
                for _ in 0..100 {
                    if !matches!(child.try_wait(), Ok(None)) {
                        return;
                    }
                    std::thread::sleep(Duration::from_millis(100));
                }
                let _ = child.kill();
                let _ = child.wait();
            });
    }
}

fn missing(program: &str, environment: &str) -> String {
    format!("{program} is not installed on {environment}")
}

/// One PowerShell word. Windows PowerShell 5.1 re-quotes native arguments
/// itself and drops empty ones and bare double quotes on the way, so those
/// are escaped for the command line it builds.
fn powershell_quote(value: &str, native_argument: bool) -> String {
    if native_argument && value.is_empty() {
        return "'\"\"'".into();
    }
    let value = if native_argument {
        value.replace('"', "\\\"")
    } else {
        value.to_owned()
    };
    format!("'{}'", value.replace('\'', "''"))
}

fn powershell(script: String) -> Command {
    let mut command = Command::new("powershell.exe");
    command.args([
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        &script,
    ]);
    command
}

/// Whether a login shell on this machine finds `program`, the same way the
/// launch line below looks for it.
async fn installed_here(program: &str) -> Result<bool, String> {
    let command = if cfg!(windows) {
        powershell(format!(
            "if (Get-Command -Name {} -ErrorAction SilentlyContinue) {{ exit 0 }} else {{ exit 127 }}",
            powershell_quote(program, false)
        ))
    } else {
        let mut command = Command::new("sh");
        command.args(["-lc", "command -v \"$1\" >/dev/null 2>&1", "sh", program]);
        command
    };
    let mut command = tokio::process::Command::from(command);
    command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    let status = command.status().await.map_err(|e| e.to_string())?;
    Ok(status.success())
}

impl Workspace {
    /// Creates a private folder for one run on `host`, writes `files` into it
    /// and checks that `program` is installed there. A missing agent is named
    /// here rather than surfacing as a closed pipe from the agent's protocol.
    pub async fn prepare(
        host: &Host,
        environment: &str,
        program: &str,
        files: &[(&str, &str)],
    ) -> Result<Self, String> {
        let mut hash = std::collections::hash_map::DefaultHasher::new();
        format!("{host:?}").hash(&mut hash);
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let suffix = format!(
            "totex/monitor/{:016x}/{}-{nonce}",
            hash.finish(),
            std::process::id()
        );
        if let Some(reach) = host.reach() {
            let mut script = format!(
                "command -v {} >/dev/null 2>&1 || {{ printf totex-missing; exit 127; }}; umask 077; dir=\"$HOME/.local/share/{suffix}\"; mkdir -p \"$dir\" || exit 1; ",
                remote::quote(program)
            );
            for (name, contents) in files {
                script.push_str(&format!(
                    "printf '%s' {} > \"$dir\"/{} || exit 1; ",
                    remote::quote(contents),
                    remote::quote(name)
                ));
            }
            script.push_str("printf '%s' \"$dir\"");
            let mut command = tokio::process::Command::from(reach.command(&["sh", "-lc", &script]));
            command.stdin(Stdio::null()).kill_on_drop(true);
            let output = command
                .output()
                .await
                .map_err(|e| format!("Cannot reach {environment}: {e}"))?;
            let stdout = String::from_utf8_lossy(&output.stdout);
            if stdout.contains("totex-missing") {
                return Err(missing(program, environment));
            }
            if !output.status.success() {
                return Err(format!(
                    "Monitor folder on {environment}: {}",
                    trimmed_tail(&String::from_utf8_lossy(&output.stderr), 600)
                ));
            }
            if !stdout.starts_with('/') || stdout.contains('\n') {
                return Err("Invalid remote monitor directory".into());
            }
            return Ok(Self {
                host: host.clone(),
                directory: PathBuf::from(stdout.into_owned()),
            });
        }
        if !installed_here(program).await? {
            return Err(missing(program, environment));
        }
        #[cfg(not(test))]
        let home = std::env::var_os(if cfg!(windows) {
            "LOCALAPPDATA"
        } else {
            "HOME"
        })
        .ok_or("Monitor home is unavailable")?;
        #[cfg(test)]
        let home = std::env::temp_dir().into_os_string();
        let directory = if cfg!(windows) {
            PathBuf::from(home).join(&suffix)
        } else {
            PathBuf::from(home).join(".local/share").join(&suffix)
        };
        std::fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
        let workspace = Self {
            host: Host::Local,
            directory,
        };
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&workspace.directory, std::fs::Permissions::from_mode(0o700))
                .map_err(|e| e.to_string())?;
        }
        for (name, contents) in files {
            std::fs::write(workspace.directory.join(name), contents).map_err(|e| e.to_string())?;
        }
        Ok(workspace)
    }

    pub fn directory(&self) -> &PathBuf {
        &self.directory
    }

    /// `argv` started inside the folder on the folder's host: through a login
    /// shell on Unix, SSH and WSL, and through PowerShell on Windows, so that
    /// the agent is found where the user installed it. Words are quoted one
    /// by one; nothing in `argv` is read by a shell.
    pub fn command(&self, argv: &[&str]) -> Command {
        let directory = self.directory.to_string_lossy();
        if cfg!(windows) && self.host.reach().is_none() {
            let words = argv
                .iter()
                .enumerate()
                .map(|(at, word)| powershell_quote(word, at > 0))
                .collect::<Vec<_>>()
                .join(" ");
            return powershell(format!(
                "Set-Location -LiteralPath {}; & {words}; exit $LASTEXITCODE",
                powershell_quote(&directory, false)
            ));
        }
        let line = format!(
            "cd {} && exec {}",
            remote::quote(&directory),
            argv.iter()
                .map(|word| remote::quote(word))
                .collect::<Vec<_>>()
                .join(" ")
        );
        match self.host.reach() {
            Some(reach) => reach.command(&["sh", "-lc", &line]),
            None => {
                let mut command = Command::new("sh");
                command.args(["-lc", &line]);
                command
            }
        }
    }
}

pub(super) async fn flagged(flag: &AtomicBool) {
    while !flag.load(Ordering::Acquire) {
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
}

/// What a finished process said.
pub(super) struct Output {
    pub status: ExitStatus,
    pub stdout: String,
    pub stderr: String,
}

/// Runs a process to its end with `input` on stdin. Dropping the future kills
/// the process, which is how cancellation and timeouts stop it.
pub(super) async fn run(command: Command, input: &str) -> Result<Output, String> {
    let mut command = tokio::process::Command::from(command);
    command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    let mut child = command.spawn().map_err(|e| e.to_string())?;
    let mut stdin = child.stdin.take().ok_or("Observer stdin is unavailable")?;
    let input = input.as_bytes().to_vec();
    let write = async move {
        // A process that exits without reading reports why on stderr.
        let _ = stdin.write_all(&input).await;
        let _ = stdin.shutdown().await;
    };
    let (_, output) = tokio::join!(write, child.wait_with_output());
    let output = output.map_err(|e| e.to_string())?;
    Ok(Output {
        status: output.status,
        stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
        stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
    })
}

/// The end of a message, which is where a failing CLI says why.
pub(super) fn trimmed_tail(text: &str, length: usize) -> String {
    let text = text.trim();
    let count = text.chars().count();
    text.chars().skip(count.saturating_sub(length)).collect()
}

/// Why a process failed, in its own words when it gave any.
pub(super) fn failure(output: &Output, program: &str) -> String {
    for text in [&output.stderr, &output.stdout] {
        if !text.trim().is_empty() {
            return trimmed_tail(text, 600);
        }
    }
    format!("{program} exited with {}", output.status)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn powershell_words_survive_windows_powershell_argument_passing() {
        assert_eq!(powershell_quote("", true), "'\"\"'");
        assert_eq!(powershell_quote("", false), "''");
        assert_eq!(
            powershell_quote(r#"{"type":"it's"}"#, true),
            r#"'{\"type\":\"it''s\"}'"#
        );
        assert_eq!(powershell_quote("C:\\a b", false), "'C:\\a b'");
    }

    #[test]
    fn failure_text_is_the_bounded_tail() {
        assert_eq!(trimmed_tail("  abc日本  \n", 2), "日本");
        assert_eq!(trimmed_tail("abc", 10), "abc");
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn a_missing_program_is_named_with_its_environment() {
        let error = Workspace::prepare(&Host::Local, "Local", "totex-no-such-agent", &[])
            .await
            .err()
            .unwrap();
        assert_eq!(error, "totex-no-such-agent is not installed on Local");
    }
}
