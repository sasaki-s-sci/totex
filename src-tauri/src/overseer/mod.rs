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

use std::collections::hash_map::RandomState;
use std::collections::{BTreeMap, HashMap};
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

/// Carries every session that is an overseer, whenever that list changes.
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
    reply_key: Option<String>,
}

/// Which terminals an overseer watches, named by where they run: the name of a
/// WSL distribution, or empty for this machine — and so for every terminal
/// that is not in a distribution, ssh included, since this machine is where
/// those are run from. An overseer is started in the environment it watches
/// and sees nothing of any other, so no agent ever reasons across the seam
/// between Windows and a distribution.
type Scope = String;

/// The scope a terminal belongs to, read from its folder. A session's id
/// begins with its folder too, which is what lets a change in the journal be
/// told apart without asking the sessions anything.
fn scope_of(path: &str) -> Scope {
    match crate::host::Host::of_str(path) {
        crate::host::Host::Wsl(distro) => distro,
        _ => Scope::new(),
    }
}

/// What has to outlive a window: each overseer it is still talking to and how
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
    #[serde(default)]
    watches: BTreeMap<Scope, Watch>,
    /// The one overseer of a window from before there could be several, read
    /// once and folded into `watches` — see `Kept::fold`.
    #[serde(default, skip_serializing)]
    token: Option<String>,
    #[serde(default, skip_serializing)]
    session: Option<String>,
    #[serde(default, skip_serializing)]
    port: Option<u16>,
    #[serde(default, skip_serializing)]
    statuses: HashMap<String, String>,
    #[serde(default, skip_serializing)]
    status_keys: HashMap<String, String>,
}

/// One overseer: its address, its session, and the lines it has written.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Watch {
    token: Option<String>,
    session: Option<String>,
    port: Option<u16>,
    #[serde(default)]
    statuses: HashMap<String, String>,
    #[serde(default)]
    status_keys: HashMap<String, String>,
}

impl Kept {
    /// Moves a single overseer kept by an earlier version under the scope its
    /// session was started in.
    fn fold(&mut self) {
        if self.token.is_none() && self.session.is_none() {
            return;
        }
        let scope = self.session.as_deref().map(scope_of).unwrap_or_default();
        self.watches.entry(scope).or_insert_with(|| Watch {
            token: self.token.take(),
            session: self.session.take(),
            port: self.port.take(),
            statuses: std::mem::take(&mut self.statuses),
            status_keys: std::mem::take(&mut self.status_keys),
        });
        *self = Self {
            watches: std::mem::take(&mut self.watches),
            ..Self::default()
        };
    }

    /// The scope whose overseer is `id`, where one is.
    fn scope_owning(&self, id: &str) -> Option<&Scope> {
        self.watches
            .iter()
            .find(|(_, watch)| watch.session.as_deref() == Some(id))
            .map(|(scope, _)| scope)
    }

    fn sessions(&self) -> Vec<String> {
        self.watches
            .values()
            .filter_map(|watch| watch.session.clone())
            .collect()
    }
}

#[derive(Default)]
struct Held {
    kept: Kept,
    /// The port each scope's server stands on, once it is standing.
    standing: HashMap<Scope, u16>,
    /// The question each session was last said to be asking, by its name, so
    /// that a box redrawn with the mark on another line is not a change.
    asking: HashMap<String, u64>,
}

/// The overseers, as this window holds them.
#[derive(Default)]
pub struct Overseer {
    control: Mutex<()>,
    held: Mutex<Held>,
    /// One journal for every scope: each overseer's `wait` leaves out what is
    /// not in its own.
    journal: Journal,
}

impl Overseer {
    fn lock(&self) -> MutexGuard<'_, Held> {
        crate::sync::lock(&self.held)
    }

    fn own(&self, scope: &str) -> Option<String> {
        self.lock().kept.watches.get(scope)?.session.clone()
    }

    /// Whether `id` is any overseer's own terminal.
    fn is_own(&self, id: &str) -> bool {
        self.lock().kept.scope_owning(id).is_some()
    }

    /// Writes down what a reading of a session's screen found, where it is a
    /// change an overseer would want to hear about.
    fn noticed(&self, id: &str, turned: Option<Doing>, asked: Option<&Option<Ask>>) {
        let asking = {
            let mut held = self.lock();
            if held.kept.scope_owning(id).is_some() {
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

/// Starts following the sessions for the overseers, and stands their servers
/// up again where an overseer from before this window is still running.
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

    // Reconnect existing overseers, but starting a new one is a Settings action.
    rise(app, &overseer);
}

/// Takes back what an earlier window kept, as far as it is still true, and
/// stands a server up again for each overseer that is still running.
fn rise<R: Runtime>(app: &AppHandle<R>, overseer: &Arc<Overseer>) {
    let Some(mut kept) = crate::persistent::link(app)
        .asked::<Option<Kept>>("store_get", json!({ "name": NAME }))
        .ok()
        .flatten()
    else {
        return;
    };
    let running: Vec<String> = pty::running(app)
        .into_iter()
        .map(|session| session.id)
        .collect();
    let before = kept.clone();
    kept.fold();
    for watch in kept.watches.values_mut() {
        watch.session = watch.session.take().filter(|id| running.contains(id));
        watch.statuses.retain(|id, _| running.contains(id));
        watch.status_keys.retain(|id, _| running.contains(id));
    }
    let alive: Vec<Scope> = kept
        .watches
        .iter()
        .filter(|(_, watch)| watch.session.is_some())
        .map(|(scope, _)| scope.clone())
        .collect();
    overseer.lock().kept = kept.clone();
    if kept != before {
        keep(app, kept);
    }
    for scope in alive {
        let _ = stand(app, overseer, &scope);
    }
}

/// A session has ended. Where it was an overseer there is no overseer for its
/// scope any more, and every line it wrote goes with it: a line nobody is
/// keeping is a line that will be wrong by the next time anybody reads it.
fn ended<R: Runtime>(app: &AppHandle<R>, overseer: &Overseer, id: &str) {
    let (gone, kept, own) = {
        let mut held = overseer.lock();
        held.asking.remove(id);
        let owner = held.kept.scope_owning(id).cloned();
        let mut gone = Vec::new();
        for (scope, watch) in held.kept.watches.iter_mut() {
            if owner.as_ref() == Some(scope) {
                watch.session = None;
                watch.status_keys.clear();
                gone.extend(watch.statuses.drain().map(|(id, _)| id));
            } else {
                watch.status_keys.remove(id);
                if watch.statuses.remove(id).is_some() {
                    gone.push(id.to_string());
                }
            }
        }
        (gone, held.kept.clone(), owner.is_some())
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
                reply_key: None,
            },
        );
    }
    if own {
        let _ = app.emit(SESSION_EVENT, kept.sessions());
    }
    if own || !gone.is_empty() {
        keep(app, kept);
    }
}

/// Hands what a reading of a session found to the overseers' journal. Called
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

/// Stands a scope's server up if it is not standing, making its token if there
/// is none yet, and says the port and the token.
///
/// Each overseer has a server and a token of its own, so what it is answered
/// is decided by which door it knocked at rather than by anything it says. The
/// port asked for first is the one taken last time, which is the one the
/// overseer's config still names.
fn stand<R: Runtime>(
    app: &AppHandle<R>,
    overseer: &Arc<Overseer>,
    scope: &str,
) -> Result<(u16, String), String> {
    let (port, token, kept) = {
        let mut held = overseer.lock();
        let standing = held.standing.get(scope).copied();
        let watch = held.kept.watches.entry(scope.to_string()).or_default();
        let made = watch.token.is_none();
        let token = watch.token.get_or_insert_with(fresh_token).clone();
        if let Some(port) = standing {
            (port, token, made.then(|| held.kept.clone()))
        } else {
            // Bound under the lock, so that two launches at once cannot stand
            // two servers. Binding asks nothing of anybody else. This machine's
            // overseer asks for the fixed port first; a distribution's takes
            // whatever is free, and keeps it from then on.
            let first = if scope.is_empty() { serve::PORT } else { 0 };
            let wanted = [watch.port.unwrap_or(0), first];
            let sight = Arc::new(Seen {
                app: app.clone(),
                overseer: Arc::clone(overseer),
                scope: scope.to_string(),
            });
            let port = serve::listen(sight, token.clone(), &wanted)?;
            let moved = watch.port != Some(port);
            watch.port = Some(port);
            held.standing.insert(scope.to_string(), port);
            (port, token, (made || moved).then(|| held.kept.clone()))
        }
    };
    if let Some(kept) = kept {
        keep(app, kept);
    }
    Ok((port, token))
}

/// The window, as one overseer's server sees it: only the terminals of its
/// own scope.
struct Seen<R: Runtime> {
    app: AppHandle<R>,
    overseer: Arc<Overseer>,
    scope: Scope,
}

impl<R: Runtime> Seen<R> {
    /// A running terminal of this scope that is not an overseer, by its folder.
    fn watched(&self, id: &str) -> bool {
        !self.overseer.is_own(id)
            && pty::running(&self.app)
                .iter()
                .any(|session| session.id == id && scope_of(&session.cwd) == self.scope)
    }
}

impl<R: Runtime> Sight for Seen<R> {
    fn terminals(&self) -> Vec<Terminal> {
        let running = pty::running(&self.app);
        let reports: HashMap<String, totex_persistent::door::Report> =
            crate::persistent::link(&self.app)
                .asked::<Vec<Reported>>("door_reports", json!({}))
                .unwrap_or_default()
                .into_iter()
                .filter_map(|reported| Some((reported.id, reported.report?)))
                .collect();
        let (statuses, owned) = {
            let held = self.overseer.lock();
            let statuses = held
                .kept
                .watches
                .get(&self.scope)
                .map(|watch| watch.statuses.clone())
                .unwrap_or_default();
            (statuses, held.kept.sessions())
        };
        crate::ask::watch::looking(&self.app, |watching| {
            running
                .into_iter()
                .filter(|session| {
                    !owned.contains(&session.id) && scope_of(&session.cwd) == self.scope
                })
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
        if !self.watched(id) {
            return None;
        }
        crate::ask::watch::looking(&self.app, |watching| {
            watching.get(id).map(|watcher| watcher.lines())
        })
    }

    fn describe(
        &self,
        id: &str,
        status: Option<String>,
        reply_key: Option<&str>,
    ) -> Result<(), String> {
        if self.overseer.is_own(id) {
            return Err("that is an overseer's own terminal; describe the others".to_string());
        }
        if !self.watched(id) {
            return Err(format!("there is no terminal {id}"));
        }
        let reports =
            crate::persistent::link(&self.app).asked::<Vec<Reported>>("door_reports", json!({}))?;
        let current_key = reports
            .iter()
            .find(|report| report.id == id)
            .and_then(|report| report.report.as_ref())
            .and_then(|report| report.reply.as_ref())
            .map(|reply| reply.key.as_str());
        if status.is_some() && current_key != reply_key {
            return Err(
                "The reply changed. Read terminals again and pass report.reply.key as replyKey."
                    .into(),
            );
        }
        let kept = {
            let mut held = self.overseer.lock();
            let watch = held.kept.watches.entry(self.scope.clone()).or_default();
            let old_key = watch.status_keys.get(id).cloned();
            if let Some(key) = reply_key.filter(|_| status.is_some()) {
                watch.status_keys.insert(id.into(), key.into());
            } else {
                watch.status_keys.remove(id);
            }
            let before = match &status {
                Some(status) => watch.statuses.insert(id.to_string(), status.clone()),
                None => watch.statuses.remove(id),
            };
            (before != status || old_key.as_deref() != reply_key).then(|| held.kept.clone())
        };
        let Some(kept) = kept else {
            return Ok(());
        };
        let _ = self.app.emit(
            STATUS_EVENT,
            Status {
                id: id.to_string(),
                status,
                reply_key: reply_key.map(str::to_string),
            },
        );
        keep(&self.app, kept);
        Ok(())
    }

    fn journal(&self) -> &Journal {
        &self.overseer.journal
    }

    fn own(&self) -> Option<String> {
        self.overseer.own(&self.scope)
    }

    fn sees(&self, id: &str) -> bool {
        scope_of(id) == self.scope
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
/// every terminal of its scope alike, so it stands in none of them, and what
/// it is given to read there — its prompt and how to reach the server, see
/// `launch` — is nobody's to commit. Everything else that makes it the
/// overseer is the same as for any agent somebody starts by hand: the line
/// that starts it typed at the prompt.
fn summon<R: Runtime>(
    app: &AppHandle<R>,
    overseer: &Arc<Overseer>,
    scope: &str,
    cwd: &str,
) -> Result<(), String> {
    let (port, token) = stand(app, overseer, scope)?;
    launch::write(cwd, port, &token)?;

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

    // A failed write must not leave a terminal presented as a running overseer.
    if let Err(error) = link.ask("write", json!({ "id": id, "data": launch::command() })) {
        let _ = link.ask("close", json!({ "id": id }));
        return Err(error);
    }
    let kept = {
        let mut held = overseer.lock();
        let watch = held.kept.watches.entry(scope.to_string()).or_default();
        watch.session = Some(id);
        watch.statuses.clear();
        watch.status_keys.clear();
        held.asking.clear();
        held.kept.clone()
    };
    let _ = app.emit(SESSION_EVENT, kept.sessions());
    keep(app, kept);
    Ok(())
}

/// Starts the overseer of one scope from Settings: this machine's with no
/// `distro`, or one running inside that WSL distribution. Repeated starts of a
/// scope share the same session.
#[tauri::command(async)]
pub fn overseer_start<R: Runtime>(
    app: AppHandle<R>,
    distro: Option<String>,
) -> Result<String, String> {
    let overseer = app.state::<Arc<Overseer>>();
    let _control = crate::sync::lock(&overseer.control);
    let scope = distro.clone().unwrap_or_default();
    if let Some(id) = running_own(&app, &overseer, &scope) {
        return Ok(id);
    }
    let cwd = match distro.as_deref() {
        Some(distro) => {
            if !cfg!(windows) || !crate::wsl::distros().iter().any(|name| name == distro) {
                return Err(format!("WSL distribution unavailable: {distro}"));
            }
            let cwd = launch::wsl_directory(distro)?;
            // The distribution's own Claude Code takes the reply hooks: its
            // sessions are the ones the runtime maps to WSL terminals through
            // their `TOTEX_TERMINAL` marker and `claude agents --json` there.
            crate::persistent::link(&app).ask(
                "door_install",
                json!({ "agent": "claude", "replyHooks": true, "distro": distro }),
            )?;
            cwd
        }
        None => {
            // Local official hooks require a local Claude installation.
            crate::persistent::link(&app).ask(
                "door_install",
                json!({ "agent": "claude", "replyHooks": true }),
            )?;
            let dir = app
                .path()
                .app_data_dir()
                .map_err(|error| error.to_string())?
                .join(launch::DIR);
            std::fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
            dir.to_string_lossy().into_owned()
        }
    };
    summon(&app, &overseer, &scope, &cwd)?;
    overseer
        .own(&scope)
        .ok_or_else(|| "The overseer ended while starting".to_string())
}

/// Only Windows builds offer running an overseer in a WSL distribution.
#[tauri::command(async)]
pub fn overseer_distros() -> Vec<String> {
    if cfg!(windows) {
        crate::wsl::distros()
    } else {
        Vec::new()
    }
}

/// Stops one scope's overseer terminal and clears its status lines.
#[tauri::command(async)]
pub fn overseer_stop<R: Runtime>(app: AppHandle<R>, distro: Option<String>) -> Result<(), String> {
    let overseer = app.state::<Arc<Overseer>>();
    let _control = crate::sync::lock(&overseer.control);
    let Some(id) = overseer.own(&distro.unwrap_or_default()) else {
        return Ok(());
    };
    crate::persistent::link(&app).ask("close", json!({ "id": id }))?;
    if overseer.is_own(&id) {
        ended(&app, &overseer, &id);
    }
    Ok(())
}

/// A scope's overseer session, where there is one and it is still running.
fn running_own<R: Runtime>(app: &AppHandle<R>, overseer: &Overseer, scope: &str) -> Option<String> {
    let id = overseer.own(scope)?;
    pty::running(app)
        .iter()
        .any(|session| session.id == id)
        .then_some(id)
}

/// Every overseer's session that is still running.
#[tauri::command(async)]
pub fn overseer_sessions<R: Runtime>(app: AppHandle<R>) -> Vec<String> {
    let owned = app.state::<Arc<Overseer>>().lock().kept.sessions();
    let running = pty::running(&app);
    owned
        .into_iter()
        .filter(|id| running.iter().any(|session| &session.id == id))
        .collect()
}

/// Every line the overseers have written, for a window that has just come up.
#[tauri::command(async)]
pub fn overseer_statuses<R: Runtime>(app: AppHandle<R>) -> Vec<Status> {
    let overseer = app.state::<Arc<Overseer>>();
    let held = overseer.lock();
    held.kept
        .watches
        .values()
        .flat_map(|watch| {
            watch.statuses.iter().map(|(id, status)| Status {
                id: id.clone(),
                status: Some(status.clone()),
                reply_key: watch.status_keys.get(id).cloned(),
            })
        })
        .collect()
}
