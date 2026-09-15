//! `ssh` itself: which program it is, how a command is handed to it so that
//! nothing at the far end is left waiting on this side, and the line a terminal
//! runs to land in a folder there.

use std::process::Command;

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
/// waiting forever. `--` keeps a host whose name begins with a dash from being
/// read as an option.
///
/// The remote login shell reads the command as one line and parses it again,
/// which is why every word is quoted before they are joined: `ssh` itself
/// joins its trailing arguments with spaces and hands the shell the result,
/// and a file name with a space in it would arrive as two.
pub fn command(host: &str, argv: &[&str]) -> Command {
    let mut command = Command::new(program());
    command
        .args(["-T", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10"])
        .arg(host)
        .arg("--")
        .arg(remote_line(argv));
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    command
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
