//! What the overseer is told, driven through a window that is only a list.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde_json::{Value, json};

use super::http::{Request, route};
use super::journal::{HELD, Journal, What};
use super::rpc::{Sight, Terminal, answer};
use super::{Overseer, launch, serve};
use crate::ask::{Ask, Choice, Doing, Taking};

const TOKEN: &str = "0123456789abcdef0123456789abcdef";

/// A window with two terminals in it and the overseer in a third.
#[derive(Default)]
struct Window {
    journal: Journal,
    statuses: Mutex<HashMap<String, String>>,
}

const OWN: &str = "overseer";

impl Sight for Window {
    fn terminals(&self) -> Vec<Terminal> {
        let statuses = self.statuses.lock().expect("statuses");
        ["a", "b"]
            .into_iter()
            .map(|id| Terminal {
                id: id.to_string(),
                cwd: format!("/work/{id}"),
                branch: Some("main".to_string()),
                doing: Some(Doing::Idle),
                asking: None,
                typed: None,
                report: None,
                status: statuses.get(id).cloned(),
            })
            .collect()
    }

    fn screen(&self, id: &str) -> Option<Vec<String>> {
        (id == "a").then(|| {
            ["$ ls", "one two", "$", "", ""]
                .into_iter()
                .map(str::to_string)
                .collect()
        })
    }

    fn describe(&self, id: &str, status: Option<String>, _: Option<&str>) -> Result<(), String> {
        if id == OWN {
            return Err("that is your own terminal".to_string());
        }
        if id != "a" && id != "b" {
            return Err(format!("there is no terminal {id}"));
        }
        let mut statuses = self.statuses.lock().expect("statuses");
        match status {
            Some(status) => statuses.insert(id.to_string(), status),
            None => statuses.remove(id),
        };
        Ok(())
    }

    fn journal(&self) -> &Journal {
        &self.journal
    }

    fn own(&self) -> Option<String> {
        Some(OWN.to_string())
    }
}

fn ask(window: &Window, method: &str, params: Value) -> Value {
    let body = json!({ "jsonrpc": "2.0", "id": 7, "method": method, "params": params });
    answer(window, body.to_string().as_bytes()).expect("an answer")
}

fn call(window: &Window, name: &str, arguments: Value) -> Value {
    ask(
        window,
        "tools/call",
        json!({ "name": name, "arguments": arguments }),
    )
}

/// The text a tool answered with, and whether it was a refusal.
fn said(answered: &Value) -> (String, bool) {
    let result = &answered["result"];
    (
        result["content"][0]["text"]
            .as_str()
            .expect("text")
            .to_string(),
        result["isError"].as_bool().unwrap_or(false),
    )
}

fn parsed(answered: &Value) -> Value {
    serde_json::from_str(&said(answered).0).expect("json text")
}

#[test]
fn initialize_answers_in_the_version_asked_for_and_says_what_it_is() {
    let window = Window::default();
    let hello = ask(
        &window,
        "initialize",
        json!({ "protocolVersion": "2025-03-26" }),
    );
    assert_eq!(hello["id"], 7);
    assert_eq!(hello["result"]["protocolVersion"], "2025-03-26");
    assert_eq!(hello["result"]["serverInfo"]["name"], "totex-overseer");
    assert!(
        hello["result"]["instructions"]
            .as_str()
            .is_some_and(|text| text.contains("read-only"))
    );

    let unknown = ask(
        &window,
        "initialize",
        json!({ "protocolVersion": "1999-01-01" }),
    );
    assert_eq!(unknown["result"]["protocolVersion"], "2025-06-18");
}

#[test]
fn a_notification_is_not_answered_and_nonsense_is_a_fault() {
    let window = Window::default();
    let told = json!({ "jsonrpc": "2.0", "method": "notifications/initialized" });
    assert!(answer(&window, told.to_string().as_bytes()).is_none());
    let fault = answer(&window, b"not json").expect("a fault");
    assert_eq!(fault["error"]["code"], -32700);
    assert_eq!(
        ask(&window, "resources/list", json!({}))["error"]["code"],
        -32601
    );
}

#[test]
fn the_four_tools_are_listed() {
    let window = Window::default();
    let listed = ask(&window, "tools/list", json!({}));
    let names: Vec<&str> = listed["result"]["tools"]
        .as_array()
        .expect("tools")
        .iter()
        .filter_map(|tool| tool["name"].as_str())
        .collect();
    assert_eq!(names, ["terminals", "screen", "wait", "describe"]);
}

#[test]
fn terminals_come_with_the_cursor_to_wait_from() {
    let window = Window::default();
    window.journal.note("a", What::Opened);
    let shown = parsed(&call(&window, "terminals", json!({})));
    assert_eq!(shown["cursor"], 1);
    assert_eq!(shown["terminals"][0]["id"], "a");
    assert_eq!(shown["terminals"][0]["doing"], "idle");
    assert_eq!(shown["terminals"][0]["branch"], "main");
    assert!(shown["terminals"][0]["status"].is_null());
}

#[test]
fn a_screen_is_trimmed_and_cut_to_the_rows_asked_for() {
    let window = Window::default();
    let (whole, _) = said(&call(&window, "screen", json!({ "id": "a" })));
    assert_eq!(whole, "$ ls\none two\n$");
    let (tail, _) = said(&call(&window, "screen", json!({ "id": "a", "rows": 2 })));
    assert_eq!(tail, "one two\n$");
    let (_, refused) = said(&call(&window, "screen", json!({ "id": "nobody" })));
    assert!(refused);
}

#[test]
fn describe_flattens_caps_clears_and_refuses() {
    let window = Window::default();
    let long = format!("waiting\n  for   {}", "x".repeat(400));
    let (_, refused) = said(&call(
        &window,
        "describe",
        json!({ "id": "a", "status": long }),
    ));
    assert!(!refused);
    let kept = window.statuses.lock().expect("statuses")["a"].clone();
    assert!(kept.starts_with("waiting for xxx"));
    assert_eq!(kept.chars().count(), 200);

    let (_, refused) = said(&call(
        &window,
        "describe",
        json!({ "id": "a", "status": "  " }),
    ));
    assert!(!refused);
    assert!(!window.statuses.lock().expect("statuses").contains_key("a"));

    for id in [OWN, "nobody"] {
        let (_, refused) = said(&call(
            &window,
            "describe",
            json!({ "id": id, "status": "x" }),
        ));
        assert!(refused, "{id} is refused");
    }
}

#[test]
fn wait_hands_over_what_is_already_there_without_the_overseer_itself() {
    let window = Window::default();
    window.journal.note("a", What::Opened);
    window.journal.note(
        OWN,
        What::Doing {
            doing: Doing::Working,
        },
    );
    window.journal.note(
        "b",
        What::Asking {
            question: Some("Proceed?".to_string()),
        },
    );

    let started = Instant::now();
    let caught = parsed(&call(&window, "wait", json!({ "since": 0 })));
    assert!(started.elapsed() < Duration::from_secs(1));
    assert_eq!(caught["cursor"], 3);
    assert_eq!(caught["missed"], false);
    assert_eq!(
        caught["changes"],
        json!([
            { "id": "a", "kind": "opened" },
            { "id": "b", "kind": "asking", "question": "Proceed?" },
        ])
    );

    // From the cursor it handed back there is nothing, and the shortest wait
    // there is runs out.
    let started = Instant::now();
    let caught = parsed(&call(
        &window,
        "wait",
        json!({ "since": 3, "timeout_seconds": 0 }),
    ));
    assert!(started.elapsed() >= Duration::from_millis(900));
    assert_eq!(caught["changes"], json!([]));
    assert_eq!(caught["cursor"], 3);
}

#[test]
fn a_session_changing_twice_is_one_change() {
    let journal = Journal::default();
    journal.note(
        "a",
        What::Doing {
            doing: Doing::Running,
        },
    );
    journal.note("b", What::Opened);
    journal.note("a", What::Doing { doing: Doing::Idle });
    let caught = journal.wait(Some(0), Duration::ZERO, Duration::ZERO, |_| true);
    assert_eq!(caught.cursor, 3);
    assert_eq!(caught.changes.len(), 2);
    assert_eq!(caught.changes[0].id, "b");
    assert_eq!(caught.changes[1].what, What::Doing { doing: Doing::Idle });
}

#[test]
fn a_wait_woken_lingers_for_the_rest_of_the_burst() {
    let journal = Arc::new(Journal::default());
    let noting = Arc::clone(&journal);
    let burst = std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(50));
        noting.note(
            "a",
            What::Doing {
                doing: Doing::Running,
            },
        );
        std::thread::sleep(Duration::from_millis(50));
        noting.note("b", What::Ended);
    });
    let caught = journal.wait(
        None,
        Duration::from_secs(10),
        Duration::from_millis(400),
        |_| true,
    );
    burst.join().expect("the burst");
    assert_eq!(caught.cursor, 2);
    assert_eq!(caught.changes.len(), 2);
    assert!(!caught.missed);
}

#[test]
fn a_wait_from_further_back_than_is_held_or_from_another_window_has_missed() {
    let journal = Journal::default();
    for _ in 0..HELD + 5 {
        journal.note("a", What::Opened);
    }
    let caught = journal.wait(Some(1), Duration::ZERO, Duration::ZERO, |_| true);
    assert!(caught.missed);
    let caught = journal.wait(Some(10), Duration::ZERO, Duration::ZERO, |_| true);
    assert!(!caught.missed);

    let fresh = Journal::default();
    let started = Instant::now();
    let caught = fresh.wait(Some(57), Duration::from_secs(10), Duration::ZERO, |_| true);
    assert!(caught.missed);
    assert_eq!(caught.cursor, 0);
    assert!(started.elapsed() < Duration::from_secs(1));
}

fn asking(question: &str, on: usize) -> Ask {
    Ask {
        seq: question.len() as u64,
        detail: Vec::new(),
        question: question.to_string(),
        taking: Taking::Key,
        picking: false,
        writing: false,
        choices: ["Yes", "No"]
            .into_iter()
            .enumerate()
            .map(|(at, label)| Choice {
                key: (at + 1).to_string(),
                label: label.to_string(),
                selected: at == on,
                picked: false,
            })
            .collect(),
    }
}

#[test]
fn a_question_is_noted_when_it_comes_and_goes_and_not_as_its_mark_moves() {
    let overseer = Overseer::default();
    overseer.lock().kept.session = Some(OWN.to_string());

    overseer.noticed("a", None, Some(&Some(asking("Proceed?", 0))));
    overseer.noticed("a", None, Some(&Some(asking("Proceed?", 1))));
    overseer.noticed("a", Some(Doing::Agent), None);
    overseer.noticed("a", None, Some(&None));
    overseer.noticed(OWN, Some(Doing::Working), Some(&Some(asking("Mine?", 0))));

    let caught = overseer
        .journal
        .wait(Some(0), Duration::ZERO, Duration::ZERO, |_| true);
    assert_eq!(caught.cursor, 3);
    assert_eq!(
        serde_json::to_value(&caught.changes).expect("json"),
        json!([
            { "id": "a", "kind": "doing", "doing": "agent" },
            { "id": "a", "kind": "asking", "question": null },
        ])
    );
}

fn request(method: &str, target: &str, bearer: Option<&str>, from_page: bool) -> Request {
    Request {
        method: method.to_string(),
        target: target.to_string(),
        bearer: bearer.map(str::to_string),
        from_page,
        body: json!({ "jsonrpc": "2.0", "id": 1, "method": "ping" })
            .to_string()
            .into_bytes(),
    }
}

#[test]
fn only_the_token_on_the_one_path_and_never_a_page_is_answered() {
    let window = Window::default();
    let status = |request: Request| route(&window, TOKEN, &request).0;
    assert_eq!(
        status(request("POST", "/mcp", Some(TOKEN), false)),
        "200 OK"
    );
    assert_eq!(
        status(request("POST", "/mcp?x=1", Some(TOKEN), false)),
        "200 OK"
    );
    assert_eq!(
        status(request("POST", "/mcp", Some(TOKEN), true)),
        "403 Forbidden"
    );
    assert_eq!(
        status(request("POST", "/mcp", None, false)),
        "401 Unauthorized"
    );
    assert_eq!(
        status(request(
            "POST",
            "/mcp",
            Some("0123456789abcdef0123456789abcdee"),
            false
        )),
        "401 Unauthorized"
    );
    assert_eq!(
        status(request("POST", "/other", Some(TOKEN), false)),
        "404 Not Found"
    );
    assert_eq!(
        status(request("GET", "/mcp", Some(TOKEN), false)),
        "405 Method Not Allowed"
    );
    assert_eq!(
        status(request("DELETE", "/mcp", Some(TOKEN), false)),
        "200 OK"
    );
}

/// One request over a real socket, and the status line it was answered with.
fn knock(port: u16, headers: &str) -> String {
    let body = json!({ "jsonrpc": "2.0", "id": 1, "method": "tools/list" }).to_string();
    let mut stream = TcpStream::connect(("127.0.0.1", port)).expect("connects");
    stream
        .set_read_timeout(Some(Duration::from_secs(5)))
        .expect("a timeout");
    write!(
        stream,
        "POST /mcp HTTP/1.1\r\nHost: 127.0.0.1\r\n{headers}Content-Length: {}\r\n\r\n{body}",
        body.len()
    )
    .expect("sent");
    // Read until the whole of the body the head promised has arrived.
    let mut answered = Vec::new();
    let mut chunk = [0u8; 4096];
    loop {
        let read = stream.read(&mut chunk).expect("answered");
        answered.extend_from_slice(&chunk[..read]);
        let text = String::from_utf8_lossy(&answered).to_string();
        if let Some((head, body)) = text.split_once("\r\n\r\n") {
            let length: usize = head
                .lines()
                .find_map(|line| line.strip_prefix("Content-Length: "))
                .and_then(|length| length.trim().parse().ok())
                .unwrap_or(0);
            if body.len() >= length {
                return text;
            }
        }
        if read == 0 {
            return text;
        }
    }
}

#[test]
fn the_listener_answers_over_a_socket() {
    let window: Arc<dyn Sight> = Arc::new(Window::default());
    let port = serve::listen(window, TOKEN.to_string(), &[0]).expect("stands");
    let answered = knock(port, &format!("Authorization: Bearer {TOKEN}\r\n"));
    assert!(answered.starts_with("HTTP/1.1 200 OK"), "{answered}");
    assert!(answered.contains("\"describe\""));
    let refused = knock(
        port,
        &format!("Authorization: Bearer {TOKEN}\r\nOrigin: http://evil.example\r\n"),
    );
    assert!(refused.starts_with("HTTP/1.1 403"), "{refused}");
}

#[test]
fn the_command_line_puts_the_prompt_before_the_flags_that_take_many_words() {
    let line = launch::command();
    assert!(line.starts_with("claude \"Read .totex/overseer/prompt.md and follow it.\" --mcp-config .totex/overseer/mcp.json"));
    assert!(line.ends_with('\r'));
    assert!(!line.contains('\''));
    assert!(!line.contains('\\'));
}

#[test]
fn the_files_are_written_and_written_over() {
    let unique = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_nanos())
        .unwrap_or_default();
    let cwd = std::env::temp_dir().join(format!("totex-overseer-{}-{unique}", std::process::id()));
    std::fs::create_dir_all(&cwd).expect("a folder");
    let path = cwd.to_string_lossy().into_owned();

    launch::write(&path, 26375, TOKEN).expect("written");
    launch::write(&path, 40000, "another").expect("written again");

    let dir = cwd.join(".totex").join("overseer");
    let config: Value =
        serde_json::from_str(&std::fs::read_to_string(dir.join("mcp.json")).expect("the config"))
            .expect("json");
    let server = &config["mcpServers"]["totex-overseer"];
    assert_eq!(server["type"], "http");
    assert_eq!(server["url"], "http://127.0.0.1:40000/mcp");
    assert_eq!(server["headers"]["Authorization"], "Bearer another");
    assert_eq!(
        std::fs::read_to_string(dir.join("prompt.md")).expect("the prompt"),
        launch::PROMPT
    );
    assert_eq!(
        std::fs::read_to_string(dir.join(".gitignore")).expect("the ignore"),
        "*\n"
    );
    let _ = std::fs::remove_dir_all(&cwd);
}
