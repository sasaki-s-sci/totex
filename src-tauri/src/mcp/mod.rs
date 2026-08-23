//! What a session says it is working on, told by whatever is running in it.
//!
//! The questions an agent asks are read off the screen it drew them on, because
//! a terminal is a stream of bytes for drawing with and there is no interface
//! to ask through — see `ask`. What an agent is *doing* is the other half of
//! that, and it does have an interface: the agents all speak MCP, and a server
//! is something they can be pointed at and told to say things to. So this is
//! one, standing beside the sessions, and a report arrives as a sentence rather
//! than as a picture of one.
//!
//! Three things follow from it being a server rather than a reading.
//!
//! It is opted into. A reading takes what a session was going to draw anyway;
//! this asks the thing in the terminal to say something it would not otherwise
//! have said, so it only works where somebody has registered the server with
//! their agent, and it is off until it is turned on. A program that opens a
//! port nobody asked for is a program doing something on the person's machine
//! that they did not ask for.
//!
//! It is addressed. Every session is handed an address of its own when it
//! starts — `TOTEX_MCP_URL` in its environment, which is what the registration
//! is written against — so a report needs no name in it: what is doing the
//! reporting is which door it knocked on. The addresses are made with keys this
//! run of the app invented, so one cannot be worked out from the name of a
//! session, and the server answers on the loopback address and nowhere else.
//!
//! And what it holds cannot be worked out again. Everything else the app keeps
//! beside a session is derived — throw the screens away and the same questions
//! come back out of the same output, which is what `derived` is about — but a
//! report is not in the output at all. It is a thing that was said once, the
//! same as the session's own backlog, and if it is dropped nothing brings it
//! back until the agent next says something. So `rederive` leaves it alone, and
//! it goes when the session it belongs to goes, and not before.

use std::collections::HashMap;
use std::collections::hash_map::RandomState;
use std::hash::BuildHasher;
use std::sync::atomic::{AtomicBool, AtomicU16, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, OnceLock};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, Runtime};

use crate::host::Host;
use crate::pty::{self, Event, PtyState};
use crate::wsl;

mod install;
mod rpc;
mod serve;

#[cfg(test)]
mod tests;

/// Carries what a session says it is doing, and its going away again.
///
/// Sent whether or not a terminal is being drawn for the session, for the same
/// reason a question is: what is happening in there is worth seeing from the
/// canvas, and the panel is only one of the places it can be seen.
pub const REPORT_EVENT: &str = "mcp:report";

/// What a session is told its own address in.
///
/// The name is the whole of the registration an agent is set up with — see
/// `install` — so it is written down once, here, and read by the two things
/// that have to agree about it.
pub const ADDRESS_VAR: &str = "TOTEX_MCP_URL";

/// The one address this server answers on.
///
/// Loopback, and never the machine's own address on a network: what stands
/// behind this door is a way to write on somebody's window, and the only thing
/// that has any business doing that is a program already running on their
/// machine.
const LOOPBACK: &str = "127.0.0.1";

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
    /// The port the loopback listener took, which the addresses are built from.
    ///
    /// Whichever one was free rather than one of ours: the registration an
    /// agent is set up with names an environment variable and not a port, so
    /// nothing outside this app ever has to have heard of this number.
    port: u16,
    /// Set when the listener is to stop, and read by it between connections.
    stopping: Arc<AtomicBool>,
}

/// The server, and what the sessions have said through it.
///
/// The door can be shut and opened again, and the two things that make an
/// address are deliberately not part of the door. A terminal is handed its
/// address once, as it starts; if the address meant something else afterwards,
/// switching the server off and on again would quietly cut off every agent
/// already running — which is not what switching something off and on again is
/// supposed to do.
#[derive(Default)]
pub struct McpState {
    /// What a session's address is made with, for as long as this app runs.
    ///
    /// Seeded by the machine, so an address cannot be worked out from the name
    /// of a session by anything that did not open it — and so that the
    /// addresses handed out by one run of the app mean nothing to the next.
    keys: RandomState,
    /// The port the last server took, or nought when there has not been one.
    ///
    /// Asked for again when the server is stood up a second time, so that the
    /// terminals holding the old address are holding the right one. Whether it
    /// is still free is the machine's business, and where it is not the next
    /// free port is taken instead.
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

/// The port the server is answering on, or nothing when it is not up.
pub fn serving<R: Runtime>(app: &AppHandle<R>) -> Option<u16> {
    app.state::<McpState>()
        .standing()
        .as_ref()
        .map(|up| up.port)
}

/// Stands the server up, and says which port it took.
///
/// Idempotent: asking for a server that is already up is being told where it
/// is. Nothing about the sessions changes here — a terminal is handed its
/// address when it starts, so the ones already running were started without one
/// and stay without one, which is the honest answer to a server that was not
/// there when they began.
pub fn serve<R: Runtime>(app: &AppHandle<R>) -> Result<u16, String> {
    let state = app.state::<McpState>();
    let mut standing = state.standing();
    if let Some(up) = standing.as_ref() {
        return Ok(up.port);
    }

    let up = serve::listen(app.clone(), state.last.load(Ordering::Relaxed))?;
    let port = up.port;
    state.last.store(port, Ordering::Relaxed);
    *standing = Some(up);
    Ok(port)
}

/// Takes it down again, and takes the reports with it.
///
/// The reports go because they are the one thing here nobody can refresh: with
/// the door shut no agent can say what it is doing now, and a card that cannot
/// be corrected is a card that will be wrong. The sessions themselves carry on
/// — none of this was ever theirs.
pub fn unserve<R: Runtime>(app: &AppHandle<R>) {
    let state = app.state::<McpState>();
    if let Some(up) = state.standing().take() {
        up.stopping.store(true, Ordering::Relaxed);
    }

    let dropped: Vec<String> = state.said().drain().map(|(id, _)| id).collect();
    for id in dropped {
        let _ = app.emit(REPORT_EVENT, Reported { id, report: None });
    }
}

/// Where a session running in `cwd` is to say what it is doing, if it can reach
/// the server at all.
///
/// Handed to a shell as it starts and never again: this is an address in an
/// environment, and an environment is set once. So a terminal opened before the
/// server went up has no address in it, and turning the server on does not
/// reach back into it — the terminal opened after it does.
pub fn address<R: Runtime>(app: &AppHandle<R>, id: &str, cwd: &str) -> Option<String> {
    // Read and let go of before anything else happens: what follows can ask a
    // distribution a question, and every other door would be waiting on the
    // answer.
    let (port, keys) = {
        let state = app.state::<McpState>();
        let standing = state.standing();
        (standing.as_ref()?.port, state.keys.clone())
    };
    let host = reachable(cwd)?;
    Some(format!("http://{host}:{port}/s/{}", token(&keys, id)))
}

/// Which session an address belongs to, out of the ones actually running.
///
/// Nothing is kept to answer this. The addresses are made from the names of the
/// sessions, and what is running is only ever true where the processes are — so
/// the question is asked of them, and a session that has ended stops answering
/// its own door without anything having to be told to forget it.
pub fn session_of<R: Runtime>(app: &AppHandle<R>, offered: &str) -> Option<String> {
    // The keys are taken and the lock let go of before the sessions are asked
    // about: this side asks that one what is running, and that one asks this
    // side what to put in a session's environment, so neither may be holding
    // anything of its own while it does.
    let keys = {
        let state = app.state::<McpState>();
        state.standing().as_ref()?;
        state.keys.clone()
    };
    pty::running(app)
        .into_iter()
        .find(|session| token(&keys, &session.id) == offered)
        .map(|session| session.id)
}

/// Keeps what a session said, and tells the window.
///
/// An empty report is a session saying there is nothing to show, which is the
/// same thing to the window as never having said anything — so it is cleared
/// rather than kept as an empty card.
pub fn keep<R: Runtime>(app: &AppHandle<R>, id: &str, report: Report) {
    let state = app.state::<McpState>();
    let report = {
        let mut said = state.said();
        if report.empty() {
            said.remove(id);
            None
        } else {
            if said.get(id) == Some(&report) {
                return;
            }
            said.insert(id.to_string(), report.clone());
            Some(report)
        }
    };

    let _ = app.emit(
        REPORT_EVENT,
        Reported {
            id: id.to_string(),
            report,
        },
    );
}

/// Everything being worked on right now, for a window that has just come up.
///
/// The event is what carries these from moment to moment; this is the first
/// look, for the same reason the questions have one — a window that only
/// listened would show nothing until an agent next happened to say something,
/// which for one that is halfway through a long step is a long time.
pub fn reports<R: Runtime>(app: &AppHandle<R>) -> Vec<Reported> {
    app.state::<McpState>()
        .said()
        .iter()
        .map(|(id, report)| Reported {
            id: id.clone(),
            report: Some(report.clone()),
        })
        .collect()
}

/// Joins this to the sessions, for the life of the app.
///
/// Two seams, and both of them the session module's own. Every session that
/// starts is handed the address of its own door in its environment — which is
/// the whole of how an agent ever hears about any of this — and this side is
/// told when one has ended.
///
/// A report is something a session said, and it is kept for exactly as long as
/// the session is there to correct it. After that it is a claim about a process
/// that no longer exists, which is worse than nothing.
pub fn attend<R: Runtime>(app: &AppHandle<R>) {
    let dressing = app.clone();
    app.state::<PtyState>().dress(Arc::new(move |id, cwd| {
        // Nothing at all while the server is down, or where the session could
        // not reach it: an agent that is told an address it cannot use is an
        // agent that reports a connection nobody asked it to make.
        match address(&dressing, id, cwd) {
            Some(url) => vec![(ADDRESS_VAR.to_string(), url)],
            None => Vec::new(),
        }
    }));

    let handle = app.clone();
    app.state::<PtyState>().follow(Arc::new(move |id, event| {
        if !matches!(event, Event::Ended) {
            return;
        }
        let state = handle.state::<McpState>();
        if state.said().remove(id).is_none() {
            return;
        }
        let _ = handle.emit(
            REPORT_EVENT,
            Reported {
                id: id.to_string(),
                report: None,
            },
        );
    }));
}

/// A session's own door, which is the whole of what an address says.
fn token(keys: &RandomState, id: &str) -> String {
    format!("{:016x}", keys.hash_one(id))
}

/// The address a session working in `cwd` can reach this server at, or nothing
/// where it cannot reach it at all.
///
/// A session in a WSL distribution is the one case where loopback is not one
/// place. Under the networking WSL starts with, a distribution's `127.0.0.1` is
/// its own and not the window's, and the way across is an address on a virtual
/// network that the machine's firewall is set up to refuse — so the honest
/// answer there is that there is no address, and the agent in that terminal is
/// simply never told about any of this. Under mirrored networking the two
/// loopbacks are one, and it works the way it does on this side of the window.
fn reachable(cwd: &str) -> Option<&'static str> {
    match Host::of_str(cwd) {
        Host::Local => Some(LOOPBACK),
        Host::Wsl(distro) => shares_loopback(&distro).then_some(LOOPBACK),
    }
}

/// Whether a distribution's loopback is the same one this server is on.
///
/// Asked of the distribution once and remembered: this is a setting of the
/// machine's, it cannot change while a distribution is running, and the
/// question is otherwise asked every time a terminal is opened.
fn shares_loopback(distro: &str) -> bool {
    static KNOWN: OnceLock<Mutex<HashMap<String, bool>>> = OnceLock::new();
    let known = KNOWN.get_or_init(Mutex::default);

    if let Some(answer) = crate::sync::lock(known).get(distro) {
        return *answer;
    }

    // Anything that cannot answer is a no: an older distribution without
    // `wslinfo` is one from before mirrored networking existed.
    let answer = wsl::exec(distro, None, &[], &["wslinfo", "--networking-mode"])
        .map(|said| said.ok() && said.text().trim() == "mirrored")
        .unwrap_or(false);
    crate::sync::lock(known).insert(distro.to_string(), answer);
    answer
}

/// The port the server is on, or nothing when it is not standing.
#[tauri::command]
pub fn mcp_serving<R: Runtime>(app: AppHandle<R>) -> Option<u16> {
    serving(&app)
}

/// Stands it up, and says which port it took.
///
/// Off the window's own thread: standing a server that was taken down a moment
/// ago waits for its own port to come free, and that is not a wait to hold a
/// window still for.
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

/// Registers this server with a coding agent on this machine, once and for all
/// its sessions.
#[tauri::command(async)]
pub fn mcp_install() -> Result<String, String> {
    install::into_claude_code()
}
