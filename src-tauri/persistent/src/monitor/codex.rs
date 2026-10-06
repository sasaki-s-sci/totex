//! Observe an existing Codex daemon through its official read-only RPCs.
//!
//! `proxy` connects to an existing control socket; it never starts a daemon.
//! We only use IDs proven by the CLI's arguments, open rollout file names, or
//! tool-child environment. A directory match cannot identify a terminal.

use std::collections::{HashMap, HashSet};
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::time::{Duration, Instant};

use serde_json::{Value, json};

use super::{Process, Target};
use crate::monitor::ActivityState;

#[derive(Default)]
pub(super) struct Codex {
    // Keep an exact child-discovered identity when the tool child exits. The
    // process snapshot retains the live Codex PID; exiting removes this entry.
    known: HashMap<u32, String>,
}

impl Codex {
    pub(super) fn read(&mut self, targets: &[Target]) -> HashMap<String, ActivityState> {
        let mut live = HashSet::new();
        let mut queries: HashMap<(String, PathBuf), Vec<(String, String)>> = HashMap::new();
        for target in targets {
            for process in target.processes.iter().filter(|p| is_codex(p)) {
                live.insert(process.pid);
                let exact = resumed(&process.args)
                    .or_else(|| rollout_id(&process.open_files))
                    .or_else(|| child_id(process, &target.processes));
                if let Some(id) = exact {
                    self.known.insert(process.pid, id);
                }
                let Some(id) = self.known.get(&process.pid) else {
                    continue;
                };
                let Some(socket) = socket(process) else {
                    continue;
                };
                let executable = process.args.first().cloned().unwrap_or_default();
                queries
                    .entry((executable, socket))
                    .or_default()
                    .push((target.id.clone(), id.clone()));
            }
        }
        self.known.retain(|pid, _| live.contains(pid));
        let mut states = HashMap::new();
        // A malicious or broken CLI must not stall every terminal indefinitely.
        for ((executable, socket), mapped) in queries.into_iter().take(4) {
            let ids: HashSet<_> = mapped.iter().map(|(_, id)| id.clone()).take(32).collect();
            let found = query(&executable, &socket, &ids);
            for (terminal, thread) in mapped {
                if let Some(state) = found.get(&thread) {
                    states
                        .entry(terminal)
                        .and_modify(|old| {
                            if *state == ActivityState::Working {
                                *old = *state;
                            }
                        })
                        .or_insert(*state);
                }
            }
        }
        states
    }
}

fn is_codex(process: &Process) -> bool {
    process
        .args
        .first()
        .and_then(|s| Path::new(s).file_name())
        .is_some_and(|name| name == "codex" || name == "codex.exe")
        && !process.args.iter().any(|a| a == "app-server")
}

fn uuid(value: &str) -> bool {
    value.len() == 36
        && value.bytes().enumerate().all(|(i, b)| {
            if matches!(i, 8 | 13 | 18 | 23) {
                b == b'-'
            } else {
                b.is_ascii_hexdigit()
            }
        })
}

fn resumed(args: &[String]) -> Option<String> {
    let position = args.iter().position(|a| a == "resume")?;
    args.get(position + 1).filter(|id| uuid(id)).cloned()
}

fn child_id(process: &Process, processes: &[Process]) -> Option<String> {
    let inherited = process.env.get("CODEX_THREAD_ID");
    // Only direct children: nested agents must not replace their parent's ID.
    let ids: HashSet<_> = processes
        .iter()
        .filter(|p| p.parent == process.pid)
        .filter_map(|p| p.env.get("CODEX_THREAD_ID"))
        .filter(|id| Some(*id) != inherited && uuid(id))
        .collect();
    (ids.len() == 1).then(|| (*ids.iter().next().unwrap()).clone())
}

fn rollout_id(files: &[String]) -> Option<String> {
    let ids: HashSet<_> = files
        .iter()
        .take(1024)
        .filter_map(|path| {
            let name = Path::new(path).file_name()?.to_str()?;
            let stem = name.strip_prefix("rollout-")?.strip_suffix(".jsonl")?;
            let id = stem.get(stem.len().checked_sub(36)?..)?;
            uuid(id).then(|| id.to_owned())
        })
        .collect();
    (ids.len() == 1).then(|| ids.into_iter().next().unwrap())
}

fn socket(process: &Process) -> Option<PathBuf> {
    // Explicit Unix remote connections may use a custom daemon socket.
    let remote = process
        .args
        .windows(2)
        .find(|a| a[0] == "--remote")
        .and_then(|a| a[1].strip_prefix("unix://"));
    let path = if let Some(path) = remote.filter(|p| !p.is_empty()) {
        PathBuf::from(path)
    } else {
        let home = process
            .env
            .get("CODEX_HOME")
            .map(PathBuf::from)
            .or_else(|| process.env.get("HOME").map(|h| Path::new(h).join(".codex")))?;
        home.join("app-server-control/app-server-control.sock")
    };
    existing_socket(&path).then_some(path)
}

#[cfg(unix)]
fn existing_socket(path: &Path) -> bool {
    use std::os::unix::fs::FileTypeExt;
    std::fs::metadata(path).is_ok_and(|m| m.file_type().is_socket())
}

#[cfg(not(unix))]
fn existing_socket(_: &Path) -> bool {
    false
}

fn status(value: &Value) -> Option<ActivityState> {
    match value.get("type")?.as_str()? {
        "active" => {
            let flags = value.get("activeFlags")?.as_array()?;
            Some(
                if flags
                    .iter()
                    .any(|f| matches!(f.as_str(), Some("waitingOnApproval" | "waitingOnUserInput")))
                {
                    ActivityState::Agent
                } else {
                    ActivityState::Working
                },
            )
        }
        "idle" | "systemError" => Some(ActivityState::Agent),
        // Unloaded persisted threads do not describe the live CLI's status.
        _ => None,
    }
}

fn query(executable: &str, socket: &Path, ids: &HashSet<String>) -> HashMap<String, ActivityState> {
    let mut states = HashMap::new();
    let Ok(mut child) = Command::new(executable)
        .args(["app-server", "proxy", "--sock"])
        .arg(socket)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
    else {
        return states;
    };
    let Some(stdout) = child.stdout.take() else {
        let _ = child.kill();
        let _ = child.wait();
        return states;
    };
    let (sender, receiver) = mpsc::sync_channel(64);
    let reader = std::thread::spawn(move || {
        let mut input = BufReader::new(stdout);
        loop {
            let mut line = Vec::new();
            // Bound a single message, including unwanted notifications.
            let Ok(count) = input
                .by_ref()
                .take(2 * 1024 * 1024 + 1)
                .read_until(b'\n', &mut line)
            else {
                break;
            };
            if count == 0 || count > 2 * 1024 * 1024 {
                break;
            }
            let Ok(value) = serde_json::from_slice::<Value>(&line) else {
                continue;
            };
            if sender.try_send(value).is_err() {
                break;
            }
        }
    });
    let deadline = Instant::now() + Duration::from_millis(350);
    if let Some(mut stdin) = child.stdin.take() {
        let initialize = json!({"id": 0, "method": "initialize", "params": {
            "clientInfo": {"name": "totex_monitor", "title": "totex activity monitor", "version": env!("CARGO_PKG_VERSION")},
            "capabilities": {"experimentalApi": false}
        }});
        if send(&mut stdin, &initialize).is_ok() && response(&receiver, 0, deadline).is_some() {
            let _ = send(&mut stdin, &json!({"method": "initialized"}));
            for (index, thread) in ids.iter().enumerate() {
                let request = (index + 1) as u64;
                if send(&mut stdin, &json!({"id": request, "method": "thread/read", "params": {"threadId": thread, "includeTurns": false}})).is_err() { break }
                if let Some(result) = response(&receiver, request, deadline) {
                    if let Some(state) = result
                        .get("thread")
                        .and_then(|t| t.get("status"))
                        .and_then(status)
                    {
                        states.insert(thread.clone(), state);
                    }
                } else {
                    break;
                }
            }
        }
    }
    // We never answer server requests (especially approval requests), subscribe,
    // resume threads, or terminate the daemon. Only our disposable proxy exits.
    let _ = child.kill();
    let _ = child.wait();
    drop(receiver);
    // A broken proxy may leave a descendant holding stdout open.
    if reader.is_finished() {
        let _ = reader.join();
    }
    states
}

fn send(output: &mut impl Write, message: &Value) -> std::io::Result<()> {
    serde_json::to_writer(&mut *output, message)?;
    output.write_all(b"\n")?;
    output.flush()
}

fn response(receiver: &mpsc::Receiver<Value>, request: u64, deadline: Instant) -> Option<Value> {
    loop {
        let value = receiver
            .recv_timeout(deadline.saturating_duration_since(Instant::now()))
            .ok()?;
        if value.get("id").and_then(Value::as_u64) == Some(request) && value.get("method").is_none()
        {
            return value.get("result").cloned();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn runtime_status_distinguishes_thinking_and_waiting() {
        assert_eq!(
            status(&json!({"type":"active","activeFlags":[]})),
            Some(ActivityState::Working)
        );
        for flag in ["waitingOnApproval", "waitingOnUserInput"] {
            assert_eq!(
                status(&json!({"type":"active","activeFlags":[flag]})),
                Some(ActivityState::Agent)
            );
        }
        assert_eq!(status(&json!({"type":"idle"})), Some(ActivityState::Agent));
        assert_eq!(status(&json!({"type":"notLoaded"})), None);
        assert_eq!(status(&json!({"type":"active"})), None);
    }

    #[test]
    fn resume_requires_explicit_thread_not_last_or_cwd() {
        let id = "01a10b76-daae-7d40-9396-3ff708f9aba6";
        assert_eq!(
            resumed(&["codex".into(), "resume".into(), id.into()]),
            Some(id.into())
        );
        assert_eq!(
            resumed(&["codex".into(), "resume".into(), "--last".into()]),
            None
        );
    }

    #[test]
    fn open_rollout_identity_rejects_ambiguous_files() {
        let first =
            "/sessions/rollout-2026-10-07T01-00-00-01a10b76-daae-7d40-9396-3ff708f9aba6.jsonl"
                .to_owned();
        let second =
            "/sessions/rollout-2026-10-07T01-00-00-01a10b76-daae-7d40-9396-3ff708f9aba7.jsonl"
                .to_owned();
        assert_eq!(
            rollout_id(std::slice::from_ref(&first)),
            Some("01a10b76-daae-7d40-9396-3ff708f9aba6".to_owned())
        );
        assert_eq!(rollout_id(&[first, second]), None);
        assert_eq!(rollout_id(&["/some/project/path".to_owned()]), None);
    }

    #[test]
    fn unrelated_notifications_and_server_requests_are_ignored() {
        let (sender, receiver) = mpsc::channel();
        sender
            .send(json!({"id":1,"method":"item/commandExecution/requestApproval","params":{}}))
            .unwrap();
        sender
            .send(json!({"method":"thread/status/changed","params":{}}))
            .unwrap();
        sender
            .send(json!({"id":1,"result":{"thread":{"status":{"type":"idle"}}}}))
            .unwrap();
        assert!(response(&receiver, 1, Instant::now() + Duration::from_millis(100)).is_some());
    }

    #[cfg(unix)]
    #[test]
    fn proxy_protocol_is_metadata_only_and_never_answers_approvals() {
        use std::os::unix::fs::PermissionsExt;
        let folder = std::env::temp_dir().join(format!(
            "totex-codex-proxy-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir(&folder).unwrap();
        let executable = folder.join("codex");
        let log = folder.join("requests");
        let script = r#"#!/bin/sh
while IFS= read -r line; do
    printf '%s\n' "$line" >> "$4"
    case "$line" in
        *'"method":"initialize"'*) printf '%s\n' '{"id":0,"result":{}}' ;;
        *'"method":"thread/read"'*)
            printf '%s\n' '{"id":1,"method":"item/commandExecution/requestApproval","params":{}}'
            printf '%s\n' '{"id":1,"result":{"thread":{"status":{"type":"active","activeFlags":[]}}}}' ;;
    esac
done
"#;
        std::fs::write(&executable, script).unwrap();
        std::fs::set_permissions(&executable, std::fs::Permissions::from_mode(0o700)).unwrap();
        let id = "01a10b76-daae-7d40-9396-3ff708f9aba6".to_owned();
        let states = query(
            executable.to_str().unwrap(),
            &log,
            &HashSet::from([id.clone()]),
        );
        assert_eq!(states.get(&id), Some(&ActivityState::Working));
        let messages: Vec<Value> = std::fs::read_to_string(&log)
            .unwrap()
            .lines()
            .map(|line| serde_json::from_str(line).unwrap())
            .collect();
        assert_eq!(messages.len(), 3);
        assert_eq!(messages[0]["method"], "initialize");
        assert_eq!(messages[1]["method"], "initialized");
        assert_eq!(messages[2]["method"], "thread/read");
        assert_eq!(messages[2]["params"]["includeTurns"], false);
        std::fs::remove_dir_all(folder).unwrap();
    }
}
