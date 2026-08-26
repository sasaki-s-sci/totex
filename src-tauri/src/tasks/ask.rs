//! Asking a directory's runners what they can run.
//!
//! Through a login shell, for the reason the agent registration goes through
//! one — see `crate::mcp::install::here`. All four of these are installed by a
//! version manager into somebody's home directory and put on the path by
//! whatever their shell reads at startup, and a window started from a desktop
//! rather than from a terminal has read none of it. A runner still not found
//! after that contributes nothing, which is the same answer as not being there.

use std::path::Path;

use crate::host::Host;

/// How every one of them is asked: for a list, and for nothing painted.
///
/// `NO_COLOR` because a list is read here rather than shown, and a runner that
/// decided it was talking to a terminal would wrap every name in escapes.
const ENVIRONMENT: [(&str, &str); 1] = [("NO_COLOR", "1")];

/// What `line` said in `dir`, or None when it would not run or said it failed.
pub fn say(dir: &Path, line: &str) -> Option<String> {
    let host = Host::of(dir);
    // Not read on Windows, where the shell that runs a line is `cmd` and the
    // one somebody types into is not.
    #[cfg(not(windows))]
    let shell = crate::pty::shell();

    let argv: Vec<&str> = match &host {
        // A distribution is asked in the shell every distribution has, and not
        // in the one its owner uses: which that is cannot be known from out
        // here, and `wsl.exe` is being handed a command rather than left to
        // start a login shell of its own.
        Host::Wsl(_) => vec!["sh", "-lc", line],
        #[cfg(windows)]
        Host::Local => vec!["cmd", "/C", line],
        #[cfg(not(windows))]
        Host::Local => vec![shell.as_str(), "-lc", line],
    };

    let said = host.exec(Some(dir), &ENVIRONMENT, &argv).ok()?;
    if !said.ok() {
        return None;
    }
    Some(String::from_utf8_lossy(&said.stdout).into_owned())
}
