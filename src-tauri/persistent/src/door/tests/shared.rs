//! Shared-daemon requests retain terminal identity without environment credentials.

use serde_json::{Value, json};
use std::time::{Duration, Instant};
use totex_host::sync::lock;

use super::{held, post, session};
use crate::door::Door;

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
    let (_, disabled) = post(&url, &call(FIRST, FIRST, json!({})));
    assert_eq!(disabled["result"]["isError"], true);
    held.sessions.close("one");
    held.sessions.close("two");
    let (_, ended) = post(&url, &call(SECOND, SECOND, json!({})));
    assert_eq!(ended["result"]["isError"], true);
    held.door.unserve();
}
