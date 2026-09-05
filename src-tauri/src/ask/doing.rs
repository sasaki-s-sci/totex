//! What a session is doing, read off the same screen its questions are.
//!
//! A terminal has no interface to be asked what is running in it. On Unix the
//! pty itself would answer — `tcgetpgrp` on the master says which process group
//! is in the foreground, and the name of that process says what it is — but
//! that is a Unix answer to a Windows question: `portable_pty` offers
//! `process_group_leader` only under `cfg(unix)`, ConPTY has no foreground
//! process group at all, and a session opened in a distribution runs its shell
//! inside the virtual machine, where nothing on this side can see it. The one
//! mechanism that would answer everywhere is the shell saying so itself — the
//! semantic prompt marks, `OSC 133` — and that is a thing the person's own
//! shell has to be set up to emit. So this is read off the drawing, the way the
//! questions are, because the drawing is the only place it exists on every
//! machine this app runs on.
//!
//! Four states out of three readings, and every one of them is deliberately
//! blunt. What was typed at the shell says *what* is running — see `AGENTS`,
//! which is the one place in this app that reads what somebody ran rather than
//! that they ran something. Whether the terminal has been taken over says
//! whether it is still running — see `Standing::taken`. And for anything that
//! is not an agent, somewhere to type at the caret means the session is waiting
//! for somebody, while nowhere to type means something is running.
//!
//! An agent is asked the last of those a different way. Its composer is
//! somewhere to type whatever it is doing — that is the whole point of a
//! composer, that a turn can be written while the last one is still being
//! answered — so the caret says nothing about it. What says it is that an agent
//! at work offers a way out of the work: see `STOPPING`.

use super::glyph::{MARKERS, SIGILS};
use super::screen::Screen;

use serde::Serialize;

/// What is running in a session, as far as its own screen says.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Doing {
    /// Waiting to be typed at: a shell standing at its prompt.
    Idle,
    /// Running something, whatever it is.
    Running,
    /// Running one of the coding agents, and waiting for the person: a session
    /// somebody is having rather than a command they are waiting on.
    Agent,
    /// The same session, with the agent working rather than waiting.
    Working,
}

/// The agents this window draws a mark of its own for.
///
/// A list of names, and there is no way round that: nothing an agent does to a
/// terminal is different in kind from what any other full-screen program does
/// to one, so what says `claude` is an agent and `vim` is not is that somebody
/// wrote `claude` down. Two of these the app already knows by name — it offers
/// to register its own server with them, see `mcp::install` — and the rest are
/// here because they are the ones people run. Adding one is adding a line.
const AGENTS: [&str; 5] = ["claude", "codex", "opencode", "gemini", "aider"];

/// What an agent draws while it is working, and never while it is not: the way
/// out of the work it is doing.
///
/// A list of words, the way `AGENTS` is a list of names, and for the same
/// reason: nothing an agent draws while working is different in kind from
/// anything else drawn on a terminal. What is not arbitrary is that there is
/// something to find. An agent at work has taken a turn nobody can take back
/// except by saying so, and every one of them says how — which makes the offer
/// the one thing on the screen that is there while it works and gone the moment
/// it stops.
///
/// Measured rather than guessed. Claude Code 2.1 draws `esc to interrupt` on
/// its bottom line and `? for shortcuts` there the rest of the time; Codex 0.153
/// draws `• Working (2s • esc to interrupt)` above its composer and takes the
/// whole line away when the answer lands. Adding an agent that says it another
/// way is adding a line.
///
/// `cancel` is not one of these, and is the reason the list is words rather than
/// the shape of a hint: an agent that has stopped to ask a question draws
/// `Esc to cancel` under it, and a question standing is the one thing here that
/// is most certainly not the agent working.
const STOPPING: [&str; 3] = ["esc to interrupt", "esc interrupt", "esc to stop"];

/// What stands in front of a command without being one: the environment it is
/// given, and the programs whose whole job is to run the next word along.
const LAUNCHERS: [&str; 9] = [
    "npx", "bunx", "pnpx", "uvx", "sudo", "env", "exec", "command", "time",
];

/// What a session is doing, out of its screen and the last thing typed at it.
///
/// The two are read together on purpose. The screen says whether anybody is
/// being waited for; it cannot say what they are waiting for, because an
/// agent's composer and a shell's prompt are the same thing to a terminal. So
/// what was typed says which program is up, and the terminal having been taken
/// over says it is still up — which is a fact about the terminal rather than a
/// guess about the program.
pub fn doing(screen: &Screen, started: Option<&str>) -> Doing {
    let standing = screen.standing();
    if standing.taken && started.is_some_and(agent) {
        // An agent is the session itself for the whole of its run, so what is
        // left to say is only which half of that run this is.
        return match working(&screen.lines()) {
            true => Doing::Working,
            false => Doing::Agent,
        };
    }
    // What is in front of the caret, with nothing trimmed off the end of it:
    // the space after a shell's sigil is the whole of what says the sigil is a
    // prompt rather than the last letter of a word, and a line trimmed to fit
    // would have thrown it away.
    if waiting(&screen.upto(standing.row, standing.col)) {
        return Doing::Idle;
    }
    Doing::Running
}

/// Whether the agent drawing this screen is working rather than waiting.
///
/// The whole screen rather than the foot of it. The two agents measured put the
/// offer in different places — Claude Code under its composer, Codex above it —
/// and neither place is the other's, so what is looked for is the words and not
/// where they landed.
fn working(lines: &[String]) -> bool {
    lines.iter().any(|line| {
        let said = line.to_lowercase();
        STOPPING.iter().any(|offer| said.contains(offer))
    })
}

/// Whether what is in front of the caret is somewhere a command could be typed.
///
/// `glyph::typed_at` asks nearly this, and is not used: it is asked of a line
/// an agent drew, where anything that could be a prompt is worth standing back
/// from, and this is asked of every run of output every session makes. A
/// command that redraws one line as it goes leaves the caret at the end of that
/// line rather than at the start of the next, so what is read here is the whole
/// of `rsync: 45% 1.2MB/s` — and a `%` with a space after it would say that the
/// session running it is standing idle. Which is the one command in the world
/// this mark exists for.
///
/// So a sigil with a number in front of it is a measurement rather than a
/// prompt. Everything else about the reading is `typed_at`'s.
fn waiting(text: &str) -> bool {
    let sigil = |letter: char| MARKERS.contains(&letter) || SIGILS.contains(&letter);
    if text.chars().next().is_some_and(sigil) {
        return true;
    }
    let mut before: Option<char> = None;
    let mut letters = text.chars().peekable();
    while let Some(letter) = letters.next() {
        if sigil(letter)
            && letters.peek() == Some(&' ')
            && !before.is_some_and(|last| last.is_ascii_digit())
        {
            return true;
        }
        before = Some(letter);
    }
    false
}

/// Whether a line somebody typed starts one of the agents.
fn agent(said: &str) -> bool {
    ran(said).is_some_and(|name| AGENTS.contains(&name.as_str()))
}

/// The program a line runs: the first word that is not a variable being set for
/// it, a switch handed to whatever comes next, or a launcher standing in front
/// of it — under the name it was installed as rather than the path it was
/// reached by.
fn ran(said: &str) -> Option<String> {
    said.split_whitespace()
        .find(|word| {
            !word.contains('=')
                && !word.starts_with('-')
                && !LAUNCHERS.contains(&word.to_lowercase().as_str())
        })
        .map(installed)
}

/// A word as the name of a program: the last part of whatever path it was
/// written as, without the ending Windows hangs on the end of one.
fn installed(word: &str) -> String {
    let name = word.rsplit(['/', '\\']).next().unwrap_or(word);
    let name = name.to_lowercase();
    for ending in [".exe", ".cmd", ".bat", ".ps1"] {
        if let Some(stem) = name.strip_suffix(ending) {
            return stem.to_string();
        }
    }
    name
}
