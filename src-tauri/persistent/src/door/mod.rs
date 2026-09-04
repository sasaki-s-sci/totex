//! What a session says it is working on, told by whatever is running in it.
//!
//! The questions an agent asks are read off the screen it drew them on, because
//! a terminal has no interface to ask through — that reading is the window's.
//! What an agent is *doing* is the other half of that, and it does have an
//! interface: the agents all speak MCP. So this is a server standing beside the
//! sessions, and a report arrives as a sentence rather than as a picture of one.
//!
//! Three things follow from it being a server rather than a reading. It is
//! **opted into**, because a program that opens a port nobody asked for is doing
//! something on the person's machine that they did not ask for. It is
//! **addressed** — every session is handed a door of its own, made with keys
//! this run invented, so a report needs no name in it: the whole address in
//! `TOTEX_MCP_URL` for an agent that can expand one, and the same token on its
//! own in `TOTEX_MCP_TOKEN` for an agent that can only carry it in a request.
//! And what it holds **cannot be worked out again**: a report is not in the
//! session's output at all, so it goes when the session goes and not before —
//! which is why it is held here, beside the sessions, and not in the window.

mod address;
mod http;
pub mod install;
mod report;
mod rpc;
mod serve;

#[cfg(test)]
mod tests;

use std::collections::HashMap;
use std::collections::hash_map::RandomState;
use std::sync::atomic::{AtomicBool, AtomicU16, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};

use serde::{Deserialize, Serialize};
use totex_host::sync::lock;

use crate::session::{Event, Sessions};

pub use install::{Agent, Setup};

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
#[derive(Clone, Debug, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Step {
    pub title: String,
    /// Finished. The first one that is not is the one being worked on, which is
    /// why there is no third state here for the card to draw.
    pub done: bool,
}

/// What a session is working on, in its own words.
#[derive(Clone, Debug, PartialEq, Deserialize, Serialize)]
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
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Reported {
    pub id: String,
    pub report: Option<Report>,
}

/// Something told every report as it lands, which is the socket a window is at
/// the other end of.
pub type Reporter = Arc<dyn Fn(&Reported) + Send + Sync>;

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
/// The two things that make an address are deliberately not part of the
/// standing: a terminal is handed its address once, as it starts, and if the
/// address meant something else afterwards then switching the server off and
/// on again would quietly cut off every agent already running.
pub struct Door {
    /// What a session's address is made with, for as long as this program
    /// runs. Seeded by the machine, so an address cannot be worked out from
    /// the name of a session by anything that did not open it.
    keys: RandomState,
    /// The port the last server took, asked for again when the server is stood
    /// up a second time so that terminals holding the old address are right.
    last: AtomicU16,
    standing: Mutex<Option<Standing>>,
    said: Mutex<HashMap<String, Report>>,
    /// The sessions the doors are for: which of them is running is what says
    /// whether an address is anybody's.
    sessions: Arc<Sessions>,
    reporting: Mutex<Vec<Reporter>>,
}

impl Door {
    /// A door beside these sessions, joined to them.
    ///
    /// Two seams, both the sessions' own: every session that starts is handed
    /// the address of its own door in its environment, and this side is told
    /// when one has ended. A report is kept for exactly as long as the session
    /// is there to correct it — after that it is a claim about a process that
    /// no longer exists, which is worse than nothing.
    pub fn new(sessions: Arc<Sessions>) -> Arc<Self> {
        let door = Arc::new(Self {
            keys: RandomState::new(),
            last: AtomicU16::new(0),
            standing: Mutex::new(None),
            said: Mutex::new(HashMap::new()),
            sessions: Arc::clone(&sessions),
            reporting: Mutex::new(Vec::new()),
        });

        let dressing = Arc::clone(&door);
        sessions.dress(Arc::new(move |id, cwd| {
            // Nothing at all while the server is down, or where the session
            // could not reach it: an agent told an address it cannot use is an
            // agent that reports a connection nobody asked it to make.
            address::dressing(&dressing, id, cwd)
        }));

        let ending = Arc::clone(&door);
        sessions.follow(Arc::new(move |id, event| {
            if !matches!(event, Event::Ended) {
                return;
            }
            if ending.said().remove(id).is_none() {
                return;
            }
            ending.tell(&Reported {
                id: id.to_string(),
                report: None,
            });
        }));

        door
    }

    fn standing(&self) -> MutexGuard<'_, Option<Standing>> {
        lock(&self.standing)
    }

    fn said(&self) -> MutexGuard<'_, HashMap<String, Report>> {
        lock(&self.said)
    }

    /// Adds something that is told every report, for the life of the program.
    pub fn follow(&self, reporter: Reporter) {
        lock(&self.reporting).push(reporter);
    }

    fn tell(&self, reported: &Reported) {
        let reporting: Vec<Reporter> = lock(&self.reporting).clone();
        for reporter in reporting {
            reporter(reported);
        }
    }

    /// The port the server is on, or nothing when it is not standing.
    pub fn serving(&self) -> Option<u16> {
        self.standing().as_ref().map(|up| up.port)
    }

    /// Stands the server up, and says which port it took.
    ///
    /// Idempotent: asking for a server that is already up is being told where
    /// it is. Nothing about the sessions changes here — a terminal is handed
    /// its address when it starts, so the ones already running stay without
    /// one.
    pub fn serve(self: &Arc<Self>) -> Result<u16, String> {
        let mut standing = self.standing();
        if let Some(up) = standing.as_ref() {
            return Ok(up.port);
        }

        let up = serve::listen(Arc::clone(self), self.last.load(Ordering::Relaxed))?;
        let port = up.port;
        self.last.store(port, Ordering::Relaxed);
        *standing = Some(up);
        Ok(port)
    }

    /// Takes it down again, and takes the reports with it: with the door shut
    /// no agent can say what it is doing now, and a card that cannot be
    /// corrected is a card that will be wrong. The sessions carry on — none of
    /// this was theirs.
    pub fn unserve(&self) {
        if let Some(up) = self.standing().take() {
            up.stopping.store(true, Ordering::Relaxed);
        }

        let dropped: Vec<String> = self.said().drain().map(|(id, _)| id).collect();
        for id in dropped {
            self.tell(&Reported { id, report: None });
        }
    }

    /// Everything being worked on right now, for a window that has just come
    /// up. The event carries these from moment to moment; a window that only
    /// listened would show nothing until an agent next happened to say
    /// something.
    pub fn reports(&self) -> Vec<Reported> {
        report::reports(self)
    }

    /// What each agent would be set up with, in the words somebody could have
    /// typed themselves.
    ///
    /// The port in a line is the one standing where there is a server, and the
    /// one that would be asked for where there is not: this page is read before
    /// the switch is touched at least as often as after it, and a line that
    /// says nothing until something else has been turned on is a line nobody
    /// can act on.
    pub fn setups(&self) -> Vec<Setup> {
        install::setups(self.serving().unwrap_or(DOOR))
    }

    /// Registers this server with one coding agent on this machine, once and
    /// for all its sessions.
    pub fn install(&self, agent: Agent) -> Result<String, String> {
        install::into_agent(agent, self.serving().unwrap_or(DOOR))
    }
}
