//! Reading and writing one file, and the directories around it.

use std::path::{Path, PathBuf};

use super::Host;
use super::script::{HEAD, PUT, WRITE};
use crate::wsl;

impl Host {
    /// The whole of one file, for an explicit copy or download.
    pub fn read(&self, path: &Path) -> Result<Vec<u8>, String> {
        match self {
            Self::Local => std::fs::read(path).map_err(|error| error.to_string()),
            Self::Wsl(distro) => {
                let output = wsl::exec(distro, None, &[], &["cat", "--", &self.native(path)])?;
                if output.ok() {
                    Ok(output.stdout)
                } else {
                    Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
                }
            }
        }
    }

    /// The first `limit` bytes of a file, and how long the whole of it is.
    pub fn read_head(&self, path: &Path, limit: u64) -> Result<(Vec<u8>, u64), String> {
        match self {
            Self::Local => {
                use std::io::Read;
                let metadata = std::fs::metadata(path).map_err(|error| error.to_string())?;
                if metadata.is_dir() {
                    return Err("is-a-directory".to_string());
                }
                let file = std::fs::File::open(path).map_err(|error| error.to_string())?;
                let mut bytes = Vec::new();
                file.take(limit)
                    .read_to_end(&mut bytes)
                    .map_err(|error| error.to_string())?;
                Ok((bytes, metadata.len()))
            }
            Self::Wsl(distro) => {
                let limit = limit.to_string();
                let output = wsl::script(distro, None, HEAD, &[&self.native(path), &limit])?;
                match output.code {
                    0 => {}
                    3 => return Err("is-a-directory".to_string()),
                    _ => return Err(String::from_utf8_lossy(&output.stderr).trim().to_string()),
                }
                // The size comes first on a line of its own, then the bytes.
                let cut = output
                    .stdout
                    .iter()
                    .position(|byte| *byte == b'\n')
                    .ok_or("unreadable")?;
                let size: u64 = String::from_utf8_lossy(&output.stdout[..cut])
                    .trim()
                    .parse()
                    .map_err(|_| "unreadable".to_string())?;
                Ok((output.stdout[cut + 1..].to_vec(), size))
            }
        }
    }

    /// Writes a file in place, refusing when it is no longer `expect` bytes long
    /// — see [`crate::fs_browse::write_file`], which is what this is for.
    pub fn write(&self, path: &Path, text: &str, expect: u64) -> Result<u64, String> {
        match self {
            Self::Local => {
                std::fs::write(path, text).map_err(|error| error.to_string())?;
                Ok(text.len() as u64)
            }
            Self::Wsl(distro) => {
                let expect = expect.to_string();
                // The bytes ride inside the command rather than down the
                // channel's own pipe: a command reads nothing, so one waiting on
                // input cannot hold up everything queued behind it.
                let payload = wsl::encode(text.as_bytes());
                let output = wsl::script(
                    distro,
                    None,
                    WRITE,
                    &[&self.native(path), &expect, &payload],
                )?;
                match output.code {
                    0 => Ok(text.len() as u64),
                    3 => Err("is-a-directory".to_string()),
                    4 => Err("changed".to_string()),
                    _ => Err(String::from_utf8_lossy(&output.stderr).trim().to_string()),
                }
            }
        }
    }

    pub fn create_dir_all(&self, path: &Path) -> Result<(), String> {
        match self {
            Self::Local => std::fs::create_dir_all(path).map_err(|error| error.to_string()),
            Self::Wsl(distro) => {
                let output = wsl::exec(distro, None, &[], &["mkdir", "-p", &self.native(path)])?;
                if output.ok() {
                    Ok(())
                } else {
                    Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
                }
            }
        }
    }

    /// Creates exactly one empty file, refusing to replace anything there.
    pub fn create_file(&self, path: &Path) -> Result<(), String> {
        match self {
            Self::Local => std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(path)
                .map(|_| ())
                .map_err(|error| error.to_string()),
            Self::Wsl(distro) => {
                let native = self.native(path);
                let output = wsl::exec(
                    distro,
                    None,
                    &[],
                    &[
                        "sh",
                        "-c",
                        "test ! -e \"$1\" && test ! -L \"$1\" && : > \"$1\"",
                        "sh",
                        &native,
                    ],
                )?;
                output
                    .ok()
                    .then_some(())
                    .ok_or_else(|| "already-exists".to_string())
            }
        }
    }

    /// Creates exactly one directory, refusing to reuse one already there.
    pub fn create_dir(&self, path: &Path) -> Result<(), String> {
        match self {
            Self::Local => std::fs::create_dir(path).map_err(|error| error.to_string()),
            Self::Wsl(distro) => {
                let output = wsl::exec(distro, None, &[], &["mkdir", "--", &self.native(path)])?;
                if output.ok() {
                    Ok(())
                } else {
                    Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
                }
            }
        }
    }

    pub fn copy_file(&self, from: &Path, to: &Path) -> Result<(), String> {
        match self {
            Self::Local => {
                let mut source = std::fs::File::open(from).map_err(|error| error.to_string())?;
                let mut destination = std::fs::OpenOptions::new()
                    .write(true)
                    .create_new(true)
                    .open(to)
                    .map_err(|error| error.to_string())?;
                std::io::copy(&mut source, &mut destination)
                    .map(|_| ())
                    .map_err(|error| error.to_string())
            }
            Self::Wsl(distro) => {
                let from = self.native(from);
                let to = self.native(to);
                let output = wsl::exec(
                    distro,
                    None,
                    &[],
                    &[
                        "sh",
                        "-c",
                        "test ! -e \"$2\" && test ! -L \"$2\" && cp -- \"$1\" \"$2\"",
                        "sh",
                        &from,
                        &to,
                    ],
                )?;
                if output.ok() {
                    Ok(())
                } else {
                    Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
                }
            }
        }
    }

    /// Writes bytes to a file that is not there, refusing to replace one that
    /// is.
    ///
    /// What [`copy_file`](Self::copy_file) is when the two ends are on
    /// different machines: the bytes have already been read out of the far one,
    /// and this is the half that puts them down. Whole rather than in pieces,
    /// because a command is one crossing and a file arriving in fragments would
    /// be one per fragment — see `fs_browse::copy`, which is what decides that
    /// a copy has to come this way at all.
    pub fn write_new(&self, path: &Path, bytes: &[u8]) -> Result<(), String> {
        match self {
            Self::Local => {
                use std::io::Write;
                let mut file = std::fs::OpenOptions::new()
                    .write(true)
                    .create_new(true)
                    .open(path)
                    .map_err(|error| error.to_string())?;
                file.write_all(bytes).map_err(|error| error.to_string())
            }
            Self::Wsl(distro) => {
                let payload = wsl::encode(bytes);
                let output = wsl::script(distro, None, PUT, &[&self.native(path), &payload])?;
                match output.code {
                    0 => Ok(()),
                    3 => Err("already-exists".to_string()),
                    _ => Err(String::from_utf8_lossy(&output.stderr).trim().to_string()),
                }
            }
        }
    }

    /// Removes one path and everything under it, saying nothing about how it
    /// went.
    ///
    /// The sweep after a copy that failed part way, which is the only thing that
    /// asks for this: what is being removed is what this program was in the
    /// middle of writing, and the error worth answering with is the one that
    /// stopped it rather than anything about the tidying up. Nothing else in the
    /// app removes a directory — see [`remove_file`](Self::remove_file), which
    /// refuses one.
    pub fn remove_all(&self, path: &Path) {
        match self {
            Self::Local => {
                let _ = std::fs::remove_file(path);
                let _ = std::fs::remove_dir_all(path);
            }
            Self::Wsl(distro) => {
                let _ = wsl::exec(distro, None, &[], &["rm", "-rf", "--", &self.native(path)]);
            }
        }
    }

    pub fn rename(&self, from: &Path, to: &Path) -> Result<(), String> {
        match self {
            Self::Local => std::fs::rename(from, to).map_err(|error| error.to_string()),
            Self::Wsl(distro) => {
                let output = wsl::exec(
                    distro,
                    None,
                    &[],
                    &["mv", "--", &self.native(from), &self.native(to)],
                )?;
                if output.ok() {
                    Ok(())
                } else {
                    Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
                }
            }
        }
    }

    pub fn remove_file(&self, path: &Path) -> Result<(), String> {
        match self {
            Self::Local => std::fs::remove_file(path).map_err(|error| error.to_string()),
            Self::Wsl(distro) => {
                let output = wsl::exec(distro, None, &[], &["rm", "--", &self.native(path)])?;
                if output.ok() {
                    Ok(())
                } else {
                    Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
                }
            }
        }
    }

    /// The home directory on the machine the path is on.
    pub fn home(&self) -> Option<PathBuf> {
        match self {
            Self::Local => crate::fs_browse::home_dir(),
            Self::Wsl(distro) => {
                let output =
                    wsl::exec(distro, None, &[], &["sh", "-c", "printf %s \"$HOME\""]).ok()?;
                let home = output.text();
                (!home.trim().is_empty()).then(|| self.canonical(home.trim()))
            }
        }
    }

    /// The path with every link along it followed, or `None` when it is not
    /// there. What `canonicalize` is on this machine.
    pub fn resolve(&self, path: &Path) -> Option<PathBuf> {
        match self {
            Self::Local => path.canonicalize().ok(),
            Self::Wsl(distro) => {
                let output = wsl::exec(
                    distro,
                    None,
                    &[],
                    &["readlink", "-f", "--", &self.native(path)],
                )
                .ok()?;
                let resolved = output.text();
                let resolved = resolved.trim();
                (output.ok() && !resolved.is_empty()).then(|| self.canonical(resolved))
            }
        }
    }
}
