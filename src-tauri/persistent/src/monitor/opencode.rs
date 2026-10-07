//! Read the existing OpenCode TUI server; never start or configure one.
//!
//! API contract: https://opencode.ai/docs/server/ and the official SDK's
//! packages/sdk/openapi.json (permission.list and question.list).

use std::collections::{HashMap, HashSet};
use std::time::{Duration, Instant};

use reqwest::Url;
use serde_json::Value;

use super::{Process, Target};
use crate::monitor::{ActivityState, Reply, ReplyStatus};

pub(super) fn read_replies(
    targets: &[Target],
    report: impl FnMut(&str, Reply),
) -> HashMap<String, ActivityState> {
    read_detailed(targets, super::http_json, report)
}

#[cfg(test)]
fn read_with(
    targets: &[Target],
    get: impl FnMut(&str, &str, &str, Option<(&str, &str)>) -> Option<Value>,
) -> HashMap<String, ActivityState> {
    read_detailed(targets, get, |_, _| {})
}

fn read_detailed(
    targets: &[Target],
    mut get: impl FnMut(&str, &str, &str, Option<(&str, &str)>) -> Option<Value>,
    mut report: impl FnMut(&str, Reply),
) -> HashMap<String, ActivityState> {
    let mut result = HashMap::new();
    for target in targets {
        let deadline = Instant::now() + Duration::from_millis(1500);
        for process in target
            .processes
            .iter()
            .filter(|process| is_opencode(process))
            .take(8)
        {
            let directory = flag(&process.args, "--dir", None)
                .or(process.cwd.as_deref())
                .unwrap_or(&target.cwd);
            let session = if process.args.iter().any(|arg| arg == "--fork") {
                None
            } else {
                flag(&process.args, "--session", Some("-s"))
            };
            let password = flag(&process.args, "--password", Some("-p")).or_else(|| {
                process
                    .env
                    .get("OPENCODE_SERVER_PASSWORD")
                    .map(String::as_str)
            });
            let username = process
                .env
                .get("OPENCODE_SERVER_USERNAME")
                .map(String::as_str)
                .unwrap_or("opencode");
            for (base, owned) in endpoints(target, process).into_iter().take(8) {
                if Instant::now() >= deadline {
                    break;
                }
                if !owned && session.is_none() {
                    let owners = targets
                        .iter()
                        .flat_map(|target| {
                            target
                                .processes
                                .iter()
                                .filter(|process| is_opencode(process))
                                .flat_map(move |process| endpoints(target, process))
                        })
                        .filter(|(candidate, _)| candidate == &base)
                        .count();
                    if owners > 1 {
                        continue;
                    }
                }
                let auth = password.map(|password| (username, password));
                let state = poll(session, directory, owned, |path| {
                    if Instant::now() >= deadline {
                        return None;
                    }
                    get(&base, path, directory, auth)
                });
                if state.is_some() && Instant::now() < deadline {
                    // Transcript ownership must be exact even when this process's
                    // backend contains multiple historical roots.
                    let exact = if let Some(id) = session {
                        Some(id.to_string())
                    } else {
                        get(&base, "/session", directory, auth).and_then(|sessions| {
                            let roots: Vec<_> = sessions
                                .as_array()?
                                .iter()
                                .filter(|s| {
                                    s["directory"] == directory && !s["parentID"].is_string()
                                })
                                .filter_map(|s| s["id"].as_str().map(str::to_string))
                                .collect();
                            (roots.len() == 1).then(|| roots[0].clone())
                        })
                    };
                    if let Some(session) = exact
                        && let Some(messages) = get(
                            &base,
                            &format!("/session/{session}/message?limit=128"),
                            directory,
                            auth,
                        )
                        && let Some(reply) = reply(&session, &messages)
                    {
                        report(&target.id, reply);
                    }
                }
                if let Some(state) = state {
                    result
                        .entry(target.id.clone())
                        .and_modify(|before| {
                            if state == ActivityState::Working {
                                *before = state;
                            }
                        })
                        .or_insert(state);
                    break;
                }
            }
            if Instant::now() >= deadline || result.get(&target.id) == Some(&ActivityState::Working)
            {
                break;
            }
        }
    }
    result
}

fn is_opencode(process: &Process) -> bool {
    process.args.iter().take(2).any(|arg| {
        std::path::Path::new(arg)
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| matches!(name, "opencode" | "opencode.exe" | "opencode.js"))
    })
}

fn flag<'a>(args: &'a [String], long: &str, short: Option<&str>) -> Option<&'a str> {
    for (index, arg) in args.iter().enumerate() {
        if arg == long || short == Some(arg.as_str()) {
            return args.get(index + 1).map(String::as_str);
        }
        if let Some((key, value)) = arg.split_once('=')
            && (key == long || short == Some(key))
        {
            return Some(value);
        }
    }
    None
}

fn endpoints(target: &Target, process: &Process) -> Vec<(String, bool)> {
    let mut endpoints = Vec::new();
    if let Some(index) = process.args.iter().position(|arg| arg == "attach")
        && let Some(url) = process.args.get(index + 1).and_then(|arg| local_url(arg))
    {
        endpoints.push((url, false));
    }
    if let Some(url) = flag(&process.args, "--attach", None).and_then(local_url) {
        endpoints.push((url, false));
    }
    let mut descendants = HashSet::from([process.pid]);
    loop {
        let before = descendants.len();
        for child in &target.processes {
            if descendants.contains(&child.parent) {
                descendants.insert(child.pid);
            }
        }
        if before == descendants.len() {
            break;
        }
    }
    for child in &target.processes {
        if descendants.contains(&child.pid) {
            for port in &child.listening {
                endpoints.push((format!("http://127.0.0.1:{port}"), true));
                endpoints.push((format!("http://[::1]:{port}"), true));
            }
        }
    }
    if let Some(port) = flag(&process.args, "--port", None)
        .and_then(|port| port.parse::<u16>().ok())
        .filter(|port| *port != 0)
    {
        endpoints.push((format!("http://127.0.0.1:{port}"), false));
    }
    endpoints.sort();
    endpoints.dedup();
    endpoints
}

fn local_url(value: &str) -> Option<String> {
    let mut url = Url::parse(value).ok()?;
    let host = url.host_str()?.trim_matches(['[', ']']);
    let local = host.eq_ignore_ascii_case("localhost")
        || host
            .parse::<std::net::IpAddr>()
            .is_ok_and(|ip| ip.is_loopback());
    if !local
        || !matches!(url.scheme(), "http" | "https")
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return None;
    }
    url.set_path("");
    url.set_query(None);
    url.set_fragment(None);
    Some(url.as_str().trim_end_matches('/').to_string())
}

fn poll(
    selected: Option<&str>,
    directory: &str,
    owned: bool,
    mut get: impl FnMut(&str) -> Option<Value>,
) -> Option<ActivityState> {
    // Verify the candidate before reading project or session endpoints.
    let health = get("/global/health")?;
    if health["healthy"] != true || health["version"].as_str().is_none() {
        return None;
    }
    let sessions = get("/session")?;
    let sessions = sessions.as_array()?;
    let statuses = get("/session/status")?;
    let statuses = statuses.as_object()?;
    let roots: Vec<&str> = sessions
        .iter()
        .filter(|session| session["directory"] == directory && !session["parentID"].is_string())
        .filter_map(|session| session["id"].as_str())
        .collect();
    let selected_roots = if let Some(id) = selected {
        if !roots.contains(&id) {
            return None;
        }
        vec![id]
    } else if owned {
        // The process owns this backend. Historical idle sessions do not imply work.
        roots
    } else if roots.len() == 1 {
        roots
    } else {
        // A shared backend has no API to read the selected TUI session.
        return None;
    };
    if selected_roots.is_empty() {
        return Some(ActivityState::Agent);
    }
    let permissions = get("/permission")?;
    let questions = get("/question")?;
    let waiting: HashSet<&str> = permissions
        .as_array()?
        .iter()
        .chain(questions.as_array()?.iter())
        .filter_map(|request| request["sessionID"].as_str())
        .collect();
    for selected in selected_roots {
        // Waiting in a delegated child also blocks progress in its parent session.
        let mut family = HashSet::from([selected]);
        loop {
            let before = family.len();
            for session in sessions {
                if session["parentID"]
                    .as_str()
                    .is_some_and(|parent| family.contains(parent))
                {
                    family.insert(session["id"].as_str()?);
                }
            }
            if before == family.len() {
                break;
            }
        }
        if family.iter().any(|id| waiting.contains(id)) {
            continue;
        }
        let mut working = false;
        for id in family {
            match statuses.get(id).and_then(|status| status["type"].as_str()) {
                Some("busy" | "retry") => working = true,
                Some("idle") | None => (),
                _ => return None,
            }
        }
        if working {
            return Some(ActivityState::Working);
        }
    }
    Some(ActivityState::Agent)
}

fn reply(session: &str, messages: &Value) -> Option<Reply> {
    let messages = messages.as_array()?;
    let newest = |role: &str| {
        messages
            .iter()
            .filter(|m| m["info"]["role"] == role)
            .max_by_key(|m| {
                (
                    m["info"]["time"]["created"].as_u64().unwrap_or(0),
                    m["info"]["id"].as_str().unwrap_or(""),
                )
            })
    };
    let user = newest("user")?;
    let user_id = user["info"]["id"].as_str()?;
    let Some(message) = newest("assistant").filter(|m| m["info"]["parentID"] == user_id) else {
        return Some(Reply::new(
            "opencode",
            session,
            user_id,
            ReplyStatus::InProgress,
            "",
        ));
    };
    let info = &message["info"];
    // Tools completing and permission waits are not assistant turn completions.
    let status = if info["summary"] == true {
        ReplyStatus::InProgress
    } else if info["error"].is_object() {
        if info["error"]["name"] == "MessageAbortedError" {
            ReplyStatus::Interrupted
        } else {
            ReplyStatus::Failed
        }
    } else if info["time"]["completed"].is_number() && info["finish"] == "stop" {
        ReplyStatus::Completed
    } else if info["time"]["completed"].is_number() && info["finish"] == "length" {
        ReplyStatus::Failed
    } else {
        ReplyStatus::InProgress
    };
    let text = if status == ReplyStatus::InProgress {
        String::new()
    } else {
        message["parts"]
            .as_array()?
            .iter()
            .filter(|part| {
                part["type"] == "text" && part["synthetic"] != true && part["ignored"] != true
            })
            .filter_map(|part| part["text"].as_str())
            .collect::<Vec<_>>()
            .join("\n\n")
    };
    let text = if status == ReplyStatus::Failed && text.is_empty() {
        info["error"]["data"]["message"]
            .as_str()
            .unwrap_or("")
            .to_string()
    } else {
        text
    };
    Some(Reply::new("opencode", session, user_id, status, &text))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn fixture(status: Value, pending: Value) -> HashMap<&'static str, Value> {
        HashMap::from([
            (
                "/global/health",
                json!({"healthy":true,"version":"1.18.18"}),
            ),
            (
                "/session",
                json!([
                    {"id":"ses_root","directory":"/work"},
                    {"id":"ses_child","parentID":"ses_root","directory":"/work"}
                ]),
            ),
            ("/session/status", status),
            ("/permission", pending),
            ("/question", json!([])),
        ])
    }

    #[test]
    fn tracks_busy_waiting_and_completion_without_touching_another_session() {
        let mut fixture = fixture(json!({"ses_root":{"type":"busy"}}), json!([]));
        assert_eq!(
            poll(None, "/work", false, |path| fixture.get(path).cloned()),
            Some(ActivityState::Working)
        );
        fixture.insert("/permission", json!([{"sessionID":"ses_child"}]));
        assert_eq!(
            poll(None, "/work", false, |path| fixture.get(path).cloned()),
            Some(ActivityState::Agent)
        );
        fixture.insert("/permission", json!([{"sessionID":"ses_other"}]));
        fixture.insert("/session/status", json!({"ses_other":{"type":"busy"}}));
        assert_eq!(
            poll(None, "/work", false, |path| fixture.get(path).cloned()),
            Some(ActivityState::Agent)
        );
    }

    #[test]
    fn declines_ambiguous_roots_but_honors_exact_session() {
        let mut fixture = fixture(json!({"ses_root":{"type":"busy"}}), json!([]));
        fixture
            .get_mut("/session")
            .unwrap()
            .as_array_mut()
            .unwrap()
            .push(json!({"id":"ses_other","directory":"/work"}));
        assert_eq!(
            poll(None, "/work", false, |path| fixture.get(path).cloned()),
            None
        );
        assert_eq!(
            poll(Some("ses_root"), "/work", false, |path| fixture
                .get(path)
                .cloned()),
            Some(ActivityState::Working)
        );
        assert_eq!(
            poll(Some("ses_missing"), "/work", false, |path| fixture
                .get(path)
                .cloned()),
            None
        );
    }

    #[test]
    fn refuses_unverified_servers_and_incomplete_waiting_data() {
        let mut calls = Vec::new();
        assert_eq!(
            poll(None, "/work", false, |path| {
                calls.push(path.to_string());
                Some(json!({"healthy":true}))
            }),
            None
        );
        assert_eq!(calls, ["/global/health"]);
        let mut fixture = fixture(json!({"ses_root":{"type":"busy"}}), json!([]));
        fixture.remove("/question");
        assert_eq!(
            poll(None, "/work", false, |path| fixture.get(path).cloned()),
            None
        );
    }

    #[test]
    fn a_second_working_process_overrides_an_idle_first_process() {
        let processes = [10001, 10002]
            .into_iter()
            .enumerate()
            .map(|(index, port)| Process {
                pid: index as u32 + 1,
                parent: 0,
                args: vec!["opencode".into()],
                cwd: Some("/work".into()),
                env: HashMap::new(),
                listening: vec![port],
                open_files: vec![],
            })
            .collect();
        let targets = vec![Target {
            id: "terminal".into(),
            cwd: "/work".into(),
            processes,
        }];
        let idle = fixture(json!({}), json!([]));
        let busy = fixture(json!({"ses_root":{"type":"busy"}}), json!([]));
        let result = read_with(&targets, |base, path, _, _| {
            if base.ends_with(":10001") {
                idle.get(path).cloned()
            } else {
                busy.get(path).cloned()
            }
        });
        assert_eq!(result["terminal"], ActivityState::Working);
    }

    #[test]
    fn owned_backend_aggregates_live_roots_and_ignores_historical_sessions() {
        let mut fixture = fixture(
            json!({"ses_root":{"type":"busy"},"ses_other":{"type":"retry"}}),
            json!([{"sessionID":"ses_root"}]),
        );
        fixture
            .get_mut("/session")
            .unwrap()
            .as_array_mut()
            .unwrap()
            .extend([
                json!({"id":"ses_other","directory":"/work"}),
                json!({"id":"ses_history","directory":"/work"}),
            ]);
        assert_eq!(
            poll(None, "/work", true, |path| fixture.get(path).cloned()),
            Some(ActivityState::Working)
        );
        fixture.insert("/question", json!([{"sessionID":"ses_other"}]));
        assert_eq!(
            poll(None, "/work", true, |path| fixture.get(path).cloned()),
            Some(ActivityState::Agent)
        );
    }

    #[test]
    fn polls_existing_http_server_with_directory_context() {
        use std::io::{Read, Write};
        use std::net::TcpListener;
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let fixture = fixture(json!({"ses_root":{"type":"busy"}}), json!([]));
        let server = std::thread::spawn(move || {
            for path in [
                "/global/health",
                "/session",
                "/session/status",
                "/permission",
                "/question",
            ] {
                let (mut stream, _) = listener.accept().unwrap();
                stream
                    .set_read_timeout(Some(std::time::Duration::from_secs(2)))
                    .unwrap();
                let mut request = Vec::new();
                let mut buffer = [0u8; 1024];
                while !request.windows(4).any(|bytes| bytes == b"\r\n\r\n") {
                    let count = stream.read(&mut buffer).unwrap();
                    assert_ne!(count, 0);
                    request.extend_from_slice(&buffer[..count]);
                }
                let request = String::from_utf8(request).unwrap();
                assert!(request.starts_with(&format!("GET {path}")));
                if path != "/global/health" {
                    assert!(request.contains("directory=%2Fwork"));
                }
                let body = fixture[path].to_string();
                write!(stream, "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", body.len(), body).unwrap();
            }
        });
        assert_eq!(
            poll(None, "/work", true, |path| {
                super::super::http_json(&base, path, "/work", None)
            }),
            Some(ActivityState::Working)
        );
        server.join().unwrap();
    }

    #[test]
    fn attach_is_local_only() {
        assert_eq!(
            local_url("http://localhost:4096/"),
            Some("http://localhost:4096".into())
        );
        assert!(local_url("http://192.168.1.5:4096").is_none());
        assert!(local_url("http://localhost.example.com:4096").is_none());
        assert!(local_url("http://secret@localhost:4096").is_none());
    }

    #[test]
    fn body_poll_maps_exact_session_and_does_not_read_ambiguous_transcripts() {
        let targets = [Target {
            id: "terminal".into(),
            cwd: "/work".into(),
            processes: vec![Process {
                pid: 1,
                parent: 0,
                args: vec!["opencode".into()],
                cwd: Some("/work".into()),
                env: HashMap::new(),
                listening: vec![10001],
                open_files: vec![],
            }],
        }];
        let mut data = fixture(json!({}), json!([]));
        data.insert("/session/ses_root/message?limit=128", json!([
            {"info":{"id":"u","role":"user","time":{"created":1}}},
            {"info":{"id":"a","role":"assistant","parentID":"u","time":{"created":2,"completed":3},"finish":"stop"},
             "parts":[{"type":"text","text":"本文"}]}
        ]));
        let mut replies = Vec::new();
        read_detailed(
            &targets,
            |_, path, directory, _| {
                assert_eq!(directory, "/work");
                data.get(path).cloned()
            },
            |id, reply| replies.push((id.to_string(), reply)),
        );
        assert_eq!(replies.len(), 1);
        assert_eq!(replies[0].0, "terminal");
        assert_eq!(replies[0].1.session_id, "ses_root");
        assert_eq!(replies[0].1.text, "本文");
        data.get_mut("/session")
            .unwrap()
            .as_array_mut()
            .unwrap()
            .push(json!({"id":"other","directory":"/work"}));
        read_detailed(
            &targets,
            |_, path, _, _| {
                assert!(!path.contains("/message"));
                data.get(path).cloned()
            },
            |_, _| panic!("ambiguous reply must not be published"),
        );
    }
    #[test]
    fn reply_requires_latest_user_parent_and_final_stop_not_tool_completion() {
        let mut messages = json!([
            {"info":{"id":"u","role":"user","time":{"created":10}}},
            {"info":{"id":"a","role":"assistant","parentID":"u","time":{"created":11,"completed":12},"finish":"tool-calls"},
             "parts":[{"type":"tool","state":{"output":"not a reply"}},{"type":"text","text":"途中"}]}
        ]);
        assert_eq!(
            reply("s", &messages).unwrap().status,
            ReplyStatus::InProgress
        );
        messages[1]["info"]["finish"] = json!("stop");
        messages[1]["parts"] = json!([
            {"type":"reasoning","text":"private"},{"type":"text","text":"最終返信\n本文"},
            {"type":"text","synthetic":true,"text":"injected"},
            {"type":"text","ignored":true,"text":"ignored"}
        ]);
        let result = reply("s", &messages).unwrap();
        assert_eq!(result.status, ReplyStatus::Completed);
        assert_eq!(result.text, "最終返信\n本文");
        messages[1]["info"]["summary"] = json!(true);
        assert_eq!(
            reply("s", &messages).unwrap().status,
            ReplyStatus::InProgress
        );
        assert!(reply("s", &messages).unwrap().text.is_empty());
        messages[1]["info"]["summary"] = json!(false);
        messages
            .as_array_mut()
            .unwrap()
            .push(json!({"info":{"id":"new","role":"user","time":{"created":20}}}));
        assert_eq!(
            reply("s", &messages).unwrap().status,
            ReplyStatus::InProgress
        );
        messages[1]["info"]["parentID"] = json!("new");
        messages[1]["info"]["error"] = json!({"name":"MessageAbortedError"});
        assert_eq!(
            reply("s", &messages).unwrap().status,
            ReplyStatus::Interrupted
        );
        messages[1]["info"]["error"] = json!({"name":"APIError"});
        assert_eq!(reply("s", &messages).unwrap().status, ReplyStatus::Failed);
    }
}
