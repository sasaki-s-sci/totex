//! Reaching a machine over `ssh`, the way a WSL distribution is reached.
//!
//! A distribution is a machine `wsl.exe` starts a shell on; a machine `ssh`
//! knows is one it opens a shell on, and from there the two are the same thing
//! to this program — see [`crate::remote`], where the shell is held open and
//! the commands go down it. What is particular to ssh is here: how a path on
//! such a machine is spelled from the outside, how `ssh` itself is invoked so
//! that it never waits on a prompt, and which machines the user's own config
//! names.
//!
//! The spelling is `ssh://<host>/<path>`, with `<host>` whatever `ssh` would
//! take on its command line — an alias out of `~/.ssh/config`, or
//! `user@hostname`. It stays the canonical form the rest of the app passes
//! around, exactly as the UNC spelling does for a distribution, so nothing else
//! has to know a path is on another machine until it runs something.

mod config;
mod shell;

#[cfg(test)]
mod tests;

pub use config::{hosts, parse_config};
pub use shell::{command, login_line, program};

use crate::remote::path;

/// The scheme every path on such a machine begins with.
const SCHEME: &str = "ssh://";

/// A path on a machine reached over ssh: which machine, and where on it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Location {
    /// What `ssh` is handed to get there.
    pub host: String,
    /// An absolute Linux path — `/home/a/repo`, never the url spelling. `/~`
    /// and what follows it is the home directory not yet asked for, the same
    /// marker a distribution's path carries; see `fs_browse::path`.
    pub path: String,
}

/// Reads the `ssh://` spelling apart, or `None` when the string is not one.
///
/// Asked of every path the app touches, including every row of a listing, so
/// the answer for the ones that are plainly something else costs a prefix
/// check. The host is everything up to the next `/` and may not be empty; a
/// path that stops at the host is the root of the machine, and doubled
/// separators are folded, both the way the UNC reading does.
pub fn locate(raw: &str) -> Option<Location> {
    let rest = raw.strip_prefix(SCHEME)?;
    let (host, tail) = match rest.split_once('/') {
        Some((host, tail)) => (host, tail),
        None => (rest, ""),
    };
    if host.is_empty() {
        return None;
    }
    Some(Location {
        host: host.to_string(),
        path: linux_path(tail),
    })
}

/// `home/a/repo` as the machine spells it, with empty parts dropped, and `/`
/// for the root. Folded no further than that: `.` and `..` are left for
/// `remote::path::clean`, which is asked when a path is settled, and `~` is a
/// marker for something the machine has to be asked about.
fn linux_path(tail: &str) -> String {
    let parts: Vec<&str> = tail.split('/').filter(|part| !part.is_empty()).collect();
    if parts.is_empty() {
        "/".to_string()
    } else {
        format!("/{}", parts.join("/"))
    }
}

/// The url spelling of a Linux path on `host`, which is what the rest of the
/// app stores, compares and hands back over IPC.
pub fn url(host: &str, path: &str) -> String {
    let inner = path.trim_start_matches('/');
    format!("{SCHEME}{host}/{inner}")
}

impl Location {
    pub fn url(&self) -> String {
        url(&self.host, &self.path)
    }

    /// The same machine, at another path on it.
    pub fn at(&self, path: &str) -> Self {
        Self {
            host: self.host.clone(),
            path: path.to_string(),
        }
    }

    /// The directory holding this one, or `None` at the root of the machine.
    pub fn parent(&self) -> Option<Self> {
        path::parent(&self.path).map(|parent| self.at(parent))
    }

    /// The last part of the path. The root has none, so it is called by the
    /// machine it is the root of.
    pub fn name(&self) -> String {
        path::name(&self.path)
            .map(str::to_string)
            .unwrap_or_else(|| self.host.clone())
    }
}
