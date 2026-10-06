//! The normal PTY -> process ownership -> read-only CLI -> activity route.

use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::sync::{Arc, mpsc};
use std::time::{Duration, Instant};

use crate::Sessions;
use crate::monitor::{ActivityState, Monitor};

struct Fixture {
    sessions: Arc<Sessions>,
    home: std::path::PathBuf,
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::write(self.home.join("stop"), "");
        self.sessions.close("monitor-claude");
        let _ = fs::remove_dir_all(&self.home);
    }
}

#[test]
fn local_pty_is_monitored_without_hook_registration() {
    let unique = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let fixture = Fixture {
        sessions: Arc::new(Sessions::default()),
        home: std::env::temp_dir().join(format!(
            "totex-monitor-claude-{}-{unique}",
            std::process::id()
        )),
    };
    fs::create_dir(&fixture.home).unwrap();
    let claude = fixture.home.join("claude");
    fs::write(
        &claude,
        r#"#!/bin/sh
if [ "$1" = agents ] && [ "$2" = --json ]; then
  cat "$CLAUDE_CONFIG_DIR/sessions.json"
  exit 0
fi
printf '%s' "$$" > "$CLAUDE_CONFIG_DIR/pid"
printf '[{"pid":%s,"status":"busy","kind":"interactive"}]' "$$" > "$CLAUDE_CONFIG_DIR/sessions.json"
printf 'fixture focus\n'
while [ ! -f "$CLAUDE_CONFIG_DIR/stop" ]; do sleep 0.05; done
"#,
    )
    .unwrap();
    fs::set_permissions(&claude, fs::Permissions::from_mode(0o755)).unwrap();
    fixture
        .sessions
        .open(
            "monitor-claude",
            fixture.home.to_str().unwrap(),
            24,
            80,
            None,
        )
        .unwrap();
    let monitor = Monitor::new(Arc::clone(&fixture.sessions));
    let (tx, rx) = mpsc::channel();
    monitor.follow(Arc::new(move |activity| {
        if activity.id == "monitor-claude" {
            let _ = tx.send(activity.activity);
        }
    }));
    fixture
        .sessions
        .write(
            "monitor-claude",
            &format!(
                "CLAUDE_CONFIG_DIR='{}' '{}'\n",
                fixture.home.display(),
                claude.display()
            ),
        )
        .unwrap();
    let deadline = Instant::now() + Duration::from_secs(8);
    let wait_for = |expected| {
        loop {
            let state = rx
                .recv_timeout(deadline.saturating_duration_since(Instant::now()))
                .expect("automatic monitor did not publish the expected activity");
            if state == expected {
                break;
            }
        }
    };
    wait_for(Some(ActivityState::Working));
    let pid: u32 = fs::read_to_string(fixture.home.join("pid"))
        .unwrap()
        .parse()
        .unwrap();
    fs::write(
        fixture.home.join("next.json"),
        serde_json::json!([{"pid":pid,"status":"waiting","waitingFor":"permission prompt"}])
            .to_string(),
    )
    .unwrap();
    fs::rename(
        fixture.home.join("next.json"),
        fixture.home.join("sessions.json"),
    )
    .unwrap();
    wait_for(Some(ActivityState::Agent));
    fs::write(fixture.home.join("stop"), "").unwrap();
    wait_for(None);
    assert!(
        monitor
            .activities()
            .iter()
            .all(|activity| activity.id != "monitor-claude")
    );
}
