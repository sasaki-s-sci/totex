//! Where a path lives, and how the app works on it there.
//!
//! Three answers: this machine, a WSL distribution reached through
//! [`crate::wsl`], or a machine reached over ssh through [`crate::ssh`]. Every
//! path in the app is a plain string that says which —
//! `\\wsl.localhost\Ubuntu\home\a\repo` names a place inside a distribution
//! and `ssh://box/home/a/repo` one on another machine, the same way `C:\Users\a`
//! names one on the Windows disk — so only the things that actually touch a
//! file or start a program come through here.
//!
//! The two far answers are one answer from here on. A distribution's files are
//! owned by its own user, which no Windows account is, so git refuses the
//! repository outright; the agents are installed inside; `cmd` will not take a
//! UNC directory to run in; and Windows' change notifications never fire for
//! the share. A machine across the network has no share at all. Reaching in is
//! the only way that is the same app on every side, and what it reaches in
//! with is [`crate::remote`], which holds a shell open on either kind of far
//! end and does not care which.
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
pub(crate) mod tests;

use std::path::{Path, PathBuf};

use crate::remote::{self, Reach, path as remote_path};
use crate::{ssh, wsl};

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
    /// A machine reached over ssh, by the name `ssh` is handed to get there.
    Ssh(String),
}

impl Host {
    /// Which machine `path` is on, read from the path itself.
    pub fn of(path: &Path) -> Self {
        Self::of_str(&path.to_string_lossy())
    }

    pub fn of_str(path: &str) -> Self {
        if let Some(found) = wsl::locate(path) {
            return Self::Wsl(found.distro);
        }
        if let Some(found) = ssh::locate(path) {
            return Self::Ssh(found.host);
        }
        Self::Local
    }

    pub fn is_remote(&self) -> bool {
        !matches!(self, Self::Local)
    }

    /// The distribution's name, when the path is inside one. WSL only: what
    /// asks this is deciding whether the Windows side can name the path too.
    pub fn distro(&self) -> Option<&str> {
        match self {
            Self::Wsl(distro) => Some(distro),
            Self::Local | Self::Ssh(_) => None,
        }
    }

    /// What the far machine is called — the distribution, or the ssh host —
    /// for the mark the window puts beside a path so it reads as another place.
    pub fn remote_name(&self) -> Option<&str> {
        match self {
            Self::Local => None,
            Self::Wsl(name) | Self::Ssh(name) => Some(name),
        }
    }

    /// The way to a shell on the far machine, or `None` for this one.
    pub fn reach(&self) -> Option<Reach> {
        match self {
            Self::Local => None,
            Self::Wsl(distro) => Some(Reach::Wsl(distro.clone())),
            Self::Ssh(host) => Some(Reach::Ssh(host.clone())),
        }
    }

    /// The path as the machine holding it spells it: `/home/a/repo` inside a
    /// distribution or on the far machine, and unchanged here.
    pub fn native(&self, path: &Path) -> String {
        let spelled = path.to_string_lossy();
        match self {
            Self::Local => spelled.into_owned(),
            Self::Wsl(_) => wsl::locate(&spelled)
                .map(|found| found.path)
                .unwrap_or_else(|| spelled.into_owned()),
            Self::Ssh(_) => ssh::locate(&spelled)
                .map(|found| found.path)
                .unwrap_or_else(|| spelled.into_owned()),
        }
    }

    /// A path the machine spelled, back in the form the whole app stores,
    /// compares and hands over IPC.
    pub fn canonical(&self, native: &str) -> PathBuf {
        match self {
            Self::Local => PathBuf::from(native),
            Self::Wsl(distro) => PathBuf::from(wsl::unc(distro, native)),
            Self::Ssh(host) => PathBuf::from(ssh::url(host, native)),
        }
    }

    pub fn join(&self, path: &Path, name: &str) -> PathBuf {
        match self {
            Self::Local => path.join(name),
            Self::Wsl(_) | Self::Ssh(_) => {
                self.canonical(&remote_path::join(&self.native(path), name))
            }
        }
    }

    pub fn parent(&self, path: &Path) -> Option<PathBuf> {
        match self {
            Self::Local => path.parent().map(Path::to_path_buf),
            Self::Wsl(_) | Self::Ssh(_) => {
                remote_path::parent(&self.native(path)).map(|parent| self.canonical(parent))
            }
        }
    }

    /// The last part of a path. A root has none, so it keeps its whole spelling
    /// — `C:\`, or the name of the machine it is the root of.
    pub fn name(&self, path: &Path) -> String {
        match self {
            Self::Local => path
                .file_name()
                .map(|name| name.to_string_lossy().into_owned())
                .unwrap_or_else(|| path.to_string_lossy().into_owned()),
            Self::Wsl(_) | Self::Ssh(_) => remote_path::name(&self.native(path))
                .or_else(|| self.remote_name())
                .unwrap_or_default()
                .to_string(),
        }
    }

    /// Where a scratch directory belongs on this machine.
    pub fn temp_dir(&self) -> PathBuf {
        match self {
            Self::Local => std::env::temp_dir(),
            Self::Wsl(_) | Self::Ssh(_) => self.canonical("/tmp"),
        }
    }

    /// Watches `native_paths` on the far machine — spelled as it spells them,
    /// see [`native`](Self::native) — and says which of them moved, in that
    /// same spelling. `Err("local")` for this machine, which has change
    /// notifications of its own and is watched with them.
    pub fn watch(
        &self,
        recursive: bool,
        native_paths: &[String],
        on_change: impl Fn(Vec<String>) + Send + Clone + 'static,
    ) -> Result<remote::Poll, String> {
        let reach = self.reach().ok_or_else(|| "local".to_string())?;
        remote::watch(&reach, recursive, native_paths, on_change)
    }

    /// One command run on the far machine, for the remote arm of every
    /// operation here. Asked with the far machine's own spelling of any path
    /// in `argv`; `Err("local")` is what this machine answers, which no arm
    /// that matched a remote host will see.
    fn remote_exec(
        &self,
        cwd: Option<&str>,
        env: &[(&str, &str)],
        argv: &[&str],
    ) -> Result<remote::Output, String> {
        let reach = self.reach().ok_or_else(|| "local".to_string())?;
        remote::exec(&reach, cwd, env, argv)
    }

    /// One of [`script`](self::script)'s bodies run on the far machine, with
    /// `args` as `$1` onwards.
    fn remote_script(&self, body: &str, args: &[&str]) -> Result<remote::Output, String> {
        let reach = self.reach().ok_or_else(|| "local".to_string())?;
        remote::script(&reach, None, body, args)
    }
}

/// What a command's failure is reported as: the far machine's own words.
fn said(output: &remote::Output) -> String {
    String::from_utf8_lossy(&output.stderr).trim().to_string()
}
