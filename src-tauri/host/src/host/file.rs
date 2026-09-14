//! Reading and writing one file, and the directories around it.

use std::path::{Path, PathBuf};

use super::script::{HEAD, PUT, WRITE};
use super::{Host, said};
use crate::base64;

impl Host {
    /// The whole of one file, for an explicit copy or download.
    pub fn read(&self, path: &Path) -> Result<Vec<u8>, String> {
        match self {
            Self::Local => std::fs::read(path).map_err(|error| error.to_string()),
            Self::Wsl(_) | Self::Ssh(_) => {
                let output = self.remote_exec(None, &[], &["cat", "--", &self.native(path)])?;
                if output.ok() {
                    Ok(output.stdout)
                } else {
                    Err(said(&output))
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
            Self::Wsl(_) | Self::Ssh(_) => {
                let limit = limit.to_string();
                let output = self.remote_script(HEAD, &[&self.native(path), &limit])?;
                match output.code {
                    0 => {}
                    3 => return Err("is-a-directory".to_string()),
                    _ => return Err(said(&output)),
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
            Self::Wsl(_) | Self::Ssh(_) => {
                let expect = expect.to_string();
                // The bytes ride inside the command rather than down the
                // channel's own pipe: a command reads nothing, so one waiting on
                // input cannot hold up everything queued behind it.
                let payload = base64::encode(text.as_bytes());
                let output = self.remote_script(WRITE, &[&self.native(path), &expect, &payload])?;
                match output.code {
                    0 => Ok(text.len() as u64),
                    3 => Err("is-a-directory".to_string()),
                    4 => Err("changed".to_string()),
                    _ => Err(said(&output)),
                }
            }
        }
    }

    pub fn create_dir_all(&self, path: &Path) -> Result<(), String> {
        match self {
            Self::Local => std::fs::create_dir_all(path).map_err(|error| error.to_string()),
            Self::Wsl(_) | Self::Ssh(_) => self.remote_run(&["mkdir", "-p", &self.native(path)]),
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
            Self::Wsl(_) | Self::Ssh(_) => {
                let native = self.native(path);
                let output = self.remote_exec(
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
            Self::Wsl(_) | Self::Ssh(_) => self.remote_run(&["mkdir", "--", &self.native(path)]),
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
            Self::Wsl(_) | Self::Ssh(_) => self.remote_run(&[
                "sh",
                "-c",
                "test ! -e \"$2\" && test ! -L \"$2\" && cp -- \"$1\" \"$2\"",
                "sh",
                &self.native(from),
                &self.native(to),
            ]),
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
            Self::Wsl(_) | Self::Ssh(_) => {
                let payload = base64::encode(bytes);
                let output = self.remote_script(PUT, &[&self.native(path), &payload])?;
                match output.code {
                    0 => Ok(()),
                    3 => Err("already-exists".to_string()),
                    _ => Err(said(&output)),
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
    /// stopped it rather than anything about the tidying up. A folder somebody
    /// asked for the removal of goes through
    /// [`remove_dir_all`](Self::remove_dir_all) instead, which answers.
    pub fn remove_all(&self, path: &Path) {
        match self {
            Self::Local => {
                let _ = std::fs::remove_file(path);
                let _ = std::fs::remove_dir_all(path);
            }
            Self::Wsl(_) | Self::Ssh(_) => {
                let _ = self.remote_exec(None, &[], &["rm", "-rf", "--", &self.native(path)]);
            }
        }
    }

    pub fn rename(&self, from: &Path, to: &Path) -> Result<(), String> {
        match self {
            Self::Local => std::fs::rename(from, to).map_err(|error| error.to_string()),
            Self::Wsl(_) | Self::Ssh(_) => {
                self.remote_run(&["mv", "--", &self.native(from), &self.native(to)])
            }
        }
    }

    pub fn remove_file(&self, path: &Path) -> Result<(), String> {
        match self {
            Self::Local => std::fs::remove_file(path).map_err(|error| error.to_string()),
            Self::Wsl(_) | Self::Ssh(_) => self.remote_run(&["rm", "--", &self.native(path)]),
        }
    }

    /// Removes one directory and everything under it, and says how it went.
    ///
    /// One command however much is under it, on either machine: the machine
    /// holding the folder already knows how to take a tree apart, and a walk
    /// driven from here would be one crossing per file on a far machine. What
    /// [`remove_all`](Self::remove_all) is when somebody is waiting for the
    /// answer — which is every time a person asked for the removal.
    ///
    /// A folder that is not there is an error rather than a silence, so `rm`
    /// is asked without `-f`.
    pub fn remove_dir_all(&self, path: &Path) -> Result<(), String> {
        match self {
            Self::Local => std::fs::remove_dir_all(path).map_err(|error| error.to_string()),
            Self::Wsl(_) | Self::Ssh(_) => self.remote_run(&["rm", "-r", "--", &self.native(path)]),
        }
    }

    /// Removes a link, and not what is on the far side of it.
    ///
    /// A link to a folder is a name and nothing else: taking the name away
    /// leaves the folder it pointed at where it was, which is what a file
    /// manager does with one and what deleting the row that draws it has to
    /// mean. Both calls are tried on this machine because Windows makes a link
    /// to a folder a folder-shaped thing, which the call that removes a file
    /// will not take; `rm` never follows a link it was handed the name of.
    pub fn remove_link(&self, path: &Path) -> Result<(), String> {
        match self {
            Self::Local => std::fs::remove_file(path)
                .or_else(|_| std::fs::remove_dir(path))
                .map_err(|error| error.to_string()),
            Self::Wsl(_) | Self::Ssh(_) => self.remove_file(path),
        }
    }

    /// The home directory on the machine the path is on.
    pub fn home(&self) -> Option<PathBuf> {
        match self {
            Self::Local => crate::fs_browse::home_dir(),
            Self::Wsl(_) | Self::Ssh(_) => {
                let output = self
                    .remote_exec(None, &[], &["sh", "-c", "printf %s \"$HOME\""])
                    .ok()?;
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
            Self::Wsl(_) | Self::Ssh(_) => {
                let output = self
                    .remote_exec(None, &[], &["readlink", "-f", "--", &self.native(path)])
                    .ok()?;
                let resolved = output.text();
                let resolved = resolved.trim();
                (output.ok() && !resolved.is_empty()).then(|| self.canonical(resolved))
            }
        }
    }

    /// One command on the far machine whose only answer is whether it went,
    /// and the machine's own words when it did not — which is most of the
    /// commands above.
    fn remote_run(&self, argv: &[&str]) -> Result<(), String> {
        let output = self.remote_exec(None, &[], argv)?;
        if output.ok() {
            Ok(())
        } else {
            Err(said(&output))
        }
    }
}
