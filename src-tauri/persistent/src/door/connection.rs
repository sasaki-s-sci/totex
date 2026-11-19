//! A registration survives restarts without inheriting a terminal's environment.

use std::io::{Read, Write};
use std::path::Path;

pub fn url() -> Result<String, String> {
    Ok(format!(
        "http://{}:{}/mcp/{}",
        super::LOOPBACK,
        super::DOOR,
        credential()?
    ))
}

pub(super) fn credential() -> Result<String, String> {
    let home = totex_host::fs_browse::home_dir().ok_or("Home directory is unavailable")?;
    load(&home.join(".totex").join("mcp-token"))
}

pub(super) fn fresh() -> Result<String, String> {
    let mut bytes = [0; 32];
    getrandom::fill(&mut bytes)
        .map_err(|error| format!("Could not generate the MCP credential: {error}"))?;
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

fn load(path: &Path) -> Result<String, String> {
    std::fs::create_dir_all(path.parent().ok_or("Invalid MCP credential path")?)
        .map_err(|error| format!("Could not create the MCP credential directory: {error}"))?;
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let token = if path.exists() { None } else { Some(fresh()?) };
    match options.open(path) {
        Ok(mut file) => {
            let token = token.map(Ok).unwrap_or_else(fresh)?;
            file.write_all(token.as_bytes())
                .and_then(|()| file.sync_all())
                .map_err(|error| format!("Could not save the MCP credential: {error}"))?;
            Ok(token)
        }
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
            let metadata = std::fs::symlink_metadata(path)
                .map_err(|error| format!("Could not read the MCP credential: {error}"))?;
            if !metadata.is_file() {
                return Err("The MCP credential must be a regular file".into());
            }
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                if metadata.permissions().mode() & 0o077 != 0 {
                    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))
                        .map_err(|error| {
                            format!("Could not protect the MCP credential: {error}")
                        })?;
                }
            }
            let mut token = String::new();
            std::fs::File::open(path)
                .and_then(|file| file.take(65).read_to_string(&mut token))
                .map_err(|error| format!("Could not read the MCP credential: {error}"))?;
            if token.len() != 64 || !token.bytes().all(|byte| byte.is_ascii_hexdigit()) {
                return Err("The saved MCP credential is invalid; it was left unchanged".into());
            }
            Ok(token)
        }
        Err(error) => Err(format!("Could not save the MCP credential: {error}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tests::TempDir;

    #[test]
    fn a_registration_keeps_its_credential_across_restarts() {
        let temp = TempDir::new("mcp-credential");
        let path = temp.path().join("mcp-token");
        let token = load(&path).unwrap();
        assert_eq!(token.len(), 64);
        assert_eq!(load(&path).unwrap(), token);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                std::fs::metadata(path).unwrap().permissions().mode() & 0o777,
                0o600
            );
        }
    }

    #[test]
    fn a_damaged_credential_is_not_silently_replaced() {
        let temp = TempDir::new("mcp-bad-credential");
        let path = temp.path().join("mcp-token");
        std::fs::write(&path, "damaged").unwrap();
        assert!(load(&path).is_err());
        assert_eq!(std::fs::read_to_string(path).unwrap(), "damaged");
    }

    #[cfg(unix)]
    #[test]
    fn a_credential_symlink_is_not_followed() {
        let temp = TempDir::new("mcp-linked-credential");
        let real = temp.path().join("real");
        std::fs::write(&real, fresh().unwrap()).unwrap();
        let link = temp.path().join("mcp-token");
        std::os::unix::fs::symlink(&real, &link).unwrap();
        assert!(load(&link).is_err());
    }
}
