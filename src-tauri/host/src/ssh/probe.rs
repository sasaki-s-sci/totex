//! Whether a machine can be reached, and if not, what it is waiting for.
//!
//! Asked before a machine is first opened, so that a machine that wants a
//! password is told apart from one that is not there: the first is a question
//! the app can put to the user, the second only a message. `ssh` says which it
//! was on its stderr and nowhere else — the exit code is 255 for all of them —
//! so the reading is of the words, the ones OpenSSH has printed for these
//! cases for as long as it has existed.

use std::process::Stdio;

use super::command;

/// What trying a machine came to.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Reached {
    /// A command ran there.
    Ok,
    /// The machine answered and refused every way in that was tried — which,
    /// with no password known, is the password not having been given, and with
    /// one known, is that password being wrong.
    NeedsPassword,
    /// The machine's key is not the one remembered for it in `known_hosts`.
    /// Never accepted from here: a changed key is either a reinstalled machine
    /// or somebody in the way, and only the user can say which.
    HostKey,
    /// Anything else, with the first thing `ssh` said about it.
    Unreachable(String),
}

/// Runs `true` on `host` and reads what happened.
pub fn reach(host: &str) -> Reached {
    let output = command(host, &["true"])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .output();
    match output {
        Ok(output) if output.status.success() => Reached::Ok,
        Ok(output) => classify(&String::from_utf8_lossy(&output.stderr)),
        Err(error) => Reached::Unreachable(error.to_string()),
    }
}

/// What a failed `ssh` meant, from what it said on stderr.
///
/// Host keys are looked for first: a changed key is reported with a banner and
/// then, in the same breath, an authentication that never happened, and the
/// key is the thing the user has to hear about.
pub fn classify(stderr: &str) -> Reached {
    if stderr.contains("Host key verification failed")
        || stderr.contains("REMOTE HOST IDENTIFICATION HAS CHANGED")
    {
        return Reached::HostKey;
    }
    if stderr.contains("Too many authentication failures") {
        return Reached::NeedsPassword;
    }
    // The refusal names the ways in the server offers: only one with a typed
    // secret among them makes asking for a password worth anything.
    if refused_methods(stderr).is_some_and(|offered| {
        offered
            .split(',')
            .any(|method| matches!(method.trim(), "password" | "keyboard-interactive"))
    }) {
        return Reached::NeedsPassword;
    }
    let first = stderr
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .unwrap_or_default();
    Reached::Unreachable(first.to_string())
}

/// The methods in `Permission denied (publickey,password).`, or `None` when
/// nothing was refused.
fn refused_methods(stderr: &str) -> Option<&str> {
    let after = &stderr[stderr.find("Permission denied")? + "Permission denied".len()..];
    let open = after.find('(')?;
    let close = after[open..].find(')')?;
    Some(&after[open + 1..open + close])
}
