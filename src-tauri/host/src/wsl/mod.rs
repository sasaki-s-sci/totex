//! Reaching into a WSL distribution instead of at the share it publishes.
//!
//! Windows shows a distribution's filesystem as `\\wsl.localhost\<distro>\...`,
//! and that share is enough to read bytes with. It is not enough to work in: a
//! `git` run from Windows over 9p reads a Linux checkout with the wrong line
//! endings and the wrong file modes, `cmd` refuses a UNC directory outright, the
//! coding agents are installed inside the distribution, and Windows' own change
//! notifications never fire for the share. So a path that names a distribution
//! is worked on *inside* it, and the share is the fallback.
//!
//! Everything here is one distribution and one Linux path — [`Location`] — got
//! from the UNC spelling, which stays the canonical form the rest of the app
//! passes around. Nothing else has to know a path is remote until it runs
//! something. See [`channel`] for why that running goes down a held-open pipe.

pub mod channel;
pub mod shell;
mod watch;

#[cfg(test)]
mod tests;

pub use channel::{exec, script};
pub use shell::{distros, program};
pub use watch::{Poll, watch};

/// The prefix Windows publishes a distribution's filesystem under, and the one
/// older builds published it under before that.
const PREFIXES: [&str; 2] = [r"\\wsl.localhost\", r"\\wsl$\"];

/// The one this app writes, so a path means the same thing every time it is
/// compared, keyed on or stored.
const CANONICAL: &str = r"\\wsl.localhost\";

/// A path inside a WSL distribution: which one, and where in it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Location {
    pub distro: String,
    /// An absolute Linux path — `/home/a/repo`, never the UNC spelling.
    pub path: String,
}

/// Reads the UNC spelling of a WSL path, or `None` when it is not one. Done on
/// the string rather than through `Path`, because the answer must be the same on
/// both platforms: in a Linux build a backslash is an ordinary character.
pub fn locate(raw: &str) -> Option<Location> {
    // Asked of every path the app touches, including every row of a listing, so
    // the answer for the ones that are plainly not a share costs two bytes.
    if !raw.starts_with(r"\\") && !raw.starts_with("//") {
        return None;
    }
    let uniform = raw.replace('/', "\\");
    let rest = PREFIXES
        .iter()
        .find_map(|prefix| uniform.strip_prefix(prefix))?;
    let (distro, tail) = match rest.split_once('\\') {
        Some((distro, tail)) => (distro, tail),
        None => (rest, ""),
    };
    if distro.is_empty() {
        return None;
    }
    Some(Location {
        distro: distro.to_string(),
        path: linux_path(tail),
    })
}

/// `home\a\repo` as the distribution spells it, and `/` for the share's root.
fn linux_path(tail: &str) -> String {
    let cleaned = tail.replace('\\', "/");
    let trimmed = cleaned.trim_matches('/');
    if trimmed.is_empty() {
        "/".to_string()
    } else {
        format!("/{trimmed}")
    }
}

/// The UNC spelling of a Linux path in a distribution, which is what the rest of
/// the app stores, compares and hands back over IPC.
pub fn unc(distro: &str, path: &str) -> String {
    let inner = path.trim_start_matches('/').replace('/', "\\");
    if inner.is_empty() {
        format!("{CANONICAL}{distro}")
    } else {
        format!("{CANONICAL}{distro}\\{inner}")
    }
}

impl Location {
    pub fn unc(&self) -> String {
        unc(&self.distro, &self.path)
    }

    /// The same distribution, at another path in it.
    pub fn at(&self, path: &str) -> Self {
        Self {
            distro: self.distro.clone(),
            path: path.to_string(),
        }
    }

    /// The directory holding this one, or `None` at the root of the distribution
    /// — which is where a walk upwards has to stop.
    pub fn parent(&self) -> Option<Self> {
        let cut = self.path.rfind('/')?;
        if self.path == "/" {
            return None;
        }
        Some(self.at(if cut == 0 { "/" } else { &self.path[..cut] }))
    }

    /// The last part of the path. The root has none, so it is called by the
    /// distribution it is the root of.
    pub fn name(&self) -> String {
        match self.path.rsplit('/').next() {
            Some(name) if !name.is_empty() => name.to_string(),
            _ => self.distro.clone(),
        }
    }
}

/// Two Linux paths joined, without going through `Path` — see [`locate`].
pub fn join(base: &str, name: &str) -> String {
    if name.starts_with('/') {
        return name.to_string();
    }
    if base.ends_with('/') {
        format!("{base}{name}")
    } else {
        format!("{base}/{name}")
    }
}

/// Folds `.` and `..` out of a Linux path, without asking the distribution.
///
/// Lexical because the alternative is a round trip per keystroke — and because a
/// path that still says `..` in the middle will not compare equal to the same
/// directory named plainly, which is what the panes key on.
pub fn clean(path: &str) -> String {
    let mut parts: Vec<&str> = Vec::new();
    for part in path.split('/') {
        match part {
            "" | "." => {}
            ".." => {
                parts.pop();
            }
            name => parts.push(name),
        }
    }
    if parts.is_empty() {
        "/".to_string()
    } else {
        format!("/{}", parts.join("/"))
    }
}
