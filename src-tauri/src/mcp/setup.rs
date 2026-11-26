use serde::Serialize;
use totex_host::{host::Host, remote::quote, wsl};

#[derive(Debug, Serialize)]
pub struct Prepared {
    pub commands: Commands,
    pub environment: String,
}

#[derive(Debug, Serialize)]
pub struct Commands {
    pub codex: String,
    pub claude: String,
    pub opencode: String,
}

pub fn prepare(cwd: &str, _port: u16) -> Result<Prepared, String> {
    let executable = std::env::current_exe().map_err(|error| error.to_string())?;
    let executable = executable
        .to_str()
        .ok_or("The totex path is not valid UTF-8.")?;
    match Host::of_str(cwd) {
        Host::Local => Ok(Prepared {
            commands: commands(executable, cfg!(windows), None)?,
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
                commands: commands(&said.text(), false, Some(&distro))?,
                environment: format!("WSL · {distro}"),
            })
        }
        Host::Ssh(_) => Err(
            "MCP setup is unavailable for SSH terminals: the remote host cannot reach totex's local server."
                .into(),
        ),
    }
}

fn commands(executable: &str, windows: bool, distro: Option<&str>) -> Result<Commands, String> {
    let codex = match distro {
        Some(distro) => wsl_command(executable, distro)?,
        None => local_command(executable, windows)?,
    };
    let relay = if distro.is_some() {
        // WSL interop does not forward arbitrary environment variables to Windows.
        format!(
            "sh -c 'exec \"$1\" --mcp-stdio \"$TOTEX_MCP_URL\"' sh {}",
            quote(executable)
        )
    } else if windows {
        format!("'{}' --mcp-stdio", executable.replace('\'', "''"))
    } else {
        format!("{} --mcp-stdio", quote(executable))
    };
    Ok(Commands {
        codex,
        claude: format!(
            "claude mcp remove --scope user totex\nclaude mcp add --scope user --transport stdio totex -- {relay}"
        ),
        opencode: format!("opencode mcp add totex -- {relay}"),
    })
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
