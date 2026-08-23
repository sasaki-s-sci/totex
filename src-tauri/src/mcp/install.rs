//! Registering this server with a coding agent, once, for every terminal it
//! will ever be run in.
//!
//! The registration is a line of setup somebody would otherwise type, and this
//! is the app typing it. It is the agent's own command that is run rather than
//! its configuration file that is written: where an agent keeps its settings,
//! and what else is in there, is the agent's business — and a program that
//! rewrites another program's files is a program that has to be right about a
//! format it does not own.
//!
//! What is registered is a variable and not an address. Every terminal this
//! window opens is handed one of its own in `TOTEX_MCP_URL`, so one line covers
//! all of them — and a terminal opened anywhere else has no such variable,
//! which is exactly the right answer: this server has nothing to say about a
//! session it is not beside.

use std::process::Command;

use crate::wsl;

/// What the agent is registered against, expanded by the agent itself out of
/// the environment each terminal is started with.
fn address() -> String {
    format!("${{{}}}", super::ADDRESS_VAR)
}

/// The registration, held together the way the shell about to run it reads.
///
/// Quoted because the variable is not this side's to expand: it stands for a
/// different address in every terminal, and what is registered is the name of
/// it. Which quote does that is the shell's business and not the same in both
/// — a POSIX shell hands on what is inside single quotes untouched, and `cmd`
/// has no single quotes at all. They are letters to it, and would be written
/// into the agent's settings as part of the address.
pub(super) fn line(quote: char) -> String {
    format!(
        "claude mcp add --scope user --transport http {NAME} {quote}{}{quote}",
        address()
    )
}

/// The one the shell this window would run something through reads.
#[cfg(windows)]
const QUOTE: char = '"';
#[cfg(not(windows))]
const QUOTE: char = '\'';

/// And the one a distribution's shell reads, which is a POSIX shell wherever
/// the window itself is running.
const QUOTE_INSIDE: char = '\'';

/// The name the server is registered under, which is what the agent's own tool
/// names are then built from.
const NAME: &str = "totex";

/// Registers with Claude Code, wherever this window can reach it.
///
/// Both sides of the window where there are two: the agent that matters is the
/// one that will be running in the terminals, and a terminal in a WSL
/// distribution runs that distribution's own copy. Only the distributions whose
/// loopback is this machine's are asked — the others cannot reach the server at
/// all, so registering there would be setting up a connection that can only
/// fail.
pub fn into_claude_code() -> Result<String, String> {
    let mut taken: Vec<String> = Vec::new();
    let mut refused: Vec<String> = Vec::new();

    match here(&line(QUOTE)) {
        Ok(()) => taken.push("this machine".to_string()),
        Err(why) => refused.push(why),
    }

    for distro in wsl::distros() {
        if !super::shares_loopback(&distro) {
            continue;
        }
        match inside(&distro, &line(QUOTE_INSIDE)) {
            Ok(()) => taken.push(distro),
            Err(why) => refused.push(format!("{distro}: {why}")),
        }
    }

    if taken.is_empty() {
        return Err(refused.join("; "));
    }
    Ok(taken.join(", "))
}

/// Runs it where the window is running.
///
/// Through a login shell, because that is where the agent is on the path: it
/// was installed into somebody's home directory by something their shell reads
/// at startup, and a window started from a desktop rather than from a terminal
/// has never read any of it.
fn here(line: &str) -> Result<(), String> {
    #[cfg(windows)]
    let mut command = {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let mut command = Command::new("cmd");
        command.arg("/C").arg(line).creation_flags(CREATE_NO_WINDOW);
        command
    };
    #[cfg(not(windows))]
    let mut command = {
        let mut command = Command::new(crate::pty::shell());
        command.arg("-lc").arg(line);
        command
    };

    let said = command
        .output()
        .map_err(|error| format!("the shell would not start: {error}"))?;
    if said.status.success() {
        return Ok(());
    }
    Err(complaint(&said.stderr, &said.stdout))
}

/// And inside a distribution, where its own copy of the agent is.
fn inside(distro: &str, line: &str) -> Result<(), String> {
    let said = wsl::exec(distro, None, &[], &["sh", "-lc", line])?;
    if said.ok() {
        return Ok(());
    }
    Err(complaint(&said.stderr, &said.stdout))
}

/// What went wrong, in as much of the agent's own words as is worth carrying.
///
/// The first line of it. What comes back when the agent is not installed is a
/// sentence; what comes back when it refused the registration is a sentence and
/// then a page of help, and the page is not the answer to anything.
fn complaint(stderr: &[u8], stdout: &[u8]) -> String {
    let said = if stderr.is_empty() { stdout } else { stderr };
    String::from_utf8_lossy(said)
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .unwrap_or("the agent is not installed here")
        .to_string()
}
