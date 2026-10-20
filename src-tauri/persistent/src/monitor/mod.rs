//! Optional observers, separate from the shells they describe.
//! Reports are inference over terminal output; observer lifecycle is measured.
mod acp;
mod browser;
mod cli;
mod launch;
#[cfg(target_os = "linux")]
mod native;
mod prompt;

use crate::{Sessions, session::Running};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicBool, AtomicUsize, Ordering},
};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use totex_host::{host::Host, sync::lock};

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Features {
    pub status: bool,
    pub agents: bool,
    pub task_summary: bool,
    pub request_summary: bool,
    pub estimate: bool,
    pub goal: bool,
}

/// Which agent observes. The built-in ones are driven through their own CLI
/// (Claude Code, Codex) or ACP (OpenCode); `custom` is any ACP executable.
#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Observer {
    #[default]
    Claude,
    Codex,
    Opencode,
    Custom,
}

/// Unknown fields are ignored and missing ones take their defaults, so that a
/// settings document from another version still configures the monitor.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Config {
    pub enabled: bool,
    pub agent: Observer,
    /// The ACP executable and its arguments, for `custom` only.
    pub command: String,
    pub args: Vec<String>,
    pub model: String,
    pub interval_secs: u64,
    pub features: Features,
    /// Observe only the sessions the window says are running a coding agent.
    pub agents_only: bool,
    /// The widest the badge may be, in px; the text of a report is cut to fit.
    pub preview_width: u32,
    /// A headless browser the observer may look at the page with; see `browser`.
    pub browser: browser::Browser,
}
impl Default for Config {
    fn default() -> Self {
        Self {
            enabled: false,
            agent: Observer::default(),
            command: String::new(),
            args: vec![],
            model: String::new(),
            interval_secs: 30,
            features: Features::default(),
            agents_only: false,
            preview_width: 220,
            browser: browser::Browser::default(),
        }
    }
}
impl Features {
    fn any(&self) -> bool {
        self.status
            || self.agents
            || self.task_summary
            || self.request_summary
            || self.estimate
            || self.goal
    }
}
impl Config {
    fn validate(&self) -> Result<(), String> {
        if !(10..=3600).contains(&self.interval_secs) {
            return Err("Monitor interval must be 10–3600 seconds".into());
        }
        if self.enabled && self.agent == Observer::Custom && self.command.trim().is_empty() {
            return Err("Choose an ACP agent command".into());
        }
        valid_words(&self.command, &self.args, &self.model)
    }

    /// How many characters fit the badge's text: 10px type, less the padding, icon and gap.
    pub fn text_chars(&self) -> usize {
        (self.preview_width as usize).saturating_sub(28) / 10
    }

    /// The ACP launch words, for the agents driven through ACP.
    fn acp_argv(&self) -> Vec<&str> {
        match self.agent {
            Observer::Opencode => vec!["opencode", "acp"],
            _ => std::iter::once(self.command.trim())
                .chain(self.args.iter().map(String::as_str))
                .collect(),
        }
    }
}

fn valid_words(command: &str, args: &[String], model: &str) -> Result<(), String> {
    if args.len() > 128
        || [command, model]
            .into_iter()
            .chain(args.iter().map(String::as_str))
            .any(|s| s.len() > 4096 || s.contains('\0'))
    {
        return Err("Invalid Monitor command or arguments".into());
    }
    Ok(())
}

/// One model an agent offers, as its model list names it.
#[derive(Clone, Debug, Serialize)]
pub struct Model {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
}

/// The answer to `monitor_models`: the first host that could list them.
#[derive(Clone, Debug, Serialize)]
pub struct Models {
    pub environment: String,
    pub models: Vec<Model>,
    pub current: Option<String>,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Status {
    #[default]
    Unknown,
    Running,
    Permission,
    Stopped,
    Success,
    Failure,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum GoalStatus {
    Active,
    Paused,
    Blocked,
    Complete,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Goal {
    pub status: GoalStatus,
    pub summary: String,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Confidence {
    Low,
    Medium,
    High,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Estimate {
    pub seconds: u64,
    pub confidence: Confidence,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Monitor,
    Shell,
    Subagent,
    Background,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Agent {
    pub id: String,
    pub kind: Kind,
    pub label: String,
    pub status: Status,
    #[serde(default, deserialize_with = "optional_detail")]
    pub detail: String,
    #[serde(default)]
    pub progress: Option<f64>,
    #[serde(default = "inferred_source")]
    pub source: String,
}

fn optional_detail<'de, D: serde::Deserializer<'de>>(deserializer: D) -> Result<String, D::Error> {
    Ok(Option::<String>::deserialize(deserializer)?.unwrap_or_default())
}
#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Report {
    pub status: Status,
    pub goal: Option<Goal>,
    pub task_summary: Option<String>,
    pub request_summary: Option<String>,
    pub estimate: Option<Estimate>,
    pub agents: Vec<Agent>,
}
/// A screenshot the observer saved of the page the terminal works on, and when.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Shot {
    pub path: String,
    pub at: u64,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub id: String,
    pub environment: String,
    #[serde(flatten)]
    pub report: Report,
    pub source: &'static str,
    pub updated_at: u64,
    pub error: Option<String>,
    pub monitor_status: &'static str,
    pub shot: Option<Shot>,
}
fn inferred_source() -> String {
    "inferred".into()
}
struct Entry {
    snapshot: Snapshot,
    last_seq: Option<usize>,
    last_attempt: u64,
    cancel: Option<Arc<AtomicBool>>,
    generation: u64,
    refresh: bool,
}
#[derive(Default)]
struct State {
    config: Config,
    entries: HashMap<String, Entry>,
    generation: u64,
    /// The sessions running a coding agent, as the window reads them off the
    /// screen: this program holds the bytes, not the reading of them.
    agents: HashSet<String>,
}
pub struct Monitor {
    sessions: Arc<Sessions>,
    state: Mutex<State>,
    workers: AtomicUsize,
}
struct Worker<'a>(&'a AtomicUsize);
impl Drop for Worker<'_> {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::Release);
    }
}

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
fn environment(host: &Host) -> String {
    match host {
        Host::Local => {
            if cfg!(windows) {
                "Windows".into()
            } else {
                "Local".into()
            }
        }
        Host::Ssh(host) => format!("SSH · {host}"),
        Host::Wsl(distro) => format!("WSL · {distro}"),
    }
}
/// One observation on `host` by the configured agent, as the enabled fields
/// of its report.
async fn observation(
    config: &Config,
    host: &Host,
    environment: &str,
    transcript: &str,
    cancelled: Arc<AtomicBool>,
    previous: Option<serde_json::Value>,
    browser: Option<(browser::Setup, PathBuf)>,
) -> Result<serde_json::Value, String> {
    let mut prompt = prompt::prompt(
        &config.features,
        config.text_chars(),
        transcript,
        previous.as_ref(),
    );
    if let Some((_, shot)) = &browser {
        prompt.push_str(&browser::instruction(shot));
    }
    let schema = prompt::schema(&config.features);
    let model = config.model.trim();
    let work = async {
        let report = match config.agent {
            Observer::Claude => {
                let setup = browser.as_ref().map(|(setup, _)| setup);
                cli::claude("claude", model, host, environment, &prompt, &schema, setup).await?
            }
            Observer::Codex => {
                cli::codex("codex", model, host, environment, &prompt, &schema).await?
            }
            Observer::Opencode | Observer::Custom => {
                let text =
                    acp::observe(&config.acp_argv(), model, host, environment, prompt.clone())
                        .await?;
                prompt::final_report(&text)?
            }
        };
        prompt::keep_enabled(report, &config.features)
    };
    tokio::select! {
        result = work => result,
        _ = launch::flagged(&cancelled) => Err("Monitor cancelled".into()),
    }
}

/// The models `config.agent` offers on `host`, and the one it would use.
async fn listing(config: &Config, host: &Host, environment: &str) -> Result<Models, String> {
    let (models, current) = match config.agent {
        Observer::Claude => (cli::claude_models("claude", host, environment).await?, None),
        Observer::Codex => (cli::codex_models("codex", host, environment).await?, None),
        Observer::Opencode | Observer::Custom => {
            acp::models(&config.acp_argv(), host, environment).await?
        }
    };
    Ok(Models {
        environment: environment.to_owned(),
        models,
        current,
    })
}

impl Monitor {
    pub fn new(sessions: Arc<Sessions>) -> Arc<Self> {
        let monitor = Arc::new(Self {
            sessions,
            state: Mutex::new(State::default()),
            workers: AtomicUsize::new(0),
        });
        let weak = Arc::downgrade(&monitor);
        std::thread::spawn(move || {
            loop {
                std::thread::sleep(Duration::from_secs(1));
                let Some(monitor) = weak.upgrade() else { break };
                monitor.tick();
            }
        });
        monitor
    }
    pub fn configure(&self, config: Config) -> Result<(), String> {
        config.validate()?;
        let mut state = lock(&self.state);
        if serde_json::to_value(&state.config).ok() == serde_json::to_value(&config).ok() {
            return Ok(());
        }
        // The width only sets how long the next text may be, so it discards nothing.
        let mut width_only = config.clone();
        width_only.preview_width = state.config.preview_width;
        if serde_json::to_value(&state.config).ok() == serde_json::to_value(&width_only).ok() {
            state.config = config;
            return Ok(());
        }
        state.generation += 1;
        for entry in state.entries.values_mut() {
            if let Some(cancel) = entry.cancel.take() {
                cancel.store(true, Ordering::Relaxed);
            }
            entry.refresh = true;
            entry.snapshot.report = Report::default();
            entry.snapshot.error = None;
            entry.snapshot.updated_at = 0;
            entry.snapshot.monitor_status = if config.enabled { "idle" } else { "disabled" };
        }
        state.config = config;
        Ok(())
    }
    pub fn stop(&self) {
        {
            let mut state = lock(&self.state);
            state.config.enabled = false;
            state.generation += 1;
            for entry in state.entries.values_mut() {
                if let Some(cancel) = entry.cancel.take() {
                    cancel.store(true, Ordering::Relaxed);
                }
            }
        }
        // The service exits immediately after stop. Give ACP's cancellation
        // path time to drop subprocess guards before that process-wide exit.
        let deadline = std::time::Instant::now() + Duration::from_secs(2);
        while self.workers.load(Ordering::Acquire) > 0 && std::time::Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(10));
        }
    }
    pub fn snapshots(&self) -> Vec<Snapshot> {
        let state = lock(&self.state);
        let mut snapshots: Vec<_> = state
            .entries
            .values()
            .map(|e| {
                let mut s = e.snapshot.clone();
                if state.config.features.agents && state.config.enabled {
                    s.report.agents.insert(
                        0,
                        Agent {
                            id: "totex-shell".into(),
                            kind: Kind::Shell,
                            label: "shell".into(),
                            status: Status::Running,
                            detail: s.environment.clone(),
                            progress: None,
                            source: "observed".into(),
                        },
                    );
                }
                s
            })
            .collect();
        snapshots.sort_by(|a, b| a.id.cmp(&b.id));
        snapshots
    }
    /// Which sessions are running a coding agent; kept apart from the config,
    /// so a change in it never discards an observation.
    pub fn agents(&self, ids: Vec<String>) {
        lock(&self.state).agents = ids.into_iter().collect();
    }
    pub fn refresh(&self, id: &str) -> Result<(), String> {
        let mut state = lock(&self.state);
        if !state.config.enabled {
            return Err("Monitor is disabled".into());
        }
        let entry = state.entries.get_mut(id).ok_or("Unknown terminal")?;
        entry.refresh = true;
        Ok(())
    }
    /// Lists the models an agent offers, from the first host that can: the
    /// hosts of the open terminals first, then this machine. The window waits
    /// at most `PATIENCE` (120 s) for an answer, so all hosts share a budget
    /// below that.
    pub fn models(
        &self,
        agent: Observer,
        command: String,
        args: Vec<String>,
    ) -> Result<Models, String> {
        let config = Config {
            agent,
            command,
            args,
            ..Config::default()
        };
        if agent == Observer::Custom && config.command.trim().is_empty() {
            return Err("Choose an ACP agent command".into());
        }
        valid_words(&config.command, &config.args, "")?;
        let mut hosts = vec![];
        for session in self.sessions.running() {
            let host = Host::of_str(&session.cwd);
            if !hosts.contains(&host) {
                hosts.push(host);
            }
        }
        if !hosts.contains(&Host::Local) {
            hosts.push(Host::Local);
        }
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .map_err(|e| e.to_string())?;
        let deadline = std::time::Instant::now() + Duration::from_secs(100);
        let mut failures = vec![];
        for host in hosts {
            let environment = environment(&host);
            let wait = deadline
                .saturating_duration_since(std::time::Instant::now())
                .min(Duration::from_secs(60));
            if wait.is_zero() {
                failures.push(format!("{environment}: not tried, out of time"));
                continue;
            }
            // The timer is made inside the runtime it needs.
            match runtime.block_on(async {
                tokio::time::timeout(wait, listing(&config, &host, &environment)).await
            }) {
                Ok(Ok(models)) => return Ok(models),
                Ok(Err(error)) => failures.push(format!("{environment}: {error}")),
                Err(_) => failures.push(format!(
                    "{environment}: timed out after {} seconds",
                    wait.as_secs()
                )),
            }
        }
        Err(failures.join("\n"))
    }
    fn tick(self: &Arc<Self>) {
        let running = self.sessions.running();
        let mut state = lock(&self.state);
        state.entries.retain(|id, entry| {
            let keep = running.iter().any(|s| &s.id == id);
            if !keep && let Some(cancel) = &entry.cancel {
                cancel.store(true, Ordering::Relaxed);
            }
            keep
        });
        if !state.config.enabled {
            return;
        }
        let config = state.config.clone();
        let generation = state.generation;
        let mut active = self.workers.load(Ordering::Acquire);
        for session in running {
            if config.agents_only && !state.agents.contains(&session.id) {
                continue;
            }
            let entry = state
                .entries
                .entry(session.id.clone())
                .or_insert_with(|| Entry {
                    snapshot: Snapshot {
                        id: session.id.clone(),
                        environment: environment(&Host::of_str(&session.cwd)),
                        report: Report::default(),
                        source: "inferred",
                        updated_at: 0,
                        error: None,
                        monitor_status: "idle",
                        shot: None,
                    },
                    last_seq: None,
                    last_attempt: 0,
                    cancel: None,
                    generation,
                    refresh: true,
                });
            if !config.features.any() || entry.cancel.is_some() || active >= 4 {
                continue;
            }
            if !entry.refresh
                && now().saturating_sub(entry.last_attempt) < config.interval_secs * 1000
            {
                continue;
            }
            let Some(output) = self.sessions.attach(&session.id) else {
                continue;
            };
            if !entry.refresh && entry.last_seq == Some(output.upto) {
                continue;
            }
            entry.refresh = false;
            entry.last_attempt = now();
            entry.last_seq = Some(output.upto);
            entry.generation = generation;
            entry.snapshot.monitor_status = "running";
            entry.snapshot.error = None;
            let cancel = Arc::new(AtomicBool::new(false));
            entry.cancel = Some(Arc::clone(&cancel));
            let monitor = Arc::clone(self);
            let config = config.clone();
            let transcript = tail(&output.text, 32_000).to_owned();
            let previous = (entry.snapshot.updated_at > 0).then(|| {
                serde_json::json!({
                    "observedAt": entry.snapshot.updated_at,
                    "source": "inferred",
                    "taskSummary": entry.snapshot.report.task_summary,
                    "requestSummary": entry.snapshot.report.request_summary,
                    "goal": entry.snapshot.report.goal,
                })
            });
            active += 1;
            self.workers.fetch_add(1, Ordering::AcqRel);
            std::thread::spawn(move || {
                monitor.observe(session, config, transcript, cancel, generation, previous)
            });
        }
    }
    fn observe(
        &self,
        session: Running,
        config: Config,
        transcript: String,
        cancel: Arc<AtomicBool>,
        generation: u64,
        previous: Option<serde_json::Value>,
    ) {
        let _worker = Worker(&self.workers);
        let host = Host::of_str(&session.cwd);
        // The browser is offered to the claude observer on this machine only: the MCP server runs beside it.
        let shot = browser::shot_path(&session.id, now());
        let browser = (config.agent == Observer::Claude && matches!(host, Host::Local))
            .then(|| {
                browser::setup(
                    &config.browser,
                    &session.cwd,
                    totex_host::fs_browse::home_dir(),
                )
            })
            .flatten()
            .map(|setup| {
                let _ = std::fs::create_dir_all(browser::shots_dir());
                (setup, shot.clone())
            });
        let used = browser.is_some();
        // The agent's own session state, when it is on this machine, needs no
        // model call and no terminal reading.
        let native = match (session.pid, &host) {
            #[cfg(target_os = "linux")]
            (Some(root), Host::Local) => native::observe(root, &session.cwd),
            _ => None,
        };
        let source = if native.is_some() {
            "observed"
        } else {
            "inferred"
        };
        let result = match native {
            Some(report) => Ok(report),
            None => check_environment(&session)
                .and_then(|()| {
                    tokio::runtime::Builder::new_current_thread()
                        .enable_all()
                        .build()
                        .map_err(|e| e.to_string())
                })
                .and_then(|runtime| {
                    runtime.block_on(async {
                        tokio::time::timeout(
                            Duration::from_secs(120),
                            observation(
                                &config,
                                &host,
                                &environment(&host),
                                &transcript,
                                Arc::clone(&cancel),
                                previous,
                                browser,
                            ),
                        )
                        .await
                        .map_err(|_| "Monitor timed out after 120 seconds".to_owned())?
                    })
                })
                .and_then(|value| {
                    serde_json::from_value::<Report>(value)
                        .map_err(|e| format!("Invalid monitor report: {e}"))
                }),
        };
        cancel.store(true, Ordering::Relaxed);
        let mut state = lock(&self.state);
        if state.generation != generation {
            return;
        }
        let Some(entry) = state.entries.get_mut(&session.id) else {
            return;
        };
        if !entry
            .cancel
            .as_ref()
            .is_some_and(|current| Arc::ptr_eq(current, &cancel))
        {
            return;
        }
        entry.cancel = None;
        match result {
            Ok(mut report) => {
                sanitize(&mut report, &config.features);
                entry.snapshot.report = report;
                if used && shot.is_file() {
                    entry.snapshot.shot = Some(Shot {
                        path: shot.to_string_lossy().into_owned(),
                        at: now(),
                    });
                }
                entry.snapshot.source = source;
                entry.snapshot.updated_at = now();
                entry.snapshot.monitor_status = "idle";
                entry.snapshot.error = None;
            }
            Err(error) => {
                entry.snapshot.monitor_status = if error.starts_with("Permission required:") {
                    "permission"
                } else {
                    "failure"
                };
                entry.snapshot.error = Some(error);
            }
        }
    }
}
// A shell entered manually over SSH has no target metadata. Refuse to observe
// it from the original local environment rather than silently crossing hosts.
#[cfg(target_os = "linux")]
fn check_environment(session: &Running) -> Result<(), String> {
    if Host::of_str(&session.cwd).is_remote() {
        return Ok(());
    }
    let Some(root) = session.pid else {
        return Ok(());
    };
    for pid in descendants(root) {
        let Ok(command) = std::fs::read(format!("/proc/{pid}/cmdline")) else {
            continue;
        };
        let program =
            String::from_utf8_lossy(command.split(|b| *b == 0).next().unwrap_or_default());
        let name = program.rsplit('/').next().unwrap_or("");
        if matches!(name, "ssh" | "wsl" | "wsl.exe") && owns_terminal_input(root, pid) {
            return Err("Terminal entered a nested remote environment. Open an SSH or WSL terminal through Totex so Monitor can run on that host.".into());
        }
    }
    Ok(())
}
/// The processes under `root`, not including it, read off `/proc`.
#[cfg(target_os = "linux")]
fn descendants(root: u32) -> Vec<u32> {
    let Ok(entries) = std::fs::read_dir("/proc") else {
        return vec![];
    };
    let processes: Vec<_> = entries
        .flatten()
        .filter_map(|entry| {
            let pid: u32 = entry.file_name().to_string_lossy().parse().ok()?;
            let status = std::fs::read_to_string(entry.path().join("status")).ok()?;
            let parent: u32 = status
                .lines()
                .find_map(|line| line.strip_prefix("PPid:"))
                .and_then(|p| p.trim().parse().ok())?;
            Some((pid, parent))
        })
        .collect();
    let mut descendants = vec![root];
    for _ in 0..32 {
        let next: Vec<_> = processes
            .iter()
            .filter(|(pid, parent)| descendants.contains(parent) && !descendants.contains(pid))
            .map(|(pid, _)| *pid)
            .collect();
        if next.is_empty() {
            break;
        }
        descendants.extend(next);
    }
    descendants.into_iter().filter(|pid| *pid != root).collect()
}
#[cfg(target_os = "linux")]
fn owns_terminal_input(root: u32, pid: u32) -> bool {
    // Git's SSH transport and background tunnels do not change the terminal's
    // environment. Only a foreground process reading this terminal does.
    let Ok(terminal) = std::fs::read_link(format!("/proc/{root}/fd/0")) else {
        return false;
    };
    if std::fs::read_link(format!("/proc/{pid}/fd/0"))
        .ok()
        .as_ref()
        != Some(&terminal)
    {
        return false;
    }
    let Ok(stat) = std::fs::read_to_string(format!("/proc/{pid}/stat")) else {
        return false;
    };
    let Some((_, fields)) = stat.rsplit_once(") ") else {
        return false;
    };
    let fields: Vec<_> = fields.split_whitespace().take(6).collect();
    fields.len() == 6 && fields[4] != "0" && fields[2] == fields[5]
}
#[cfg(not(target_os = "linux"))]
fn check_environment(_session: &Running) -> Result<(), String> {
    Ok(())
}

fn tail(text: &str, bytes: usize) -> &str {
    let mut start = text.len().saturating_sub(bytes);
    while !text.is_char_boundary(start) {
        start += 1;
    }
    &text[start..]
}
fn shorten(text: &mut String, length: usize) {
    if let Some((at, _)) = text.char_indices().nth(length) {
        text.truncate(at);
    }
}
fn sanitize(report: &mut Report, features: &Features) {
    if !features.status {
        report.status = Status::Unknown;
    }
    if !features.goal {
        report.goal = None;
    }
    if !features.task_summary {
        report.task_summary = None;
    }
    if !features.request_summary {
        report.request_summary = None;
    }
    if !features.estimate {
        report.estimate = None;
    }
    if !features.agents {
        report.agents.clear();
    }
    for text in [&mut report.task_summary, &mut report.request_summary]
        .into_iter()
        .flatten()
    {
        shorten(text, 500);
    }
    if let Some(goal) = &mut report.goal {
        shorten(&mut goal.summary, 500);
    }
    report
        .agents
        .retain(|a| !matches!(a.id.as_str(), "totex-monitor" | "totex-shell"));
    report.agents.truncate(32);
    for agent in &mut report.agents {
        agent.source = "inferred".into();
        shorten(&mut agent.label, 60);
        shorten(&mut agent.detail, 180);
        shorten(&mut agent.id, 100);
        agent.progress = agent
            .progress
            .filter(|p| p.is_finite())
            .map(|p| p.clamp(0.0, 100.0));
    }
    let mut seen = std::collections::HashSet::new();
    report
        .agents
        .retain(|agent| !agent.id.is_empty() && seen.insert(agent.id.clone()));
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn optional_null_worker_detail_does_not_discard_the_session_report() {
        let report: Report = serde_json::from_value(serde_json::json!({
            "status": "running", "taskSummary": "Implementing focus traversal",
            "agents": [{"id": "build", "kind": "background", "label": "Build",
                "status": "running", "detail": null, "progress": null}]
        }))
        .unwrap();
        assert_eq!(report.status, Status::Running);
        assert_eq!(report.agents[0].detail, "");
        assert_eq!(
            report.task_summary.as_deref(),
            Some("Implementing focus traversal")
        );
    }
    #[test]
    fn feature_gates_remove_unrequested_inferences() {
        let mut report: Report = serde_json::from_value(serde_json::json!({"status":"running","taskSummary":"task","requestSummary":"ask","goal":{"status":"active","summary":"goal"},"estimate":{"seconds":60,"confidence":"low"},"agents":[{"id":"a","kind":"subagent","label":"test","status":"running"}]})).unwrap();
        sanitize(&mut report, &Features::default());
        assert_eq!(report.status, Status::Unknown);
        assert!(
            report.goal.is_none()
                && report.task_summary.is_none()
                && report.request_summary.is_none()
                && report.estimate.is_none()
                && report.agents.is_empty()
        );
    }
    #[test]
    fn untrusted_report_cannot_spoof_measured_nodes_or_overflow_progress() {
        let mut report: Report = serde_json::from_value(serde_json::json!({"agents":[{"id":"totex-monitor","kind":"monitor","label":"fake","status":"success"},{"id":"real","kind":"subagent","label":"test","status":"running","progress":500}]})).unwrap();
        sanitize(
            &mut report,
            &Features {
                agents: true,
                ..Features::default()
            },
        );
        assert_eq!(report.agents.len(), 1);
        assert_eq!(report.agents[0].progress, Some(100.0));
    }
    #[test]
    fn the_agent_sessions_outlive_a_configuration_and_are_replaced_whole() {
        let monitor = Monitor::new(Arc::new(Sessions::default()));
        monitor.agents(vec!["one".into(), "two".into()]);
        monitor
            .configure(Config {
                enabled: true,
                agents_only: true,
                ..Config::default()
            })
            .unwrap();
        assert!(lock(&monitor.state).agents.contains("two"));
        monitor.agents(vec!["three".into()]);
        let state = lock(&monitor.state);
        assert!(state.agents.contains("three") && !state.agents.contains("one"));
    }
    #[test]
    fn disabling_cancels_workers_and_invalidates_inflight_reports() {
        let monitor = Monitor::new(Arc::new(Sessions::default()));
        let cancelled = Arc::new(AtomicBool::new(false));
        {
            let mut state = lock(&monitor.state);
            state.config.enabled = true;
            state.entries.insert(
                "terminal".into(),
                Entry {
                    snapshot: Snapshot {
                        id: "terminal".into(),
                        environment: "Local".into(),
                        report: Report {
                            task_summary: Some("old task".into()),
                            ..Report::default()
                        },
                        source: "inferred",
                        updated_at: 1,
                        error: None,
                        monitor_status: "running",
                        shot: None,
                    },
                    last_seq: None,
                    last_attempt: 0,
                    cancel: Some(cancelled.clone()),
                    generation: 0,
                    refresh: false,
                },
            );
        }
        monitor.configure(Config::default()).unwrap();
        assert!(cancelled.load(Ordering::Relaxed));
        assert_eq!(lock(&monitor.state).generation, 1);
        let snapshot = monitor.snapshots().pop().unwrap();
        assert_eq!(snapshot.monitor_status, "disabled");
        assert!(snapshot.report.task_summary.is_none());
    }
    #[test]
    fn child_ids_are_unique_after_bounding() {
        let mut report: Report = serde_json::from_value(serde_json::json!({"agents":[{"id":"a","kind":"monitor","label":"first","status":"running"},{"id":"a","kind":"shell","label":"duplicate","status":"stopped"}]})).unwrap();
        sanitize(
            &mut report,
            &Features {
                agents: true,
                ..Features::default()
            },
        );
        assert_eq!(report.agents.len(), 1);
        assert_eq!(report.agents[0].source, "inferred");
    }

    #[test]
    fn the_badge_width_sets_how_much_text_fits() {
        let width = |preview_width| Config {
            preview_width,
            ..Config::default()
        };
        assert_eq!(width(160).text_chars(), 13);
        assert_eq!(width(220).text_chars(), 19);
        assert_eq!(width(420).text_chars(), 39);
    }

    #[test]
    fn config_defaults_to_claude_ignores_extra_fields_and_needs_a_custom_command() {
        let config: Config = serde_json::from_value(serde_json::json!({
            "enabled": true, "model": "", "intervalSecs": 30,
            "features": {"status": true}, "somethingNew": 1
        }))
        .unwrap();
        assert_eq!(config.agent, Observer::Claude);
        assert!(config.validate().is_ok());
        let custom: Config = serde_json::from_value(serde_json::json!({
            "enabled": true, "agent": "custom", "command": " ", "args": [],
            "model": "", "intervalSecs": 30, "features": {}
        }))
        .unwrap();
        assert_eq!(
            custom.validate().unwrap_err(),
            "Choose an ACP agent command"
        );
        let opencode = Config {
            agent: Observer::Opencode,
            command: "ignored".into(),
            ..custom
        };
        assert_eq!(opencode.acp_argv(), ["opencode", "acp"]);
        assert!(serde_json::from_value::<Config>(serde_json::json!({"agent": "gemini"})).is_err());
    }
    #[test]
    fn models_report_every_host_that_failed() {
        let monitor = Monitor::new(Arc::new(Sessions::default()));
        let error = monitor
            .models(Observer::Custom, "totex-no-such-acp-agent".into(), vec![])
            .unwrap_err();
        let here = environment(&Host::Local);
        assert_eq!(
            error,
            format!("{here}: totex-no-such-acp-agent is not installed on {here}")
        );
        assert!(monitor.models(Observer::Custom, "".into(), vec![]).is_err());
    }
    #[test]
    fn transcript_tail_preserves_unicode() {
        assert_eq!(tail("a日本", 4), "本");
    }
}
