use serde::Serialize;
use totex_host::{host::Host, remote::quote, wsl};

#[derive(Debug, Serialize)]
pub struct Prepared {
    pub command: String,
    pub environment: String,
}

pub fn prepare(cwd: &str, _port: u16) -> Result<Prepared, String> {
    let executable = std::env::current_exe().map_err(|error| error.to_string())?;
    let executable = executable
        .to_str()
        .ok_or("The totex path is not valid UTF-8.")?;
    match Host::of_str(cwd) {
        Host::Local => Ok(Prepared {
            command: local_command(executable, cfg!(windows))?,
            environment: match std::env::consts::OS {
                "windows" => "Windows",
                "macos" => "macOS",
                "linux" => "Linux",
                other => other,
            }.into(),
        }),
        Host::Wsl(distro) => {
            let said = wsl::script(
                &distro,
                None,
                r#"p=$(wslpath -u "$1") && test -x "$p" && printf '%s' "$p""#,
                &[executable],
            )?;
            if !said.ok() {
                return Err(format!("{distro}: totex cannot run through WSL interop."));
            }
            Ok(Prepared {
                command: wsl_command(&said.text(), &distro)?,
                environment: format!("WSL · {distro}"),
            })
        }
        Host::Ssh(_) => Err(
            "MCP setup is unavailable for SSH terminals: the remote host cannot reach totex's local server."
                .into(),
        ),
    }
}

fn clean(value: &str) -> Result<(), String> {
    if value.is_empty() || value.contains(['\n', '\r', '\0']) {
        return Err("The registration command contains an invalid path or distribution.".into());
    }
    Ok(())
}

fn local_command(executable: &str, windows: bool) -> Result<String, String> {
    clean(executable)?;
    if windows {
        let path = executable.as_bytes();
        let drive = path.len() >= 3
            && path[0].is_ascii_alphabetic()
            && path[1] == b':'
            && matches!(path[2], b'\\' | b'/');
        if !(drive || executable.starts_with(r"\\")) {
            return Err("The totex executable path must be absolute.".into());
        }
        Ok(format!(
            "& '{}' --register-codex-mcp | Out-Host",
            executable.replace('\'', "''")
        ))
    } else {
        if !executable.starts_with('/') {
            return Err("The totex executable path must be absolute.".into());
        }
        Ok(format!("{} --register-codex-mcp", quote(executable)))
    }
}

fn wsl_command(executable: &str, distro: &str) -> Result<String, String> {
    clean(distro)?;
    Ok(format!(
        "{} --wsl {} --codex-home \"${{CODEX_HOME:-$HOME/.codex}}\"",
        local_command(executable, false)?,
        quote(distro),
    ))
}

#[cfg(test)]
mod tests;
