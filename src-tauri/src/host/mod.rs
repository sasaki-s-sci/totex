//! Where a path lives, and how the app works on it there.
//!
//! Two answers: this machine, or a WSL distribution reached through
//! [`crate::wsl`]. Every path in the app is a plain string that says which —
//! `\\wsl.localhost\Ubuntu\home\a\repo` names a place inside a distribution the
//! same way `C:\Users\a` names one on the Windows disk — so only the things
//! that actually touch a file or start a program come through here.
//!
//! Bytes can be read either way; work cannot. A distribution's files are owned
//! by its own user, which no Windows account is, so git refuses the repository
//! outright; the agents are installed inside; `cmd` will not take a UNC
//! directory to run in; and Windows' change notifications never fire for the
//! share. Reaching in is the only one of the two that is the same app on both
//! sides.
//!
//! A remote path is manipulated as a string rather than through `Path`, because
//! it has to mean the same thing in both builds: on Linux — where these tests
//! run — `Path` sees one component and a backslash is an ordinary letter. So
//! `join`, `parent` and `name` are asked of the host rather than of the path.

mod disk;
mod file;
mod parse;
mod run;
mod script;

#[cfg(test)]
mod tests;

use std::path::{Path, PathBuf};

use crate::wsl;

/// What a path is, as much of it as anything here asks.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Stat {
    /// After following a link, which is what "is this a folder" means to a
    /// person looking at a listing.
    pub is_dir: bool,
    pub is_symlink: bool,
    /// Marked hidden by the filesystem itself, which only Windows does. A name
    /// beginning with a dot is hidden too, but that is the caller's rule.
    pub hidden: bool,
    pub size: u64,
    /// Milliseconds since the Unix epoch.
    pub modified_ms: Option<u64>,
}

/// One entry of a directory.
#[derive(Debug, Clone)]
pub struct Child {
    pub name: String,
    pub stat: Stat,
}

/// What a program said, whichever side it ran on.
#[derive(Debug, Clone)]
pub struct Output {
    pub code: i32,
    pub stdout: Vec<u8>,
    pub stderr: Vec<u8>,
}

impl Output {
    pub fn ok(&self) -> bool {
        self.code == 0
    }
}

/// The machine a path is on.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Host {
    Local,
    /// A WSL distribution, by name.
    Wsl(String),
}

impl Host {
    /// Which machine `path` is on, read from the path itself.
    pub fn of(path: &Path) -> Self {
        Self::of_str(&path.to_string_lossy())
    }

    pub fn of_str(path: &str) -> Self {
        match wsl::locate(path) {
            Some(found) => Self::Wsl(found.distro),
            None => Self::Local,
        }
    }

    pub fn is_remote(&self) -> bool {
        matches!(self, Self::Wsl(_))
    }

    /// The distribution's name, for the mark the window puts beside a path.
    pub fn distro(&self) -> Option<&str> {
        match self {
            Self::Local => None,
            Self::Wsl(distro) => Some(distro),
        }
    }

    /// The path as the machine holding it spells it: `/home/a/repo` inside a
    /// distribution, and unchanged here.
    pub fn native(&self, path: &Path) -> String {
        match self {
            Self::Local => path.to_string_lossy().into_owned(),
            Self::Wsl(_) => wsl::locate(&path.to_string_lossy())
                .map(|found| found.path)
                .unwrap_or_else(|| path.to_string_lossy().into_owned()),
        }
    }

    /// A path the machine spelled, back in the form the whole app stores,
    /// compares and hands over IPC.
    pub fn canonical(&self, native: &str) -> PathBuf {
        match self {
            Self::Local => PathBuf::from(native),
            Self::Wsl(distro) => PathBuf::from(wsl::unc(distro, native)),
        }
    }

    pub fn join(&self, path: &Path, name: &str) -> PathBuf {
        match self {
            Self::Local => path.join(name),
            Self::Wsl(_) => self.canonical(&wsl::join(&self.native(path), name)),
        }
    }

    pub fn parent(&self, path: &Path) -> Option<PathBuf> {
        match self {
            Self::Local => path.parent().map(Path::to_path_buf),
            Self::Wsl(_) => wsl::locate(&path.to_string_lossy())?
                .parent()
                .map(|parent| PathBuf::from(parent.unc())),
        }
    }

    /// The last part of a path. A root has none, so it keeps its whole spelling
    /// — `C:\`, or the name of the distribution.
    pub fn name(&self, path: &Path) -> String {
        match self {
            Self::Local => path
                .file_name()
                .map(|name| name.to_string_lossy().into_owned())
                .unwrap_or_else(|| path.to_string_lossy().into_owned()),
            Self::Wsl(_) => wsl::locate(&path.to_string_lossy())
                .map(|found| found.name())
                .unwrap_or_default(),
        }
    }

    /// Where a scratch directory belongs on this machine.
    pub fn temp_dir(&self) -> PathBuf {
        match self {
            Self::Local => std::env::temp_dir(),
            Self::Wsl(_) => self.canonical("/tmp"),
        }
    }
}
