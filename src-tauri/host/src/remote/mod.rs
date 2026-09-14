//! A machine reached through a shell held open on it.
//!
//! Two kinds of far end look the same from here: a WSL distribution, which
//! `wsl.exe` starts a program inside, and a machine at the other end of `ssh`.
//! Both take a command line for a Bourne shell and both hand back bytes, and
//! everything that made reaching into a distribution worth doing — the cost of
//! starting the bridge, the answers framed by length, the poll standing in for
//! change notifications — is true of a machine across the network more, not
//! less. So the bridge is named once, as a [`Reach`], and the shell held open
//! down it, the commands sent down that, and the loop that watches for changes
//! are all written against the reach rather than against either program.
//!
//! What this module does not know is how a path is spelled from the outside:
//! `\\wsl.localhost\Ubuntu\home` and `ssh://box/home` are read apart by
//! [`crate::wsl`] and [`crate::ssh`], and by the time anything gets here it is a
//! Linux path on a machine the reach can start a shell on.

pub mod channel;
pub mod path;
mod watch;

#[cfg(test)]
mod tests;

use std::process::Command;

pub use channel::{Output, exec, script};
pub use watch::{Poll, watch};

use crate::{ssh, wsl};

/// One machine a shell can be held open on, and the way there.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum Reach {
    /// A WSL distribution, by name.
    Wsl(String),
    /// A machine `ssh` knows — an alias from its config, or `user@hostname`.
    Ssh(String),
}

impl Reach {
    /// What the pool of held-open shells is keyed by. The kind is part of it: a
    /// distribution and an ssh alias that happen to share a name are two
    /// machines, and a shell on one is no use for the other.
    pub fn key(&self) -> String {
        match self {
            Self::Wsl(distro) => format!("wsl:{distro}"),
            Self::Ssh(host) => format!("ssh:{host}"),
        }
    }

    /// A process running `argv` at the far end, with its own three pipes and no
    /// window over the app. `argv` is the program and its words, as `exec`
    /// would take them: the reach is what turns that into a `wsl.exe` or an
    /// `ssh` invocation, and a caller never quotes anything for either.
    pub fn command(&self, argv: &[&str]) -> Command {
        match self {
            Self::Wsl(distro) => {
                let mut command = wsl::shell::command(distro, None);
                command.arg("-e").args(argv);
                command
            }
            Self::Ssh(host) => ssh::command(host, argv),
        }
    }

    /// The error the app shows when the far end could not be started at all,
    /// which says which kind of far end it was.
    fn unreachable(&self) -> &'static str {
        match self {
            Self::Wsl(_) => "wsl-unreachable",
            Self::Ssh(_) => "ssh-unreachable",
        }
    }
}

/// One argument, as a Bourne shell has to read it to get it back unchanged.
/// Single quotes, so nothing inside is expanded: these carry file paths and
/// people's sentences, and `$`, backticks and backslashes all have to survive.
pub fn quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

/// A command line for the shell at the other end of a channel: the directory to
/// run in, the environment to run under, and the words themselves.
pub fn line(cwd: Option<&str>, env: &[(&str, &str)], argv: &[&str]) -> String {
    let mut rendered = String::new();
    if let Some(cwd) = cwd {
        rendered.push_str(&format!("cd {} && ", quote(cwd)));
    }
    for (name, value) in env {
        rendered.push_str(&format!("{name}={} ", quote(value)));
    }
    let mut words = argv.iter();
    if let Some(first) = words.next() {
        rendered.push_str(&quote(first));
    }
    for word in words {
        rendered.push(' ');
        rendered.push_str(&quote(word));
    }
    rendered
}
