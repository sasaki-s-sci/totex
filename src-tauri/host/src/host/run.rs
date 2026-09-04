//! Running one program on the machine a path is on.

use std::path::Path;

use super::{Host, Output};
use crate::wsl;

impl Host {
    /// Runs one program and waits for it.
    pub fn exec(
        &self,
        cwd: Option<&Path>,
        env: &[(&str, &str)],
        argv: &[&str],
    ) -> Result<Output, String> {
        match self {
            Self::Local => local_exec(cwd, env, argv),
            Self::Wsl(distro) => {
                let cwd = cwd.map(|cwd| self.native(cwd));
                let output = wsl::exec(distro, cwd.as_deref(), env, argv)?;
                Ok(Output {
                    code: output.code,
                    stdout: output.stdout,
                    stderr: output.stderr,
                })
            }
        }
    }
}

fn local_exec(cwd: Option<&Path>, env: &[(&str, &str)], argv: &[&str]) -> Result<Output, String> {
    let Some((program, arguments)) = argv.split_first() else {
        return Err("no-command".to_string());
    };
    let mut command = std::process::Command::new(program);
    command.args(arguments);
    if let Some(cwd) = cwd {
        command.current_dir(cwd);
    }
    for (name, value) in env {
        command.env(name, value);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    let output = command.output().map_err(|error| match error.kind() {
        std::io::ErrorKind::NotFound => "not-found".to_string(),
        _ => error.to_string(),
    })?;
    Ok(Output {
        code: output.status.code().unwrap_or(-1),
        stdout: output.stdout,
        stderr: output.stderr,
    })
}
