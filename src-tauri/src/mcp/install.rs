//! Registering this server with the coding agents, once, for every terminal
//! they will ever be run in.
//!
//! The registration is a line of setup somebody would otherwise type, and this
//! is the app typing it. It is the agent's own command that is run rather than
//! its configuration file that is written: where an agent keeps its settings,
//! and what else is in there, is the agent's business — and a program that
//! rewrites another program's files is a program that has to be right about a
//! format it does not own.
//!
//! What is registered is a session's own door, and the agents cannot both be
//! told it the same way. One of them expands `${TOTEX_MCP_URL}` out of the
//! environment its terminal was started in, so it is handed the name of that
//! variable and the whole address is a session's own. The other reads no
//! variable into an address at all — it takes the name of one to read a bearer
//! token out of, which is the same indirection wearing a different hat: the
//! address written into its settings is the one door on this machine, and what
//! says which session is talking rides in the request instead.
//!
//! The line is shown on the page as well as run from it. This is a button that
//! reaches into somebody else's program, and the honest way to offer that is to
//! say what it would do in the words they could have typed themselves.

use std::process::Command;

use serde::{Deserialize, Serialize};

use crate::wsl;

/// A coding agent this window knows the setup line for.
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Agent {
    Claude,
    Codex,
}

/// The ones the page offers, in the order it draws them.
const AGENTS: [Agent; 2] = [Agent::Claude, Agent::Codex];

/// An agent, and the line that sets it up.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Setup {
    pub agent: Agent,
    pub line: String,
}

/// The name the server is registered under, which is what the agent's own tool
/// names are then built from.
const NAME: &str = "totex";

/// What the shell about to run a line reads as its own punctuation.
#[derive(Clone, Copy)]
pub(super) struct Shell {
    /// What holds a `$` back from this side, leaving the variable for the agent
    /// to expand. It stands for a different address in every terminal, so what
    /// is registered is the name of it.
    quote: char,
    /// What holds two commands in one line.
    then: char,
}

/// A POSIX shell — the one this window runs through everywhere but Windows, and
/// a distribution's own shell wherever the window is running.
pub(super) const POSIX: Shell = Shell {
    quote: '\'',
    then: ';',
};

/// And `cmd`, which has no single quotes at all: they are letters to it, and
/// would be written into the agent's settings as part of the address.
#[cfg_attr(not(any(windows, test)), allow(dead_code))]
pub(super) const CMD: Shell = Shell {
    quote: '"',
    then: '&',
};

/// The one the shell this window would run something through reads.
#[cfg(windows)]
const HERE: Shell = CMD;
#[cfg(not(windows))]
const HERE: Shell = POSIX;

/// The setup for one agent, held together the way the shell about to run it
/// reads.
///
/// Claude Code is registered against the variable and not against a port, so
/// nothing outside this app has to have heard of the number the server took.
/// The removal in front of it is what makes the press repeatable: the agent
/// will not add a name it already has, and a setup button that fails the second
/// time it is pressed says the wrong thing about a machine that is already set
/// up.
///
/// Codex is registered against the door itself, because the address in its
/// settings is a literal — a variable written there is handed to a URL parser
/// exactly as it was typed. What is left to say which session is talking is the
/// token, and that it will read out of its own environment by name. It needs no
/// removal: adding a name it already has is how it is told the new address.
pub(super) fn line(agent: Agent, shell: Shell, port: u16) -> String {
    let Shell { quote, then } = shell;
    match agent {
        Agent::Claude => format!(
            "claude mcp remove --scope user {NAME} {then} \
             claude mcp add --scope user --transport http {NAME} {quote}${{{}}}{quote}",
            super::ADDRESS_VAR
        ),
        Agent::Codex => format!(
            "codex mcp add {NAME} --url http://{}:{port}{} --bearer-token-env-var {}",
            super::LOOPBACK,
            super::DOOR_PATH,
            super::TOKEN_VAR
        ),
    }
}

/// What each agent would be set up with, as the shell on this side would run it.
pub fn setups(port: u16) -> Vec<Setup> {
    AGENTS
        .into_iter()
        .map(|agent| Setup {
            agent,
            line: line(agent, HERE, port),
        })
        .collect()
}

/// Registers with one agent, wherever this window can reach it.
///
/// Both sides of the window where there are two: the agent that matters is the
/// one that will be running in the terminals, and a terminal in a WSL
/// distribution runs that distribution's own copy. Only the distributions whose
/// loopback is this machine's are asked — the others cannot reach the server at
/// all, so registering there would be setting up a connection that can only
/// fail.
pub fn into_agent(agent: Agent, port: u16) -> Result<String, String> {
    let mut taken: Vec<String> = Vec::new();
    let mut refused: Vec<String> = Vec::new();

    match here(&line(agent, HERE, port)) {
        Ok(()) => taken.push("this machine".to_string()),
        Err(why) => refused.push(why),
    }

    for distro in wsl::distros() {
        if !super::address::shares_loopback(&distro) {
            continue;
        }
        match inside(&distro, &line(agent, POSIX, port)) {
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
/// The last line of it. The setup is two commands where the first one is
/// allowed to fail — there was nothing registered to remove — so the complaint
/// worth reading is the one the command that mattered made.
fn complaint(stderr: &[u8], stdout: &[u8]) -> String {
    let said = if stderr.is_empty() { stdout } else { stderr };
    String::from_utf8_lossy(said)
        .lines()
        .map(str::trim)
        .rfind(|line| !line.is_empty())
        .unwrap_or("the agent is not installed here")
        .to_string()
}
