//! Observe an existing Codex daemon through its official read-only RPCs.
//!
//! Connect directly over WebSocket to the existing Unix control socket.
//! No CLI subprocess, stdio proxy, or daemon is started.
//! We only use IDs proven by the CLI's arguments, open rollout file names, or
//! tool-child environment. A directory match cannot identify a terminal.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use serde_json::{Value, json};

use super::{Process, Target};
use crate::monitor::{ActivityState, Reply, ReplyStatus};

#[derive(Default)]
pub(super) struct Codex {
    // Keep an exact child-discovered identity when the tool child exits. The
    // process snapshot retains the live Codex PID; exiting removes this entry.
    known: HashMap<u32, String>,
}

impl Codex {
    pub(super) fn read(
        &mut self,
        targets: &[Target],
        mut report: impl FnMut(&str, Reply),
    ) -> HashMap<String, ActivityState> {
        let mut live = HashSet::new();
        let mut queries: HashMap<PathBuf, Vec<(String, String)>> = HashMap::new();
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
                queries
                    .entry(socket)
                    .or_default()
                    .push((target.id.clone(), id.clone()));
            }
        }
        self.known.retain(|pid, _| live.contains(pid));
        let mut states = HashMap::new();
        // A malicious or broken CLI must not stall every terminal indefinitely.
        for (socket, mapped) in queries.into_iter().take(4) {
            let ids: HashSet<_> = mapped.iter().map(|(_, id)| id.clone()).take(32).collect();
            let mut replies = HashMap::new();
            let found = query_replies(&socket, &ids, |id, reply| {
                replies.insert(id.to_string(), reply);
            });
            for (terminal, thread) in mapped {
                if let Some(reply) = replies.get(&thread) {
                    report(&terminal, reply.clone());
                }
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

#[cfg(not(unix))]
fn query_replies(
    _: &Path,
    _: &HashSet<String>,
    _: impl FnMut(&str, Reply),
) -> HashMap<String, ActivityState> {
    HashMap::new()
}

#[cfg(unix)]
fn query_replies(
    socket: &Path,
    ids: &HashSet<String>,
    mut report: impl FnMut(&str, Reply),
) -> HashMap<String, ActivityState> {
    use std::os::unix::net::UnixStream;
    use tungstenite::{Message, client::client_with_config, protocol::WebSocketConfig};

    let mut states = HashMap::new();
    let deadline = Instant::now() + Duration::from_millis(350);
    let Ok(stream) = UnixStream::connect(socket) else {
        return states;
    };
    let timeout = Some(deadline.saturating_duration_since(Instant::now()));
    if stream.set_read_timeout(timeout).is_err() || stream.set_write_timeout(timeout).is_err() {
        return states;
    }
    let config = WebSocketConfig::default()
        .read_buffer_size(4096)
        .max_message_size(Some(2 * 1024 * 1024))
        .max_frame_size(Some(2 * 1024 * 1024));
    // This URL supplies the HTTP Upgrade headers only; the connection is the
    // Unix stream above, never a TCP request to localhost.
    let Ok((mut connection, _)) = client_with_config("ws://localhost/", stream, Some(config))
    else {
        return states;
    };
    let initialize = json!({"id": 0, "method": "initialize", "params": {
        "clientInfo": {"name": "totex_monitor", "title": "totex activity monitor", "version": env!("CARGO_PKG_VERSION")},
        "capabilities": {"experimentalApi": true}
    }});
    if connection
        .send(Message::Text(initialize.to_string().into()))
        .is_err()
        || response(&mut connection, 0, deadline).is_none()
        || connection
            .send(Message::Text(
                json!({"method": "initialized"}).to_string().into(),
            ))
            .is_err()
    {
        return states;
    }
    for (index, thread) in ids.iter().take(32).enumerate() {
        if Instant::now() >= deadline {
            break;
        }
        let request = (index * 3 + 1) as u64;
        let message = json!({"id": request, "method": "thread/read", "params": {
            "threadId": thread, "includeTurns": false
        }});
        if connection
            .send(Message::Text(message.to_string().into()))
            .is_err()
        {
            break;
        }
        let Some(result) = response(&mut connection, request, deadline) else {
            break;
        };
        if let Some(state) = result
            .get("thread")
            .and_then(|t| t.get("status"))
            .and_then(status)
        {
            states.insert(thread.clone(), state);
        }
        let Some(mut snapshot) = result.get("thread").cloned().filter(|t| t["id"] == *thread)
        else {
            continue;
        };
        let message = json!({"id": request + 1, "method":"thread/turns/list", "params": {
            "threadId":thread,"limit":1,"sortDirection":"desc","itemsView":"full"
        }});
        if connection
            .send(Message::Text(message.to_string().into()))
            .is_err()
        {
            break;
        }
        if let Some(turns) =
            response(&mut connection, request + 1, deadline).and_then(|r| r.get("data").cloned())
        {
            snapshot["turns"] = turns;
        } else if Instant::now() < deadline {
            // Older daemons may lack the paged API. Keep the fallback bounded
            // by the same frame/message and total-time limits.
            let message = json!({"id":request + 2,"method":"thread/read","params":{"threadId":thread,"includeTurns":true}});
            if connection
                .send(Message::Text(message.to_string().into()))
                .is_err()
            {
                break;
            }
            let Some(full) = response(&mut connection, request + 2, deadline)
                .and_then(|r| r.get("thread").cloned())
            else {
                continue;
            };
            if full["id"] != *thread {
                continue;
            }
            snapshot = full;
        }
        if let Some(reply) = reply(&snapshot) {
            report(thread, reply);
        }
    }
    // Dropping only our connection never resumes a thread, answers approvals,
    // subscribes, or stops the daemon.
    states
}

#[cfg(unix)]
fn response(
    connection: &mut tungstenite::WebSocket<std::os::unix::net::UnixStream>,
    request: u64,
    deadline: Instant,
) -> Option<Value> {
    // Bound unrelated notifications as well as the total wait time.
    for _ in 0..64 {
        let remaining = deadline.checked_duration_since(Instant::now())?;
        if remaining.is_zero() {
            return None;
        }
        connection
            .get_ref()
            .set_read_timeout(Some(remaining))
            .ok()?;
        connection
            .get_ref()
            .set_write_timeout(Some(remaining))
            .ok()?;
        let message = connection.read().ok()?;
        let tungstenite::Message::Text(text) = message else {
            continue;
        };
        let value: Value = serde_json::from_str(&text).ok()?;
        if value.get("id").and_then(Value::as_u64) == Some(request) && value.get("method").is_none()
        {
            return value.get("result").cloned();
        }
    }
    None
}

fn reply(thread: &Value) -> Option<Reply> {
    let session = thread["id"].as_str()?;
    let turn = thread["turns"].as_array()?.last();
    // The paged history can lag a live turn. Clear the previous reply as
    // soon as runtime metadata confirms work, without inventing a turn ID.
    if thread["status"]["type"] == "active" && turn.is_none_or(|t| t["status"] != "inProgress") {
        return Some(Reply::new(
            "codex",
            session,
            "",
            ReplyStatus::InProgress,
            "",
        ));
    }
    let turn = turn?;
    let status = match turn["status"].as_str()? {
        "inProgress" => ReplyStatus::InProgress,
        "completed" => ReplyStatus::Completed,
        "failed" => ReplyStatus::Failed,
        "interrupted" => ReplyStatus::Interrupted,
        _ => return None,
    };
    let text = if status == ReplyStatus::InProgress {
        String::new()
    } else {
        let items = turn["items"].as_array()?;
        let final_items: Vec<_> = items
            .iter()
            .filter(|item| item["type"] == "agentMessage" && item["phase"] == "final_answer")
            .filter_map(|item| item["text"].as_str())
            .collect();
        if final_items.is_empty() {
            // Older versions omit phase: use the last assistant message only.
            items
                .iter()
                .rev()
                .find(|item| item["type"] == "agentMessage" && !item["phase"].is_string())
                .and_then(|item| item["text"].as_str())
                .unwrap_or("")
                .to_string()
        } else {
            final_items.join("\n\n")
        }
    };
    let text = if status == ReplyStatus::Failed && text.is_empty() {
        turn["error"]["message"].as_str().unwrap_or("").to_string()
    } else {
        text
    };
    Some(Reply::new(
        "codex",
        session,
        turn["id"].as_str()?,
        status,
        &text,
    ))
}

#[cfg(test)]
fn query(socket: &Path, ids: &HashSet<String>) -> HashMap<String, ActivityState> {
    query_replies(socket, ids, |_, _| {})
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

    #[cfg(unix)]
    #[test]
    fn direct_socket_protocol_reads_final_body_and_never_answers_approvals() {
        use std::os::unix::net::UnixListener;
        use tungstenite::{Message, accept};
        let folder = std::env::temp_dir().join(format!(
            "totex-codex-socket-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir(&folder).unwrap();
        let socket = folder.join("control.sock");
        let listener = UnixListener::bind(&socket).unwrap();
        let server = std::thread::spawn(move || {
            let (stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(2)))
                .unwrap();
            stream
                .set_write_timeout(Some(Duration::from_secs(2)))
                .unwrap();
            let mut connection = accept(stream).unwrap();
            let mut requests = Vec::new();
            while let Ok(Message::Text(text)) = connection.read() {
                let message: Value = serde_json::from_str(&text).unwrap();
                requests.push(message.clone());
                let result = match message["method"].as_str().unwrap() {
                    "initialize" => json!({"id":0,"result":{}}),
                    "initialized" => continue,
                    "thread/read" => {
                        connection.send(Message::Text(json!({"id":1,"method":"item/commandExecution/requestApproval","params":{}}).to_string().into())).unwrap();
                        connection
                            .send(Message::Text(
                                json!({"method":"thread/status/changed","params":{}})
                                    .to_string()
                                    .into(),
                            ))
                            .unwrap();
                        json!({"id":message["id"],"result":{"thread":{"id":message["params"]["threadId"],"status":{"type":"idle"}}}})
                    }
                    "thread/turns/list" => {
                        json!({"id":message["id"],"result":{"data":[{"id":"turn","status":"completed","items":[{"type":"agentMessage","phase":"commentary","text":"途中"},{"type":"agentMessage","phase":"final_answer","text":"正規APIの本文\n完了"}]}]}})
                    }
                    method => panic!("unexpected mutation: {method}"),
                };
                connection
                    .send(Message::Text(result.to_string().into()))
                    .unwrap();
            }
            requests
        });
        let id = "01a10b76-daae-7d40-9396-3ff708f9aba6".to_owned();
        let mut replies = Vec::new();
        let states = query_replies(&socket, &HashSet::from([id.clone()]), |_, reply| {
            replies.push(reply)
        });
        assert_eq!(states.get(&id), Some(&ActivityState::Agent));
        assert_eq!(replies.len(), 1);
        assert_eq!(replies[0].text, "正規APIの本文\n完了");
        assert_eq!(replies[0].status, ReplyStatus::Completed);
        let messages = server.join().unwrap();
        assert_eq!(messages.len(), 4);
        assert_eq!(messages[0]["method"], "initialize");
        assert_eq!(messages[1]["method"], "initialized");
        assert_eq!(messages[2]["method"], "thread/read");
        assert_eq!(messages[2]["params"]["includeTurns"], false);
        assert_eq!(messages[3]["method"], "thread/turns/list");
        assert_eq!(messages[3]["params"]["limit"], 1);
        std::fs::remove_dir_all(folder).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn unavailable_socket_returns_no_authoritative_state() {
        assert!(
            query(
                Path::new("/nonexistent/totex-control.sock"),
                &HashSet::new()
            )
            .is_empty()
        );
    }

    #[cfg(unix)]
    #[test]
    fn silent_server_respects_response_deadline() {
        use std::os::unix::net::UnixStream;
        use tungstenite::{WebSocket, protocol::Role};
        let (client, _server) = UnixStream::pair().unwrap();
        let mut connection = WebSocket::from_raw_socket(client, Role::Client, None);
        let started = Instant::now();
        assert!(response(&mut connection, 0, started + Duration::from_millis(30)).is_none());
        assert!(started.elapsed() < Duration::from_secs(2));
    }

    #[cfg(unix)]
    #[test]
    fn oversized_frame_does_not_publish_state() {
        use std::os::unix::net::UnixStream;
        use tungstenite::{
            Message, WebSocket,
            protocol::{Role, WebSocketConfig},
        };
        let (client, server) = UnixStream::pair().unwrap();
        server
            .set_write_timeout(Some(Duration::from_secs(1)))
            .unwrap();
        let sender = std::thread::spawn(move || {
            let mut connection = WebSocket::from_raw_socket(server, Role::Server, None);
            let _ = connection.send(Message::Text("x".repeat(4097).into()));
        });
        let config = WebSocketConfig::default().max_frame_size(Some(4096));
        let mut connection = WebSocket::from_raw_socket(client, Role::Client, Some(config));
        assert!(response(&mut connection, 0, Instant::now() + Duration::from_secs(1)).is_none());
        drop(connection);
        sender.join().unwrap();
    }
    #[test]
    fn reply_extracts_only_final_assistant_text_and_requires_terminal_turn_status() {
        let mut thread = json!({"id":"thread", "status":{"type":"idle"}, "turns":[
            {"id":"older","status":"completed","items":[{"type":"agentMessage","text":"old"}]},
            {"id":"latest","status":"completed","items":[
                {"type":"reasoning","text":"private"},
                {"type":"agentMessage","phase":"commentary","text":"working"},
                {"type":"commandExecution","aggregatedOutput":"tool output"},
                {"type":"agentMessage","phase":"final_answer","text":"日本語\nfinal body"}
            ]}
        ]});
        let completed = reply(&thread).unwrap();
        assert_eq!(completed.text, "日本語\nfinal body");
        assert_eq!(completed.turn_id, "latest");
        assert_eq!(completed.status, ReplyStatus::Completed);
        thread["turns"][1]["status"] = json!("inProgress");
        let running = reply(&thread).unwrap();
        assert_eq!(running.status, ReplyStatus::InProgress);
        assert!(running.text.is_empty());
        assert_ne!(running.key, completed.key);
        thread["turns"][1]["status"] = json!("interrupted");
        assert_eq!(reply(&thread).unwrap().status, ReplyStatus::Interrupted);
        thread["turns"][1]["status"] = json!("failed");
        assert_eq!(reply(&thread).unwrap().status, ReplyStatus::Failed);
        thread["status"]["type"] = json!("active");
        let active = reply(&thread).unwrap();
        assert_eq!(active.status, ReplyStatus::InProgress);
        assert!(active.text.is_empty());
        assert!(active.turn_id.is_empty());
        thread["status"]["type"] = json!("idle");
        thread["turns"][1]["status"] = json!("unknown");
        assert!(reply(&thread).is_none());
    }
}
