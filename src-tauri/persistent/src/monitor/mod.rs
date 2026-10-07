//! Read-only status monitoring of agent processes owned by local terminals.

mod claude;
mod codex;
mod opencode;
mod process;
mod reply;
pub use reply::{Reply, ReplyStatus};

use std::collections::{HashMap, HashSet};
use std::io::Read;
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use totex_host::sync::lock;

use crate::Sessions;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ActivityState {
    Agent,
    Working,
    Idle,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Activity {
    pub id: String,
    pub activity: Option<ActivityState>,
}

pub type ReplyReporter = Arc<dyn Fn(&str, Reply) + Send + Sync>;

pub type ActivityReporter = Arc<dyn Fn(&Activity) + Send + Sync>;

pub(super) struct Target {
    id: String,
    cwd: String,
    processes: Vec<Process>,
}

pub(super) struct Process {
    pid: u32,
    parent: u32,
    args: Vec<String>,
    cwd: Option<String>,
    env: HashMap<String, String>,
    listening: Vec<u16>,
    open_files: Vec<String>,
}

pub struct Monitor {
    states: Mutex<HashMap<String, ActivityState>>,
    reporting: Mutex<Vec<ActivityReporter>>,
    replies: Mutex<Vec<ReplyReporter>>,
    claude: Mutex<Option<std::sync::Weak<crate::door::Door>>>,
}

impl Monitor {
    pub fn new(sessions: Arc<Sessions>) -> Arc<Self> {
        let monitor = Arc::new(Self {
            states: Mutex::new(HashMap::new()),
            reporting: Mutex::new(Vec::new()),
            replies: Mutex::new(Vec::new()),
            claude: Mutex::new(None),
        });
        let weak = Arc::downgrade(&monitor);
        // The worker never keeps the runtime alive after its owner goes away.
        std::thread::spawn(move || {
            let mut codex = codex::Codex::default();
            loop {
                let Some(monitor) = weak.upgrade() else { break };
                let targets = process::targets(&sessions);
                let states = std::thread::scope(|scope| {
                    let claude = scope.spawn(|| {
                        let door = lock(&monitor.claude)
                            .as_ref()
                            .and_then(std::sync::Weak::upgrade);
                        claude::read_replies(&targets, |id, session| {
                            if let Some(reply) =
                                door.as_ref().and_then(|door| door.claude_reply(session))
                            {
                                monitor.reply(id, reply);
                            }
                        })
                    });
                    let opencode = scope.spawn(|| {
                        opencode::read_replies(&targets, |id, reply| monitor.reply(id, reply))
                    });
                    let mut states = codex.read(&targets, |id, reply| monitor.reply(id, reply));
                    for state in [claude.join(), opencode.join()].into_iter().flatten() {
                        for (id, next) in state {
                            states
                                .entry(id)
                                .and_modify(|before| {
                                    if next == ActivityState::Working {
                                        *before = next;
                                    }
                                })
                                .or_insert(next);
                        }
                    }
                    states
                });
                monitor.publish(states);
                drop(monitor);
                std::thread::sleep(Duration::from_millis(750));
            }
        });
        monitor
    }

    pub fn claude_hooks(&self, door: std::sync::Weak<crate::door::Door>) {
        *lock(&self.claude) = Some(door);
    }

    pub fn reply_to(&self, reporter: ReplyReporter) {
        lock(&self.replies).push(reporter);
    }

    fn reply(&self, id: &str, reply: Reply) {
        for reporter in lock(&self.replies).clone() {
            reporter(id, reply.clone());
        }
    }

    pub fn follow(&self, reporter: ActivityReporter) {
        lock(&self.reporting).push(reporter);
    }

    pub fn activities(&self) -> Vec<Activity> {
        lock(&self.states)
            .iter()
            .map(|(id, state)| Activity {
                id: id.clone(),
                activity: Some(*state),
            })
            .collect()
    }

    fn publish(&self, next: HashMap<String, ActivityState>) {
        let changes = {
            let mut states = lock(&self.states);
            let ids: HashSet<_> = states.keys().chain(next.keys()).cloned().collect();
            let changes: Vec<_> = ids
                .into_iter()
                .filter_map(|id| {
                    (states.get(&id) != next.get(&id)).then(|| Activity {
                        activity: next.get(&id).copied(),
                        id,
                    })
                })
                .collect();
            *states = next;
            changes
        };
        let listeners = lock(&self.reporting).clone();
        for changed in changes {
            for listener in &listeners {
                listener(&changed);
            }
        }
    }
}

pub(crate) fn command_json(
    program: &str,
    args: &[&str],
    env: &HashMap<String, String>,
) -> Result<Value, String> {
    command_json_timeout(program, args, env, Duration::from_millis(1500))
}

pub(crate) fn command_json_timeout(
    program: &str,
    args: &[&str],
    env: &HashMap<String, String>,
    timeout: Duration,
) -> Result<Value, String> {
    let mut command = Command::new(program);
    command
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    // The queried process's configuration must win over the monitor's environment.
    command.env_remove("CLAUDE_CONFIG_DIR");
    command.envs(env);
    let mut child = command.spawn().map_err(|error| error.to_string())?;
    let stdout = child.stdout.take().ok_or("missing stdout")?;
    let reader = std::thread::spawn(move || {
        let mut data = Vec::new();
        stdout
            .take(2 * 1024 * 1024 + 1)
            .read_to_end(&mut data)
            .map(|_| data)
    });
    let deadline = Instant::now() + timeout;
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break Some(status),
            Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(10)),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                break None;
            }
        }
    };
    // A descendant may hold stdout open; do not wait for that pipe indefinitely.
    if status.is_none_or(|status| !status.success()) {
        return Err("status unavailable".into());
    }
    while !reader.is_finished() && Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(5));
    }
    if !reader.is_finished() {
        return Err("status timeout".into());
    }
    let data = reader
        .join()
        .map_err(|_| "status reader failed")?
        .map_err(|error| error.to_string())?;
    if data.len() > 2 * 1024 * 1024 {
        return Err("status too large".into());
    }
    serde_json::from_slice(&data).map_err(|error| error.to_string())
}

fn http_json(base: &str, path: &str, directory: &str, auth: Option<(&str, &str)>) -> Option<Value> {
    static CRYPTO: std::sync::Once = std::sync::Once::new();
    CRYPTO.call_once(|| {
        let _ = rustls::crypto::ring::default_provider().install_default();
    });
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .ok()?;
    runtime.block_on(async {
        let client = reqwest::Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_millis(300))
            .build()
            .ok()?;
        let mut url =
            reqwest::Url::parse(&format!("{}{}", base.trim_end_matches('/'), path)).ok()?;
        if !directory.is_empty() {
            url.query_pairs_mut().append_pair("directory", directory);
        }
        let mut request = client.get(url);

        if let Some((user, password)) = auth {
            request = request.basic_auth(user, Some(password));
        }
        let response = request.send().await.ok()?.error_for_status().ok()?;
        if response
            .content_length()
            .is_some_and(|length| length > 2 * 1024 * 1024)
        {
            return None;
        }
        let mut response = response;
        let mut data = Vec::new();
        while let Some(chunk) = response.chunk().await.ok()? {
            if data.len() + chunk.len() > 2 * 1024 * 1024 {
                return None;
            }
            data.extend_from_slice(&chunk);
        }
        serde_json::from_slice(&data).ok()
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn publishes_only_changes_and_clears_missing_status() {
        let monitor = Monitor {
            states: Mutex::default(),
            reporting: Mutex::default(),
            replies: Mutex::default(),
            claude: Mutex::default(),
        };
        let seen = Arc::new(Mutex::new(Vec::new()));
        let capture = Arc::clone(&seen);
        monitor.follow(Arc::new(move |activity| {
            lock(&capture).push(activity.clone())
        }));
        monitor.publish(HashMap::from([("terminal".into(), ActivityState::Working)]));
        monitor.publish(HashMap::from([("terminal".into(), ActivityState::Working)]));
        monitor.publish(HashMap::from([("terminal".into(), ActivityState::Agent)]));
        monitor.publish(HashMap::new());
        let changes = lock(&seen);
        assert_eq!(changes.len(), 3);
        assert_eq!(changes[0].activity, Some(ActivityState::Working));
        assert_eq!(changes[1].activity, Some(ActivityState::Agent));
        assert_eq!(changes[2].activity, None);
        assert!(monitor.activities().is_empty());
    }
}

#[cfg(all(test, target_os = "linux"))]
#[path = "tests/claude.rs"]
mod claude_integration;
