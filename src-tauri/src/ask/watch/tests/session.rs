//! The road between a running shell and the window: the pty, the seam its
//! output comes over, the screen it is followed into, and the event that says
//! what the session has turned to doing.

#![cfg(unix)]

use std::sync::mpsc;

use tauri::Listener;

use super::super::{DOING_EVENT, pty_doing, rederive};
use super::{answering, mock_app};
use crate::pty;

/// Nothing about a session is the window's to remember: what is running is only
/// ever true where the processes are.
#[test]
fn what_is_running_is_asked_for_rather_than_remembered() {
    let app = mock_app();
    let handle = app.handle().clone();
    let id = "found".to_string();
    let cwd = std::env::temp_dir().display().to_string();

    pty::pty_open(
        handle.clone(),
        id.clone(),
        cwd.clone(),
        24,
        80,
        Some("{\"branch\":\"main\"}".to_string()),
    )
    .expect("the shell starts");

    let running = pty::running(&handle);
    let found = running
        .iter()
        .find(|session| session.id == id)
        .expect("the session is running");
    assert_eq!(found.cwd, cwd);
    assert_eq!(found.meta.as_deref(), Some("{\"branch\":\"main\"}"));

    pty::pty_close(handle.clone(), id.clone()).expect("the terminal closes");
}

/// The one reading the backlog cannot give back: an agent that has said more
/// than the backlog holds is still an agent after the screens are rebuilt.
#[test]
fn an_agent_is_still_one_after_its_backlog_has_lost_its_head() {
    let id = "long-running".to_string();
    let app = mock_app();
    let handle = app.handle().clone();
    answering(&handle, &id);
    let (tx, rx) = mpsc::channel();
    handle.listen(DOING_EVENT, move |event| {
        let _ = tx.send(event.payload().to_string());
    });
    pty::pty_open(
        handle.clone(),
        id.clone(),
        std::env::temp_dir().display().to_string(),
        24,
        80,
        None,
    )
    .expect("the shell starts");

    // Something that takes the terminal the way an agent does, says far more
    // than a backlog keeps, and then stands working.
    let agent = "claude() { printf '\\033[?1004h'; head -c 600000 /dev/zero | tr '\\0' x | fold -w 70; \
                 printf 'esc to interrupt\\n'; sleep 30; }\n";
    pty::pty_write(handle.clone(), id.clone(), agent.to_string()).expect("the shell takes input");
    pty::pty_write(handle.clone(), id.clone(), "claude\n".to_string())
        .expect("the shell takes input");

    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(30);
    let mut working = false;
    while !working && std::time::Instant::now() < deadline {
        if let Ok(payload) = rx.recv_timeout(std::time::Duration::from_millis(250)) {
            working = payload.contains("\"working\"");
        }
    }
    if !working {
        pty::pty_close(handle.clone(), id.clone()).expect("the terminal closes");
        panic!("the window was never told the agent was working");
    }

    // The window is told as the output is read, which can be a moment before
    // the backlog holds the same line: read again until it does.
    let mut doing = serde_json::Value::Null;
    while std::time::Instant::now() < deadline {
        rederive(&handle);
        doing = serde_json::to_value(pty_doing(handle.clone())).expect("a list");
        if doing[0]["doing"] == "working" {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(100));
    }
    pty::pty_close(handle.clone(), id.clone()).expect("the terminal closes");
    assert_eq!(doing[0]["doing"], "working", "{doing}");
}
