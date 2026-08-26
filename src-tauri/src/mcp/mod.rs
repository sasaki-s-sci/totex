//! What a session says it is working on, told by whatever is running in it.
//!
//! The questions an agent asks are read off the screen it drew them on, because
//! a terminal has no interface to ask through — see `ask`. What an agent is
//! *doing* is the other half of that, and it does have an interface: the agents
//! all speak MCP. So this is a server standing beside the sessions, and a report
//! arrives as a sentence rather than as a picture of one.
//!
//! Three things follow from it being a server rather than a reading. It is
//! **opted into**, because a program that opens a port nobody asked for is doing
//! something on the person's machine that they did not ask for. It is
//! **addressed** — every session is handed a door of its own, made with keys
//! this run invented, so a report needs no name in it: the whole address in
//! `TOTEX_MCP_URL` for an agent that can expand one, and the same token on its
//! own in `TOTEX_MCP_TOKEN` for an agent that can only carry it in a request.
//! And what it holds **cannot be worked out again**: a report is not in the
//! session's output at all, so `rederive` leaves it alone and it goes when the
//! session goes.

mod address;
mod door;
mod http;
mod install;
mod report;
mod rpc;
mod serve;

#[cfg(test)]
mod tests;

use std::collections::HashMap;
use std::collections::hash_map::RandomState;
use std::sync::atomic::{AtomicBool, AtomicU16};
use std::sync::{Arc, Mutex, MutexGuard};

use serde::Serialize;
use tauri::{AppHandle, Runtime};

pub use door::{attend, serve, serving, unserve};
pub use install::{Agent, Setup};
pub use report::{keep, reports, session_of};

/// Carries what a session says it is doing, and its going away again. Sent
/// whether or not a terminal is being drawn for it: the panel is only one of the
/// places what is happening in there can be seen.
pub const REPORT_EVENT: &str = "mcp:report";

/// What a session is told its own address in. The name is the whole of the
/// registration an agent that expands one is set up with — see `install` — so
/// it is written down once, here.
pub const ADDRESS_VAR: &str = "TOTEX_MCP_URL";

/// And what it is told the same session's token in, for an agent registered
/// against the one door rather than against a door of its own. It says exactly
/// what the address says; which of the two an agent is given is a fact about
/// the agent, and about nothing else.
pub const TOKEN_VAR: &str = "TOTEX_MCP_TOKEN";

/// The one address this server answers on. Never the machine's own address on a
/// network: what stands behind this door is a way to write on somebody's window.
const LOOPBACK: &str = "127.0.0.1";

/// The port asked for before any other.
///
/// A registration that names a variable never goes stale, and an agent that can
/// be given one is given one. An agent that can only be told a literal address
/// has this number written into its own settings instead — so it has to be the
/// same number tomorrow, which is the whole reason it is a constant here rather
/// than whatever the machine had free. Above the well-known ports and below the
/// range either this machine or Windows hands out to whoever asks for any port
/// at all, which is as far out of the way as a port nobody owns can be kept.
const DOOR: u16 = 26374;

/// The one door, as against a session's own `/s/...`: what stands behind it is
/// the session named by the token in the request instead of by the address.
const DOOR_PATH: &str = "/mcp";

/// One step of whatever a session is working through.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Step {
    pub title: String,
    /// Finished. The first one that is not is the one being worked on, which is
    /// why there is no third state here for the card to draw.
    pub done: bool,
}

/// What a session is working on, in its own words.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    /// One line: what is being done right now.
    pub doing: String,
    /// The plan that line is a step of, in order, or nothing where there is no
    /// plan — which is most of the time, and is a card with one line on it.
    pub steps: Vec<Step>,
}

impl Report {
    /// Nothing to show, which is how a session says it has stopped rather than
    /// leaving the last thing it was doing standing on the graph forever.
    fn empty(&self) -> bool {
        self.doing.is_empty() && self.steps.is_empty()
    }
}

/// A session, and what it says it is doing — or, with nothing in it, that there
/// is nothing to show.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Reported {
    pub id: String,
    pub report: Option<Report>,
}

/// The server while it is standing, which is only while it has been asked for.
struct Standing {
    /// The port the loopback listener took, whichever one was free: the
    /// registration names an environment variable and not a port, so nothing
    /// outside this app ever has to have heard of this number.
    port: u16,
    /// Set when the listener is to stop, and read by it between connections.
    stopping: Arc<AtomicBool>,
}

/// The server, and what the sessions have said through it.
///
/// The two things that make an address are deliberately not part of the door: a
/// terminal is handed its address once, as it starts, and if the address meant
/// something else afterwards then switching the server off and on again would
/// quietly cut off every agent already running.
#[derive(Default)]
pub struct McpState {
    /// What a session's address is made with, for as long as this app runs.
    /// Seeded by the machine, so an address cannot be worked out from the name
    /// of a session by anything that did not open it.
    keys: RandomState,
    /// The port the last server took, asked for again when the server is stood
    /// up a second time so that terminals holding the old address are right.
    last: AtomicU16,
    standing: Mutex<Option<Standing>>,
    said: Mutex<HashMap<String, Report>>,
}

impl McpState {
    fn standing(&self) -> MutexGuard<'_, Option<Standing>> {
        crate::sync::lock(&self.standing)
    }

    fn said(&self) -> MutexGuard<'_, HashMap<String, Report>> {
        crate::sync::lock(&self.said)
    }
}

/// The port the server is on, or nothing when it is not standing.
#[tauri::command]
pub fn mcp_serving<R: Runtime>(app: AppHandle<R>) -> Option<u16> {
    serving(&app)
}

/// Stands it up, and says which port it took. Off the window's own thread:
/// standing a server that was taken down a moment ago waits for its own port to
/// come free, and that is not a wait to hold a window still for.
#[tauri::command(async)]
pub fn mcp_serve<R: Runtime>(app: AppHandle<R>) -> Result<u16, String> {
    serve(&app)
}

/// Takes it down.
#[tauri::command]
pub fn mcp_stop<R: Runtime>(app: AppHandle<R>) {
    unserve(&app);
}

/// Everything being worked on right now.
#[tauri::command]
pub fn mcp_reports<R: Runtime>(app: AppHandle<R>) -> Vec<Reported> {
    reports(&app)
}

/// What each agent would be set up with, in the words somebody could have typed
/// themselves.
///
/// The port in a line is the one standing where there is a server, and the one
/// that would be asked for where there is not: this page is read before the
/// switch is touched at least as often as after it, and a line that says
/// nothing until something else has been turned on is a line nobody can act on.
#[tauri::command]
pub fn mcp_setups<R: Runtime>(app: AppHandle<R>) -> Vec<Setup> {
    install::setups(serving(&app).unwrap_or(DOOR))
}

/// Registers this server with one coding agent on this machine, once and for
/// all its sessions.
#[tauri::command(async)]
pub fn mcp_install<R: Runtime>(app: AppHandle<R>, agent: Agent) -> Result<String, String> {
    install::into_agent(agent, serving(&app).unwrap_or(DOOR))
}
