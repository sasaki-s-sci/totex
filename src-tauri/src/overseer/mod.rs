//! The overseer: an agent living in a terminal of its own, watching all the
//! others and writing one line beside each of them.
//!
//! Everything a window knows about its sessions is already read here — what is
//! running, what is being asked, what was typed, what an agent says it is
//! doing — but it is read as marks, and a mark says *that* a terminal wants
//! somebody, not *what* it wants. A person with ten terminals open reads that
//! by opening them one at a time. The overseer is somebody doing that reading
//! for them, all the time, and saying what they found in a line.
//!
//! So this is three things. A server on this machine's loopback the overseer
//! asks through — see `rpc` for what it can ask — which is in this program
//! rather than beside the terminals because everything it answers out of is a
//! reading this program takes. A journal of what changed — see `journal` — so
//! that the overseer can sleep until there is something to read rather than
//! read everything over and over. And the lines it writes, which are handed to
//! the canvas as they change and kept with the persistent half, so that a
//! window coming up again is drawn with them.
//!
//! What it cannot do is as deliberate as what it can: it has no way to type
//! into a session. A line is a thing the person may ignore; a keystroke is not.

mod http;
mod journal;
mod launch;
mod rpc;
mod serve;

#[cfg(test)]
mod tests;

use std::collections::HashMap;
use std::collections::hash_map::RandomState;
use std::hash::BuildHasher;
use std::sync::{Arc, Mutex, MutexGuard};

use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::{AppHandle, Emitter, Manager, Runtime};

use totex_persistent::door::Reported;

use crate::ask::{Ask, Doing};
use crate::pty::{self, Event};

use journal::{Journal, What};
use rpc::{Asking, Sight, Terminal};

/// Carries which session is the overseer, or nothing when there is none any
/// more.
pub const SESSION_EVENT: &str = "overseer:session";

/// Carries a line the overseer wrote beside a session, or its going away.
pub const STATUS_EVENT: &str = "overseer:status";

/// The document what has to outlive a window is kept under.
const NAME: &str = "overseer";

/// A session, and the line drawn beside it — or, with nothing in it, that
/// there is none any more.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    id: String,
    status: Option<String>,
}

/// What has to outlive a window: the overseer it is still talking to and how
/// it was told to reach this one.
///
/// The token and the port are in a file the agent read once as it started, so
/// a window coming up again has to stand at the same address with the same
/// token or the agent is talking to nobody. The lines are kept with them so
/// that the canvas is not blank between a window coming up and the overseer's
/// next look round.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Kept {
    token: Option<String>,
    session: Option<String>,
    port: Option<u16>,
    #[serde(default)]
    statuses: HashMap<String, String>,
}

#[derive(Default)]
struct Held {
    kept: Kept,
    /// The port the server stands on, once it is standing.
    standing: Option<u16>,
    /// The question each session was last said to be asking, by its name, so
    /// that a box redrawn with the mark on another line is not a change.
    asking: HashMap<String, u64>,
}

/// The overseer, as this window holds it.
#[derive(Default)]
pub struct Overseer {
    held: Mutex<Held>,
    journal: Journal,
}

impl Overseer {
    fn lock(&self) -> MutexGuard<'_, Held> {
        crate::sync::lock(&self.held)
    }

    fn own(&self) -> Option<String> {
        self.lock().kept.session.clone()
    }

    fn is_own(&self, id: &str) -> bool {
        self.lock().kept.session.as_deref() == Some(id)
    }

    /// Writes down what a reading of a session's screen found, where it is a
    /// change the overseer would want to hear about.
    fn noticed(&self, id: &str, turned: Option<Doing>, asked: Option<&Option<Ask>>) {
        let asking = {
            let mut held = self.lock();
            if held.kept.session.as_deref() == Some(id) {
                return;
            }
            asked.and_then(|ask| {
                let seq = ask.as_ref().map(|ask| ask.seq);
                let before = match seq {
                    Some(seq) => held.asking.insert(id.to_string(), seq),
                    None => held.asking.remove(id),
                };
                (before != seq).then(|| ask.as_ref().map(|ask| ask.question.clone()))
            })
        };
        if let Some(doing) = turned {
            self.journal.note(id, What::Doing { doing });
        }
        if let Some(question) = asking {
            self.journal.note(id, What::Asking { question });
        }
    }
}

/// Starts following the sessions for the overseer, and stands its server up
/// again where the overseer from before this window is still running.
///
/// Registered once, at setup, beside the reading in `ask::watch::attend`, and
/// for the same life: a follower belongs to the link it was given to, and this
/// window keeps one link from setup to exit.
pub fn attend<R: Runtime>(app: &AppHandle<R>) {
    let Some(overseer) = app
        .try_state::<Arc<Overseer>>()
        .map(|state| Arc::clone(&state))
    else {
        return;
    };
    let link = crate::persistent::link(app);

    let handle = app.clone();
    let following = Arc::clone(&overseer);
    link.follow(Arc::new(move |id, event| match event {
        Event::Opened { .. } => {
            if !following.is_own(id) {
                following.journal.note(id, What::Opened);
            }
        }
        Event::Ended => ended(&handle, &following, id),
        Event::Said { .. } | Event::Resized { .. } => {}
    }));

    let reporting = Arc::clone(&overseer);
    link.report_to(Arc::new(move |reported: &Reported| {
        if !reporting.is_own(&reported.id) {
            reporting.journal.note(
                &reported.id,
                What::Report {
                    report: reported.report.as_ref().map(|report| report.doing.clone()),
                },
            );
        }
    }));

    if !rise(app, &overseer) {
        // Off the setup thread: opening a shell waits on the persistent half,
        // and the window should not wait on it to come up.
        let handle = app.clone();
        // Nothing to say where it fails: with no overseer the canvas draws
        // what the agents say for themselves, as it did before there was one.
        std::thread::spawn(move || {
            let _ = summon(&handle, &overseer);
        });
    }
}

/// Takes back what an earlier window kept, as far as it is still true, and
/// says whether the overseer it names is still running.
fn rise<R: Runtime>(app: &AppHandle<R>, overseer: &Arc<Overseer>) -> bool {
    let Some(mut kept) = crate::persistent::link(app)
        .asked::<Option<Kept>>("store_get", json!({ "name": NAME }))
        .ok()
        .flatten()
    else {
        return false;
    };
    let running: Vec<String> = pty::running(app)
        .into_iter()
        .map(|session| session.id)
        .collect();
    let before = kept.clone();
    kept.session = kept.session.filter(|id| running.contains(id));
    kept.statuses.retain(|id, _| running.contains(id));
    let alive = kept.session.is_some();
    overseer.lock().kept = kept.clone();
    if kept != before {
        keep(app, kept);
    }
    alive && stand(app, overseer).is_ok()
}

/// A session has ended. Where it was the overseer there is no overseer any
/// more, and every line it wrote goes with it: a line nobody is keeping is a
/// line that will be wrong by the next time anybody reads it.
fn ended<R: Runtime>(app: &AppHandle<R>, overseer: &Overseer, id: &str) {
    let (gone, kept, own) = {
        let mut held = overseer.lock();
        held.asking.remove(id);
        if held.kept.session.as_deref() == Some(id) {
            held.kept.session = None;
            let gone: Vec<String> = held.kept.statuses.drain().map(|(id, _)| id).collect();
            (gone, held.kept.clone(), true)
        } else {
            let gone = held.kept.statuses.remove(id).map(|_| id.to_string());
            (gone.into_iter().collect(), held.kept.clone(), false)
        }
    };
    if !own {
        overseer.journal.note(id, What::Ended);
    }
    for id in &gone {
        let _ = app.emit(
            STATUS_EVENT,
            Status {
                id: id.clone(),
                status: None,
            },
        );
    }
    if own {
        let _ = app.emit(SESSION_EVENT, Option::<String>::None);
    }
    if own || !gone.is_empty() {
        keep(app, kept);
    }
}

/// Hands what a reading of a session found to the overseer's journal. Called
/// by `ask::watch::attend` outside its lock, with what it is about to tell the
/// window — and nothing at all in an app without an overseer to tell, which is
/// what every test of the reading is.
pub fn noticed<R: Runtime>(
    app: &AppHandle<R>,
    id: &str,
    turned: Option<Doing>,
    asked: Option<&Option<Ask>>,
) {
    if turned.is_none() && asked.is_none() {
        return;
    }
    if let Some(overseer) = app.try_state::<Arc<Overseer>>() {
        overseer.noticed(id, turned, asked);
    }
}

/// Keeps what has to outlive this window. Not waited on or reported: what is
/// lost with it is an overseer that has to be started again after a restart.
fn keep<R: Runtime>(app: &AppHandle<R>, kept: Kept) {
    let Ok(value) = serde_json::to_value(kept) else {
        return;
    };
    let _ = crate::persistent::link(app).ask("store_put", json!({ "name": NAME, "value": value }));
}

/// A token nobody could guess: two hashes under keys the standard library
/// seeds from the system's own randomness.
fn fresh_token() -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_nanos())
        .unwrap_or_default();
    let first = RandomState::new().hash_one((std::process::id(), now));
    let second = RandomState::new().hash_one((first, now));
    format!("{first:016x}{second:016x}")
}

/// Stands the server up if it is not standing, making the token if there is
/// none yet, and says the port and the token.
///
/// The port asked for first is the one taken last time, which is the one the
/// overseer's config still names.
fn stand<R: Runtime>(
    app: &AppHandle<R>,
    overseer: &Arc<Overseer>,
) -> Result<(u16, String), String> {
    let (port, token, kept) = {
        let mut held = overseer.lock();
        let made = held.kept.token.is_none();
        let token = held.kept.token.get_or_insert_with(fresh_token).clone();
        if let Some(port) = held.standing {
            (port, token, made.then(|| held.kept.clone()))
        } else {
            // Bound under the lock, so that two launches at once cannot stand
            // two servers. Binding asks nothing of anybody else.
            let wanted = [held.kept.port.unwrap_or(0), serve::PORT];
            let sight = Arc::new(Seen {
                app: app.clone(),
                overseer: Arc::clone(overseer),
            });
            let port = serve::listen(sight, token.clone(), &wanted)?;
            held.standing = Some(port);
            let moved = held.kept.port != Some(port);
            held.kept.port = Some(port);
            (port, token, (made || moved).then(|| held.kept.clone()))
        }
    };
    if let Some(kept) = kept {
        keep(app, kept);
    }
    Ok((port, token))
}

/// The window, as the overseer's server sees it.
struct Seen<R: Runtime> {
    app: AppHandle<R>,
    overseer: Arc<Overseer>,
}

impl<R: Runtime> Sight for Seen<R> {
    fn terminals(&self) -> Vec<Terminal> {
        let own = self.overseer.own();
        let running = pty::running(&self.app);
        let reports: HashMap<String, totex_persistent::door::Report> =
            crate::persistent::link(&self.app)
                .asked::<Vec<Reported>>("door_reports", json!({}))
                .unwrap_or_default()
                .into_iter()
                .filter_map(|reported| Some((reported.id, reported.report?)))
                .collect();
        let statuses = self.overseer.lock().kept.statuses.clone();
        crate::ask::watch::looking(&self.app, |watching| {
            running
                .into_iter()
                .filter(|session| own.as_deref() != Some(session.id.as_str()))
                .map(|session| {
                    let watcher = watching.get(&session.id);
                    Terminal {
                        branch: branch(session.meta.as_deref()),
                        doing: watcher.map(|watcher| watcher.doing()),
                        asking: watcher.and_then(|watcher| watcher.asking()).map(Asking::of),
                        typed: watcher
                            .and_then(|watcher| watcher.typed())
                            .map(str::to_string),
                        report: reports.get(&session.id).cloned(),
                        status: statuses.get(&session.id).cloned(),
                        cwd: session.cwd,
                        id: session.id,
                    }
                })
                .collect()
        })
    }

    fn screen(&self, id: &str) -> Option<Vec<String>> {
        if self.overseer.is_own(id) {
            return None;
        }
        crate::ask::watch::looking(&self.app, |watching| {
            watching.get(id).map(|watcher| watcher.lines())
        })
    }

    fn describe(&self, id: &str, status: Option<String>) -> Result<(), String> {
        if self.overseer.is_own(id) {
            return Err("that is your own terminal; describe the others".to_string());
        }
        if !pty::running(&self.app)
            .iter()
            .any(|session| session.id == id)
        {
            return Err(format!("there is no terminal {id}"));
        }
        let kept = {
            let mut held = self.overseer.lock();
            let before = match &status {
                Some(status) => held.kept.statuses.insert(id.to_string(), status.clone()),
                None => held.kept.statuses.remove(id),
            };
            (before != status).then(|| held.kept.clone())
        };
        let Some(kept) = kept else {
            return Ok(());
        };
        let _ = self.app.emit(
            STATUS_EVENT,
            Status {
                id: id.to_string(),
                status,
            },
        );
        keep(&self.app, kept);
        Ok(())
    }

    fn journal(&self) -> &Journal {
        &self.overseer.journal
    }

    fn own(&self) -> Option<String> {
        self.overseer.own()
    }
}

/// The branch a session's meta says it is on, where it says one.
fn branch(meta: Option<&str>) -> Option<String> {
    let meta: serde_json::Value = serde_json::from_str(meta?).ok()?;
    meta.get("branch")?.as_str().map(str::to_string)
}

/// Opens a shell of the overseer's own in the folder kept for it and starts
/// the overseer in it.
///
/// The folder is this program's, not any repository's: the overseer watches
/// every terminal alike, so it stands in none of them, and what it is given to
/// read there — its prompt and how to reach the server, see `launch` — is
/// nobody's to commit. Everything else that makes it the overseer is the same
/// as for any agent somebody starts by hand: the line that starts it typed at
/// the prompt.
fn summon<R: Runtime>(app: &AppHandle<R>, overseer: &Arc<Overseer>) -> Result<(), String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join(launch::DIR);
    std::fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    let cwd = dir.to_string_lossy().into_owned();
    let (port, token) = stand(app, overseer)?;
    launch::write(&cwd, port, &token)?;

    let id = format!("{cwd} overseer");
    let link = crate::persistent::link(app);
    link.ask(
        "open",
        json!({
            "id": id,
            "cwd": cwd,
            "rows": launch::ROWS,
            "cols": launch::COLS,
            "meta": json!({ "branch": "", "overseer": true }).to_string(),
        }),
    )?;
    link.know(&id);

    let kept = {
        let mut held = overseer.lock();
        held.kept.session = Some(id.clone());
        held.kept.statuses.clear();
        held.asking.clear();
        held.kept.clone()
    };
    keep(app, kept);
    let _ = app.emit(SESSION_EVENT, Some(id.clone()));

    // Typed at once: the terminal holds it until the shell comes to read it.
    link.ask("write", json!({ "id": id, "data": launch::command() }))
        .map(|_| ())
}

/// The overseer's session, where there is one and it is still running.
#[tauri::command(async)]
pub fn overseer_session<R: Runtime>(app: AppHandle<R>) -> Option<String> {
    let id = app.state::<Arc<Overseer>>().own()?;
    pty::running(&app)
        .iter()
        .any(|session| session.id == id)
        .then_some(id)
}

/// Every line the overseer has written, for a window that has just come up.
#[tauri::command(async)]
pub fn overseer_statuses<R: Runtime>(app: AppHandle<R>) -> Vec<Status> {
    app.state::<Arc<Overseer>>()
        .lock()
        .kept
        .statuses
        .iter()
        .map(|(id, status)| Status {
            id: id.clone(),
            status: Some(status.clone()),
        })
        .collect()
}
