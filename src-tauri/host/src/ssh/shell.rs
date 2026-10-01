//! `ssh` itself: which program it is, how a command is handed to it so that
//! nothing at the far end is left waiting on this side, and the line a terminal
//! runs to land in a folder there.

use std::process::Command;

use super::{askpass, secrets};
use crate::remote::quote;

/// The `ssh` to run. `TOTEX_SSH` names another when it is set — the tests point
/// it at a script that runs the command here instead of anywhere — and
/// otherwise it is the one on the path, which on Windows is `ssh.exe` from the
/// OpenSSH the system ships. Read every time rather than once, so that a test
/// setting it is a test that gets it.
pub fn program() -> String {
    std::env::var("TOTEX_SSH")
        .ok()
        .filter(|program| !program.is_empty())
        .unwrap_or_else(|| "ssh".to_string())
}

/// A process running `argv` at the far end, and never a prompt.
///
/// `-T` because there is no terminal to give it, `BatchMode` so a missing key
/// is a failure and not a question nobody is there to answer, and a connect
/// timeout so an unplugged network is a failure soon rather than a window
/// waiting forever. A machine never seen before has its key taken and
/// remembered, since there is nobody to say yes to it either; one whose key
/// has changed is still refused, which is the case the question exists for.
/// `--` keeps a host whose name begins with a dash from being read as an
/// option.
///
/// When the user has typed a password for the machine — see [`super::secrets`]
/// — `ssh` is let ask after all, but only this program: `SSH_ASKPASS` names the
/// running executable, which answers out of its environment and exits — see
/// [`super::askpass`]. One prompt and no more, so a password that has stopped
/// working is one failed attempt rather than three.
///
/// The remote login shell reads the command as one line and parses it again,
/// which is why every word is quoted before they are joined: `ssh` itself
/// joins its trailing arguments with spaces and hands the shell the result,
/// and a file name with a space in it would arrive as two.
pub fn command(host: &str, argv: &[&str]) -> Command {
    let mut command = Command::new(program());
    let password = secrets::known(host);
    let batch = if password.is_some() {
        ["-o", "BatchMode=no", "-o", "NumberOfPasswordPrompts=1"].as_slice()
    } else {
        ["-o", "BatchMode=yes"].as_slice()
    };
    command
        .arg("-T")
        .args(batch)
        .args([
            "-o",
            "ConnectTimeout=10",
            "-o",
            "StrictHostKeyChecking=accept-new",
        ])
        .args(destination(host))
        .arg("--")
        .arg(remote_line(argv));
    if let Some(password) = password {
        ask_with(&mut command, &password);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    command
}

/// Points `ssh`'s askpass at this program, holding `password` to give it.
///
/// `SSH_ASKPASS_REQUIRE=force` because `ssh` otherwise only asks the program
/// when it has no terminal to read from *and* a display to show a dialog on;
/// the first holds here, the second is a guess about X that means nothing on
/// Windows. Older `ssh`, which predates the variable, still wants a `DISPLAY`
/// before it will run an askpass at all, so one is supplied where there is
/// none — nothing is ever drawn on it.
///
/// An executable that cannot name itself leaves the command as it is, asking
/// nobody, and the connection fails the way it would have with no password
/// known.
fn ask_with(command: &mut Command, password: &str) {
    let Ok(me) = std::env::current_exe() else {
        return;
    };
    command
        .env("SSH_ASKPASS", me)
        .env("SSH_ASKPASS_REQUIRE", "force")
        .env(askpass::FLAG, "1")
        .env(askpass::SECRET, password);
    #[cfg(unix)]
    if std::env::var_os("DISPLAY").is_none() {
        command.env("DISPLAY", ":0");
    }
}

/// The words that name the machine on `ssh`'s command line: `-p` and the port
/// when the host carries one, then the destination. See [`target`].
pub fn destination(host: &str) -> Vec<String> {
    let (destination, port) = target(host);
    match port {
        Some(port) => vec!["-p".to_string(), port, destination],
        None => vec![destination],
    }
}

/// The host as `ssh` takes it apart: the destination, and the port when the
/// spelling ends in one.
///
/// `ssh` itself takes no port in the destination — only an `ssh://` url of its
/// own, which this app's spelling is not — so `user@10.0.0.2:2222` has to be
/// read apart here and handed over as `-p 2222`. Only a trailing `:` and a port
/// number count. A bare IPv6 address is all colons and digits, and is never
/// read as carrying a port; one in brackets — `[fe80::1]:2222` — is, and loses
/// the brackets, which `ssh` does not read. Anything else is left exactly as
/// given, for `ssh` and its config to make of what they will.
pub fn target(host: &str) -> (String, Option<String>) {
    let untouched = || (host.to_string(), None);
    let Some((head, port)) = host.rsplit_once(':') else {
        return untouched();
    };
    if !port.bytes().all(|byte| byte.is_ascii_digit()) || port.parse::<u16>().is_err() {
        return untouched();
    }
    // The machine is what follows the user, if there is one.
    let (user, machine) = match head.rsplit_once('@') {
        Some((user, machine)) => (Some(user), machine),
        None => (None, head),
    };
    let machine = match machine.strip_prefix('[').and_then(|m| m.strip_suffix(']')) {
        Some(inside) if !inside.is_empty() => inside,
        _ if machine.is_empty() || machine.contains(['[', ']', ':']) => return untouched(),
        _ => machine,
    };
    let destination = match user {
        Some(user) => format!("{user}@{machine}"),
        None => machine.to_string(),
    };
    (destination, Some(port.to_string()))
}

/// `argv` as the one line the far end's shell is given.
fn remote_line(argv: &[&str]) -> String {
    argv.iter()
        .map(|word| quote(word))
        .collect::<Vec<_>>()
        .join(" ")
}

/// What a terminal opened at `path` on the far machine runs: the login shell
/// of whichever account ssh landed as, in that folder. The path is quoted for
/// the far shell; `$SHELL` is deliberately not, because it is the far end's to
/// expand — nothing on this side knows what that account's shell is. A folder
/// that is not there is not an error: the shell opens at home instead, which
/// is what any terminal does with a directory it cannot change into.
pub fn login_line(path: &str) -> String {
    format!("cd {} 2>/dev/null; exec \"$SHELL\" -l", quote(path))
}
