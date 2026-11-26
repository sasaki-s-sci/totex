//! Shared-daemon requests retain terminal identity without environment credentials.

use serde_json::{Value, json};
use std::time::{Duration, Instant};
use totex_host::sync::lock;

use super::{addressed, held, knock, post, session};
use crate::door::Door;
use crate::door::http::{Request, route};

const FIRST: &str = "550e8400-e29b-41d4-a716-446655440000";
const SECOND: &str = "650e8400-e29b-41d4-a716-446655440000";

fn endpoint(door: &Door) -> String {
    format!(
        "http://127.0.0.1:{}/mcp/{}",
        door.serving().unwrap(),
        lock(&door.credential).as_deref().unwrap()
    )
}

fn call(thread: &str, root: &str, arguments: Value) -> Value {
    json!({"jsonrpc":"2.0", "id":1, "method":"tools/call", "params":{
        "name":"canvas", "arguments":arguments,
        "_meta":{"threadId":thread,"sessionId":root}
    }})
}

#[test]
fn registration_connects_before_any_terminal_exists_and_survives_restart() {
    let held = held();
    held.door.serve().unwrap();
    let url = endpoint(&held.door);
    let (_, hello) = post(&url, &json!({"jsonrpc":"2.0","id":1,"method":"initialize"}));
    assert_eq!(hello["result"]["serverInfo"]["name"], "totex");
    let (_, listed) = post(&url, &json!({"jsonrpc":"2.0","id":2,"method":"tools/list"}));
    assert_eq!(listed["result"]["tools"][0]["name"], "canvas");
    let (_, unbound) = post(&url, &call(FIRST, FIRST, json!({})));
    assert_eq!(unbound["result"]["isError"], true);
    assert_eq!(
        post(&format!("{url}wrong"), &json!({})).0,
        "HTTP/1.1 404 Not Found"
    );
    held.door.unserve();
    held.door.serve().unwrap();
    assert_eq!(endpoint(&held.door), url);
    assert_eq!(
        post(&url, &json!({"jsonrpc":"2.0","id":3,"method":"ping"})).0,
        "HTTP/1.1 200 OK"
    );
    held.door.unserve();
}

#[cfg(unix)]
#[test]
fn inherited_credentials_cannot_redirect_canvas_calls() {
    let held = held();
    let (folder, inherited) = session(&held, "daemon-origin");
    let cwd = folder.path().display().to_string();
    held.door.open_canvas("other-canvas", &cwd).unwrap();
    let third = "750e8400-e29b-41d4-a716-446655440000";
    for (terminal, thread) in [("other-one", SECOND), ("other-two", third)] {
        held.sessions
            .open(
                terminal,
                &cwd,
                24,
                80,
                Some(json!({"canvas":"other-canvas"}).to_string()),
            )
            .unwrap();
        lock(&held.door.bindings).observe(terminal, &format!("\x1b]2;{thread}\x07"));
    }
    lock(&held.door.bindings).observe("daemon-origin", &format!("\x1b]2;{FIRST}\x07"));
    let shared = endpoint(&held.door);
    let (host, token) = inherited.rsplit_once("/s/").unwrap();
    for arguments in [json!({}), json!({"panes":[{"id":"wrong","kind":"empty"}]})] {
        for meta in [
            Value::Null,
            json!({}),
            json!({"threadId":SECOND,"sessionId":FIRST}),
        ] {
            let mut request = call(SECOND, FIRST, arguments.clone());
            request["params"]["_meta"] = meta;
            for (url, bearer) in [(&inherited, None), (&format!("{host}/mcp"), Some(token))] {
                let (_, rejected) = knock(url, &request, bearer);
                assert_eq!(rejected["result"]["isError"], true, "{rejected}");
            }
        }
    }
    assert!(held.door.canvas("daemon-origin").panes.is_empty());
    assert!(held.door.canvas("other-canvas").panes.is_empty());
    let (_, written) = post(
        &shared,
        &call(
            SECOND,
            FIRST,
            json!({"revision":0,"panes":[{"id":"evidence","kind":"empty"}]}),
        ),
    );
    assert_eq!(written["result"]["structuredContent"]["id"], "other-canvas");
    let (_, read) = post(&shared, &call(third, FIRST, json!({})));
    assert_eq!(
        read["result"]["structuredContent"],
        written["result"]["structuredContent"]
    );
    let (_, stale) = post(
        &shared,
        &call(third, FIRST, json!({"revision":0,"panes":[]})),
    );
    assert_eq!(stale["result"]["isError"], true);
    assert!(held.door.canvas("daemon-origin").panes.is_empty());
    for terminal in ["daemon-origin", "other-one", "other-two"] {
        held.sessions.close(terminal);
    }
    held.door.unserve();
}

#[cfg(unix)]
#[test]
fn shell_titles_route_concurrent_codex_threads_in_the_same_folder() {
    let held = held();
    let (workspace, _) = session(&held, "one");
    held.sessions
        .open("two", &workspace.path().display().to_string(), 24, 80, None)
        .unwrap();
    for (terminal, thread) in [("one", FIRST), ("two", SECOND)] {
        // Exercise the real PTY output follower, including Codex's shortened title.
        held.sessions
            .write(
                terminal,
                &format!("printf '\\033]2;{}... | Codex\\007'\n", &thread[..29]),
            )
            .unwrap();
        let deadline = Instant::now() + Duration::from_secs(5);
        while held.door.terminal(&json!({"threadId":thread})).is_err() {
            assert!(Instant::now() < deadline, "terminal title was not observed");
            std::thread::sleep(Duration::from_millis(10));
        }
    }
    let url = endpoint(&held.door);
    for (thread, text) in [(FIRST, "first evidence"), (SECOND, "second evidence")] {
        let (_, written) = post(
            &url,
            &call(
                thread,
                thread,
                json!({
                    "revision":0, "panes":[{"id":"evidence", "kind":"markdown", "text":text}]
                }),
            ),
        );
        assert!(written["result"]["isError"].is_null(), "{written}");
    }
    let (_, first) = post(&url, &call(FIRST, FIRST, json!({})));
    let (_, second) = post(&url, &call(SECOND, SECOND, json!({})));
    assert_eq!(first["result"]["structuredContent"]["id"], "one");
    assert_eq!(
        first["result"]["structuredContent"]["panes"][0]["text"],
        "first evidence"
    );
    assert_eq!(second["result"]["structuredContent"]["id"], "two");
    assert_eq!(
        second["result"]["structuredContent"]["panes"][0]["text"],
        "second evidence"
    );
    let (_, child) = post(
        &url,
        &call("750e8400-e29b-41d4-a716-446655440000", FIRST, json!({})),
    );
    assert_eq!(child["result"]["structuredContent"]["id"], "one");

    std::fs::write(
        workspace.path().join(".totex/settings.json"),
        r#"{"mcp":false}"#,
    )
    .unwrap();
    let (_, still_enabled) = post(&url, &call(FIRST, FIRST, json!({})));
    assert_eq!(
        still_enabled["result"]["structuredContent"],
        first["result"]["structuredContent"]
    );
    held.sessions.close("one");
    held.sessions.close("two");
    let (_, ended) = post(&url, &call(SECOND, SECOND, json!({})));
    assert_eq!(ended["result"]["isError"], true);
    held.door.unserve();
}

#[cfg(unix)]
#[test]
fn one_switch_controls_every_folder_and_legacy_address() {
    let held = held();
    let (first_folder, first_url) = session(&held, "first-folder");
    let (second_folder, second_url) = session(&held, "second-folder");
    let shared = endpoint(&held.door);
    let terminals = [
        ("first-folder", FIRST, first_folder.path(), first_url),
        ("second-folder", SECOND, second_folder.path(), second_url),
    ];

    for (id, thread, folder, own) in &terminals {
        std::fs::write(folder.join(".totex/settings.json"), r#"{"mcp":false}"#).unwrap();
        assert_eq!(
            addressed(&held.door, id, &folder.display().to_string()).as_ref(),
            Some(own)
        );
        lock(&held.door.bindings).observe(id, &format!("\x1b]2;{thread}\x07"));
        let (_, written) = post(
            &shared,
            &call(
                thread,
                thread,
                json!({
                    "revision":0,"panes":[{"id":"evidence","kind":"markdown","text":id}]
                }),
            ),
        );
        assert!(written["result"]["isError"].is_null(), "{written}");
        let (_, read) = post(own, &call(thread, thread, json!({})));
        assert_eq!(
            read["result"]["structuredContent"],
            written["result"]["structuredContent"]
        );
        assert_eq!(read["result"]["structuredContent"]["id"], *id);
    }

    held.door.unserve();
    for (id, thread, folder, own) in &terminals {
        assert!(addressed(&held.door, id, &folder.display().to_string()).is_none());
        for url in [&shared, own] {
            let request = Request {
                method: "POST".into(),
                target: format!(
                    "/{}",
                    url.strip_prefix("http://")
                        .unwrap()
                        .split_once('/')
                        .unwrap()
                        .1
                ),
                bearer: None,
                from_page: false,
                local_host: true,
                body: call(thread, thread, json!({})).to_string().into_bytes(),
            };
            assert_eq!(route(&held.door, &request).0, "404 Not Found");
        }
    }

    held.door.serve().unwrap();
    assert_eq!(endpoint(&held.door), shared);
    for (id, thread, _, own) in &terminals {
        for url in [&shared, own] {
            let (_, read) = post(url, &call(thread, thread, json!({})));
            assert_eq!(read["result"]["structuredContent"]["id"], *id);
        }
        held.sessions.close(id);
    }
    held.door.unserve();
}
