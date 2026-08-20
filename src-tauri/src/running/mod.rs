//! Every coding agent running on this machine, and where it is working.
//!
//! The window already draws what it started itself. This is the other half:
//! the agents nobody in this window opened — a terminal in another shell, a
//! background run somebody left going, the session that is editing this very
//! checkout — placed against the same repositories and branches the graph is
//! already drawn from.
//!
//! ## What the three agree on
//!
//! They keep their state in three different shapes, and only these fields are
//! in all of them:
//!
//! | | Claude Code | Codex | opencode |
//! | --- | --- | --- | --- |
//! | where | `~/.claude/sessions/<pid>.json` | rollout `session_meta.cwd` | the process |
//! | its own id | `sessionId` | `session_id` | in a database |
//! | doing what | `status` + `waitingFor` | last write to the rollout | — |
//! | started by | the process tree | the rollout's own subagent line | the process tree |
//!
//! A working directory is the one thing every one of them has, and it is also
//! the one that answers the question being asked — which repository, which
//! branch — so it is what everything here is keyed on. The rest is depth: what
//! each tool happens to publish is added on top, and `source` says which of the
//! two an agent was known from.
//!
//! ## How it is read
//!
//! By sweeping, not by watching. There is no file to watch for "a process
//! started": `/proc` has no notifications, and the session files answer whether
//! an agent is busy but not whether it is alive. So the machine is looked at
//! every couple of seconds, and the window is told only when the answer moved.

pub mod claude;
pub mod codex;
pub mod opencode;
pub mod place;
pub mod proc;

#[cfg(test)]
mod tests;

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Runtime, State};

/// Carries the whole picture whenever any part of it moved.
pub const CHANGED_EVENT: &str = "running:changed";

/// How often the machine is looked at.
///
/// Slow enough to be nothing — a few dozen small reads — and fast enough that
/// an agent that has just been asked something reads as busy while the person
/// who asked is still looking at the window.
const SWEEP: Duration = Duration::from_millis(2_000);

/// How recently a Codex rollout must have been written to read as working.
///
/// Codex appends to its rollout as the turn goes, so a file touched a moment
/// ago is a thread mid-answer. This is the one activity here that is inferred
/// rather than published, and the window says as much.
const CODEX_ACTIVE_MS: u64 = 20_000;

/// How far up the process tree to look for the agent that started this one.
///
/// An agent rarely starts another directly: there is a shell in between, and
/// often the terminal that shell is in. Deep enough to see through that, short
/// enough that everything on the machine does not end up hanging off one login.
const ANCESTRY_DEPTH: usize = 8;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Tool {
    Claude,
    Codex,
    Opencode,
}

impl Tool {
    /// The three commands, by the name they are typed as.
    fn of(program: &str) -> Option<Self> {
        match program {
            "claude" => Some(Self::Claude),
            "codex" => Some(Self::Codex),
            "opencode" => Some(Self::Opencode),
            _ => None,
        }
    }
}

/// What an agent is doing, as far as it says.
///
/// `Waiting` is its own state rather than a kind of idle: an agent that has
/// stopped to ask something is the one thing on this map worth walking over to.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Activity {
    Busy,
    Idle,
    Waiting,
    Unknown,
}

/// How much is known about an agent, which is not the same for all three.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Source {
    /// Seen running, and nothing more than that.
    Process,
    /// Its own session file said so, without a process to confirm it.
    Session,
    Both,
}

/// One agent, in the terms all three of them have in common.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Agent {
    /// This agent and no other, steady from one sweep to the next — which is
    /// what lets the canvas keep a node where it was instead of redrawing it.
    pub key: String,
    pub tool: Tool,
    pub pid: Option<u32>,
    /// The agent that started this one, by key, when one did.
    pub parent: Option<String>,
    /// The id the tool itself knows the session by, which is what its own
    /// `resume` takes.
    pub session_id: Option<String>,
    pub name: Option<String>,
    pub cwd: String,
    /// The repository, the checkout and the branch the directory turned out to
    /// be in — all absent together when it is not in a repository at all.
    pub repo: Option<String>,
    pub worktree: Option<String>,
    pub branch: Option<String>,
    pub head: Option<String>,
    pub activity: Activity,
    /// Started to run on its own rather than to be talked to.
    pub background: bool,
    /// Started by this window, which already draws it as a session of its own.
    ///
    /// The window opens agents in its own terminals, so they turn up in the
    /// sweep like anything else — as descendants of this very process, which is
    /// how they are told apart from the ones somebody else started.
    pub own: bool,
    pub version: Option<String>,
    /// Milliseconds since the epoch.
    pub started_at: Option<u64>,
    pub updated_at: Option<u64>,
    pub source: Source,
}

/// The machine, as of one sweep.
#[derive(Clone, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Running {
    /// In a settled order — by tool, then by directory — so that two sweeps
    /// that found the same thing are the same answer.
    pub agents: Vec<Agent>,
}

/// The user's home, which is where all three keep their state.
pub(crate) fn home() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
        .filter(|home| !home.as_os_str().is_empty())
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|since| since.as_millis() as u64)
        .unwrap_or_default()
}

// ------------------------------------------------------------------ the sweep

/// Looks at the machine once.
pub fn scan() -> Running {
    let mut table = proc::table();
    let sessions = claude::entries();

    if table.is_empty() {
        // Everywhere but Linux there is no way in to a process's working
        // directory, so only what the tools write down themselves is left —
        // which today is Claude Code and nobody else. The window is not told
        // that the picture is short: what it draws is the agents it was given,
        // and a shorter list is the same list drawn.
        return settle(from_sessions(&sessions));
    }

    // Codex rollouts and processes are both newest first. That matters when
    // two terminals share a worktree: each process must claim a different
    // rollout or React Flow would receive two nodes with the same id.
    table.sort_by(|left, right| {
        right
            .started_at
            .cmp(&left.started_at)
            .then_with(|| right.pid.cmp(&left.pid))
    });
    let threads = codex::recent();
    let mut claimed_codex = HashSet::new();
    let by_pid: HashMap<u32, &proc::Process> = table.iter().map(|one| (one.pid, one)).collect();
    let claimed: HashMap<u32, &claude::Entry> = sessions
        .iter()
        .filter_map(|entry| entry.pid.map(|pid| (pid, entry)))
        .collect();
    let now = now_ms();

    // One directory can hold several agents, and placing it means reading files;
    // this way it is read once per sweep however many are standing in it.
    let mut places: HashMap<PathBuf, Option<place::Place>> = HashMap::new();
    let mut agents = Vec::new();

    for process in &table {
        let Some(tool) = Tool::of(&process.program) else {
            continue;
        };
        let Some(cwd) = process.cwd.clone() else {
            // Running, but not readable — another user's, or gone between the
            // listing and the read. Nothing to draw it against.
            continue;
        };
        let placed = places
            .entry(cwd.clone())
            .or_insert_with(|| place::locate(&cwd))
            .clone();

        match tool {
            Tool::Claude => {
                let entry = claimed
                    .get(&process.pid)
                    .copied()
                    .filter(|entry| wrote(entry, process));
                agents.push(from_claude(process, &cwd, placed, entry));
            }
            Tool::Codex => {
                let thread = codex::claim_thread(&threads, &cwd, &mut claimed_codex);
                let agent = from_codex(process, &cwd, placed, thread);
                // A subagent is a thread of this very process rather than a
                // process of its own, so it is found beside its parent rather
                // than anywhere in the table, and hung off it here.
                if let Some(parent_session) =
                    thread.and_then(|thread| thread.meta.session_id.as_deref())
                {
                    for child_thread in codex::subagents_in(&threads, &cwd, parent_session) {
                        if let Some(child) = from_subagent(&agent, child_thread, now) {
                            agents.push(child);
                        }
                    }
                }
                agents.push(agent);
            }
            Tool::Opencode => agents.push(from_opencode(process, &cwd, placed)),
        }
    }

    claim_ours(&mut agents, &by_pid);
    link_parents(&mut agents, &by_pid);
    settle(agents)
}

/// Whether a session file was written by the process that has its number now.
///
/// Pids come round again on a machine that has been up a while, and a session
/// file outlives the session by however long it takes somebody to notice. The
/// kernel's start stamp is what tells the two apart, and a file too old to
/// carry one is taken at its word — it is still a file about this pid.
fn wrote(entry: &claude::Entry, process: &proc::Process) -> bool {
    match entry
        .proc_start
        .as_deref()
        .and_then(|stamp| stamp.trim().parse::<u64>().ok())
    {
        Some(ticks) => ticks == process.start_ticks,
        None => true,
    }
}

/// Puts the agents in a settled order, so that "nothing moved" is comparable.
fn settle(mut agents: Vec<Agent>) -> Running {
    agents.sort_by(|left, right| {
        (left.cwd.as_str(), left.key.as_str()).cmp(&(right.cwd.as_str(), right.key.as_str()))
    });
    Running { agents }
}

fn placed_fields(
    placed: Option<place::Place>,
) -> (
    Option<String>,
    Option<String>,
    Option<String>,
    Option<String>,
) {
    match placed {
        Some(place) => (
            Some(place.repo.to_string_lossy().into_owned()),
            Some(place.worktree.to_string_lossy().into_owned()),
            place.branch,
            place.head,
        ),
        None => (None, None, None, None),
    }
}

fn base(
    tool: Tool,
    key: String,
    process: Option<&proc::Process>,
    cwd: &Path,
    placed: Option<place::Place>,
) -> Agent {
    let (repo, worktree, branch, head) = placed_fields(placed);
    Agent {
        key,
        tool,
        pid: process.map(|process| process.pid),
        parent: None,
        session_id: None,
        name: None,
        cwd: cwd.to_string_lossy().into_owned(),
        repo,
        worktree,
        branch,
        head,
        activity: Activity::Unknown,
        background: false,
        own: false,
        version: None,
        started_at: process.and_then(|process| process.started_at),
        updated_at: None,
        source: if process.is_some() {
            Source::Process
        } else {
            Source::Session
        },
    }
}

/// A Claude Code session: the process says it is alive, its own file says what
/// it is doing.
fn from_claude(
    process: &proc::Process,
    cwd: &Path,
    placed: Option<place::Place>,
    entry: Option<&claude::Entry>,
) -> Agent {
    let key = match entry.and_then(|entry| entry.session_id.clone()) {
        Some(id) => format!("claude:{id}"),
        None => format!("claude:pid:{}", process.pid),
    };
    let mut agent = base(Tool::Claude, key, Some(process), cwd, placed);
    let Some(entry) = entry else {
        return agent;
    };

    agent.source = Source::Both;
    agent.session_id = entry.session_id.clone();
    agent.name = entry.name.clone();
    agent.version = entry.version.clone();
    agent.updated_at = entry.updated_at;
    agent.started_at = entry.started_at.or(agent.started_at);
    agent.background = entry.kind.as_deref() == Some("bg");
    agent.activity = match entry.status.as_deref() {
        // A session running a command of its own is working, and saying which
        // is more use than saying it twice.
        Some("busy") | Some("shell") => Activity::Busy,
        Some("idle") => Activity::Idle,
        Some("waiting") => Activity::Waiting,
        _ => Activity::Unknown,
    };
    agent
}

/// A Codex thread: the rollout says which thread it is, and when it was last
/// written to says whether the thread is mid-answer.
fn from_codex(
    process: &proc::Process,
    cwd: &Path,
    placed: Option<place::Place>,
    thread: Option<&codex::Thread>,
) -> Agent {
    let key = match thread.and_then(|thread| thread.meta.session_id.clone()) {
        Some(id) => format!("codex:{id}"),
        None => format!("codex:pid:{}", process.pid),
    };
    let mut agent = base(Tool::Codex, key, Some(process), cwd, placed);
    let Some(thread) = thread else {
        return agent;
    };

    agent.source = Source::Both;
    agent.session_id = thread.meta.session_id.clone();
    agent.version = thread.meta.cli_version.clone();
    agent.updated_at = thread.updated_at;
    agent.activity = match thread.updated_at {
        Some(written) if now_ms().saturating_sub(written) < CODEX_ACTIVE_MS => Activity::Busy,
        Some(_) => Activity::Idle,
        None => Activity::Unknown,
    };
    agent
}

/// A subagent of a running Codex, for as long as its thread is being written to.
///
/// It has no process of its own to be found by, so what stands in for being
/// alive is the rollout still moving. A subagent that has finished stops being
/// written to and drops off the map a moment later, which is the honest answer
/// — nothing on disk says a thread is over.
fn from_subagent(parent: &Agent, thread: &codex::Thread, now: u64) -> Option<Agent> {
    let written = thread.updated_at?;
    if now.saturating_sub(written) >= CODEX_ACTIVE_MS {
        return None;
    }

    let role = thread.subagent.clone()?;
    let key = format!("codex:{}", thread.rollout_id);
    Some(Agent {
        key,
        parent: Some(parent.key.clone()),
        pid: None,
        session_id: Some(thread.rollout_id.clone()),
        name: Some(role),
        activity: Activity::Busy,
        background: true,
        started_at: None,
        updated_at: thread.updated_at,
        source: Source::Session,
        ..parent.clone()
    })
}

/// An opencode run: what its command line says, which is all it says.
fn from_opencode(process: &proc::Process, cwd: &Path, placed: Option<place::Place>) -> Agent {
    let key = format!("opencode:pid:{}", process.pid);
    let mut agent = base(Tool::Opencode, key, Some(process), cwd, placed);
    let run = opencode::read(&process.args);
    agent.name = run.agent;
    agent
}

/// The Claude Code sessions on their own, for a machine whose processes cannot
/// be read.
fn from_sessions(entries: &[claude::Entry]) -> Vec<Agent> {
    entries
        .iter()
        .filter_map(|entry| {
            let cwd = PathBuf::from(entry.cwd.clone()?);
            let key = match entry.session_id.clone() {
                Some(id) => format!("claude:{id}"),
                None => format!("claude:pid:{}", entry.pid?),
            };
            let mut agent = base(Tool::Claude, key, None, &cwd, place::locate(&cwd));
            agent.pid = entry.pid;
            agent.session_id = entry.session_id.clone();
            agent.name = entry.name.clone();
            agent.version = entry.version.clone();
            agent.started_at = entry.started_at;
            agent.updated_at = entry.updated_at;
            agent.background = entry.kind.as_deref() == Some("bg");
            agent.activity = match entry.status.as_deref() {
                Some("busy") | Some("shell") => Activity::Busy,
                Some("idle") => Activity::Idle,
                Some("waiting") => Activity::Waiting,
                _ => Activity::Unknown,
            };
            Some(agent)
        })
        .collect()
}

/// Marks the agents this window started, which it already draws itself.
///
/// By descent rather than by anything the agent says: a terminal this window
/// opened runs a shell, the shell runs the agent, and neither of them writes
/// down whose they are. What they all are is children of this process.
fn claim_ours(agents: &mut [Agent], by_pid: &HashMap<u32, &proc::Process>) {
    let ours = std::process::id();
    for agent in agents.iter_mut() {
        agent.own = agent
            .pid
            .is_some_and(|pid| descends_from(pid, ours, by_pid));
    }

    // A subagent has no process of its own to be descended from anything, so
    // whose it is, is its parent's answer.
    let owned: HashMap<String, bool> = agents
        .iter()
        .map(|agent| (agent.key.clone(), agent.own))
        .collect();
    for agent in agents.iter_mut() {
        if agent.pid.is_none()
            && let Some(parent) = agent.parent.as_ref()
        {
            agent.own = owned.get(parent).copied().unwrap_or(false);
        }
    }
}

/// Whether `pid` is somewhere below `ancestor` in the process tree.
fn descends_from(pid: u32, ancestor: u32, by_pid: &HashMap<u32, &proc::Process>) -> bool {
    let mut walking = pid;
    // A tree cannot be deeper than the machine allows, and a table read while
    // processes were coming and going could still describe a ring. Neither is
    // worth looping forever over.
    for _ in 0..64 {
        if walking == ancestor {
            return true;
        }
        match by_pid.get(&walking) {
            Some(process) if process.ppid > 1 => walking = process.ppid,
            _ => return false,
        }
    }
    false
}

/// Hangs each agent off the agent that started it, where one did.
///
/// Through whatever is in between: an agent that opened a terminal that ran
/// another agent is still the reason the second one is there, and the shell in
/// the middle is not worth a node. This is also what a subagent looks like from
/// outside — a child process of the session that spawned it — which is as much
/// of one as any of the three will admit to from the outside.
fn link_parents(agents: &mut [Agent], by_pid: &HashMap<u32, &proc::Process>) {
    let owners: HashMap<u32, String> = agents
        .iter()
        .filter_map(|agent| agent.pid.map(|pid| (pid, agent.key.clone())))
        .collect();

    for agent in agents.iter_mut() {
        let Some(pid) = agent.pid else { continue };
        let mut walking = by_pid.get(&pid).map(|process| process.ppid);
        for _ in 0..ANCESTRY_DEPTH {
            let Some(next) = walking else { break };
            if next <= 1 {
                break;
            }
            if let Some(owner) = owners.get(&next) {
                if owner != &agent.key {
                    agent.parent = Some(owner.clone());
                }
                break;
            }
            walking = by_pid.get(&next).map(|process| process.ppid);
        }
    }
}

// --------------------------------------------------------------- the watching

#[derive(Default)]
pub struct RunningWatch {
    /// The flag the sweeping thread reads to know it is still wanted. Cleared
    /// rather than joined: a sweep is short, and the thread lets go on its own.
    going: Mutex<Option<Arc<AtomicBool>>>,
}

impl RunningWatch {
    fn stop(&self) {
        if let Some(going) = crate::sync::lock(&self.going).take() {
            going.store(false, Ordering::Relaxed);
        }
    }

    fn start(&self, going: Arc<AtomicBool>) -> bool {
        let mut held = crate::sync::lock(&self.going);
        if held.is_some() {
            return false;
        }
        *held = Some(going);
        true
    }
}

/// One look at the machine, for the window that has just opened.
#[tauri::command(async)]
pub fn running_scan() -> Running {
    scan()
}

/// Starts or stops the sweep behind `running:changed`.
///
/// Only while something is looking: the map is a panel that is opened and put
/// away again, and a window with it closed should not be reading `/proc` every
/// two seconds for the rest of the day.
#[tauri::command]
pub fn running_watch<R: Runtime>(app: AppHandle<R>, state: State<'_, RunningWatch>, on: bool) {
    if !on {
        state.stop();
        return;
    }

    let going = Arc::new(AtomicBool::new(true));
    if !state.start(going.clone()) {
        return;
    }

    std::thread::spawn(move || {
        let mut last: Option<Running> = None;
        while going.load(Ordering::Relaxed) {
            let next = scan();
            // Only when it moved. A machine with four agents sitting idle
            // produces the same answer every two seconds, and a window that
            // re-rendered on every one of them would be a window that is never
            // still.
            if last.as_ref() != Some(&next) {
                if app.emit(CHANGED_EVENT, &next).is_err() {
                    break;
                }
                last = Some(next);
            }
            std::thread::sleep(SWEEP);
        }
    });
}
