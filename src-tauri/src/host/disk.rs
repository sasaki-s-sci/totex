//! What is in a directory, and what one path is.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use super::parse::{local_child, local_stat, parse_children, parse_stat};
use super::script::{LIST, LIST_MANY, STAT};
use super::{Child, Host, Stat};
use crate::wsl;

/// How many directories one bulk listing asks about at a time. A command line is
/// not unbounded and a walk can hold thousands of directories, so the question
/// is asked in mouthfuls.
const BATCH: usize = 128;

impl Host {
    /// Whether anything occupies this path, including a broken symbolic link.
    pub fn exists(&self, path: &Path) -> bool {
        match self {
            Self::Local => std::fs::symlink_metadata(path).is_ok(),
            Self::Wsl(distro) => {
                let native = self.native(path);
                wsl::exec(
                    distro,
                    None,
                    &[],
                    &[
                        "sh",
                        "-c",
                        "test -e \"$1\" || test -L \"$1\"",
                        "sh",
                        &native,
                    ],
                )
                .is_ok_and(|output| output.ok())
            }
        }
    }

    pub fn stat(&self, path: &Path) -> Option<Stat> {
        match self {
            Self::Local => local_stat(path),
            Self::Wsl(distro) => {
                let output = wsl::script(distro, None, STAT, &[&self.native(path)]).ok()?;
                if !output.ok() {
                    return None;
                }
                parse_stat(output.text().trim())
            }
        }
    }

    pub fn is_dir(&self, path: &Path) -> bool {
        self.stat(path).is_some_and(|stat| stat.is_dir)
    }

    /// Everything in one directory. The error is the machine's own words about
    /// why it would not open.
    pub fn read_dir(&self, path: &Path) -> Result<Vec<Child>, String> {
        match self {
            Self::Local => {
                let entries = std::fs::read_dir(path).map_err(|error| error.to_string())?;
                Ok(entries
                    .flatten()
                    .filter_map(|entry| local_child(&entry))
                    .collect())
            }
            Self::Wsl(distro) => {
                let output = wsl::script(distro, None, LIST, &[&self.native(path)])?;
                if !output.ok() && output.stdout.is_empty() {
                    return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
                }
                Ok(parse_children(&output.stdout)
                    .into_iter()
                    .map(|(_, child)| child)
                    .collect())
            }
        }
    }

    /// The children of many directories at once, and whatever could not be read
    /// about the ones that would not open.
    ///
    /// One question rather than one per directory: a walk asks this of a whole
    /// level of the tree, and inside a distribution each answer would otherwise
    /// be its own round trip. The walk that uses it turns a folder into the
    /// repositories on the canvas, so it is asked about thousands.
    pub fn children(&self, dirs: &[PathBuf]) -> (HashMap<PathBuf, Vec<Child>>, Vec<String>) {
        let mut found: HashMap<PathBuf, Vec<Child>> = HashMap::new();
        let mut warnings = Vec::new();

        match self {
            Self::Local => {
                for dir in dirs {
                    match self.read_dir(dir) {
                        Ok(children) => {
                            found.insert(dir.clone(), children);
                        }
                        Err(error) => warnings.push(error),
                    }
                }
            }
            Self::Wsl(distro) => {
                for batch in dirs.chunks(BATCH) {
                    self.batch(distro, batch, &mut found, &mut warnings);
                }
                // A directory that answered nothing still answered, and the walk
                // tells "empty" from "unreadable" by which map it is in.
                for dir in dirs {
                    found.entry(dir.clone()).or_default();
                }
            }
        }

        (found, warnings)
    }

    /// One mouthful of directories, asked of the distribution in one go.
    fn batch(
        &self,
        distro: &str,
        batch: &[PathBuf],
        found: &mut HashMap<PathBuf, Vec<Child>>,
        warnings: &mut Vec<String>,
    ) {
        let native: Vec<String> = batch.iter().map(|dir| self.native(dir)).collect();
        let args: Vec<&str> = native.iter().map(String::as_str).collect();
        let output = match wsl::script(distro, None, LIST_MANY, &args) {
            Ok(output) => output,
            Err(error) => {
                warnings.push(error);
                return;
            }
        };
        for (parent, child) in parse_children(&output.stdout) {
            found
                .entry(self.canonical(&parent))
                .or_default()
                .push(child);
        }
        // `find` names the directory it could not open, which is exactly what
        // the walk wants to report.
        for line in String::from_utf8_lossy(&output.stderr).lines() {
            let line = line.trim();
            if !line.is_empty() {
                warnings.push(line.to_string());
            }
        }
    }
}
