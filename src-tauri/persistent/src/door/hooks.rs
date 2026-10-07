//! Claude's official HTTP hooks. Bodies are associated with terminals only by
//! a live PID + session UUID reported by `claude agents --json`.
use super::Door;
use crate::monitor::{Reply, ReplyStatus};
use serde_json::{Value, json};
use std::collections::HashMap;
use std::path::Path;
use std::time::{Duration, Instant};
use totex_host::sync::lock;

#[derive(Default)]
pub(crate) struct Hooks {
    next: u64,
    token: Option<String>,
    sessions: HashMap<String, (Instant, Reply)>,
}

impl Hooks {
    pub(crate) fn receive(&mut self, body: &Value) -> bool {
        let Some(session) = body["session_id"]
            .as_str()
            .filter(|s| !s.is_empty() && s.len() <= 128)
        else {
            return false;
        };
        let event = body["hook_event_name"].as_str().unwrap_or("");
        let status = match event {
            "UserPromptSubmit" => ReplyStatus::InProgress,
            "Stop" => ReplyStatus::Completed,
            "StopFailure" => ReplyStatus::Failed,
            _ => return false,
        };
        let text = if status == ReplyStatus::InProgress {
            ""
        } else {
            match body["last_assistant_message"].as_str() {
                Some(text) => text,
                None if status == ReplyStatus::Failed => body["error"].as_str().unwrap_or(""),
                None => return false,
            }
        };
        self.sessions
            .retain(|_, (seen, _)| seen.elapsed() < Duration::from_secs(3600));
        if event == "UserPromptSubmit" || !self.sessions.contains_key(session) {
            if self.sessions.len() >= 128
                && let Some(oldest) = self
                    .sessions
                    .iter()
                    .min_by_key(|(_, (seen, _))| *seen)
                    .map(|(id, _)| id.clone())
            {
                self.sessions.remove(&oldest);
            }
            self.next += 1;
            self.sessions.insert(
                session.into(),
                (
                    Instant::now(),
                    Reply::new(
                        "claude",
                        session,
                        &format!("{session}:{}", self.next),
                        status,
                        text,
                    ),
                ),
            );
        } else if let Some((seen, reply)) = self.sessions.get_mut(session) {
            *seen = Instant::now();
            *reply = Reply::new("claude", session, &reply.turn_id, status, text);
        }
        true
    }
}

impl Door {
    pub(crate) fn hook_token(&self) -> String {
        lock(&self.hooks)
            .token
            .clone()
            .unwrap_or_else(|| super::address::token(&self.keys, "claude-reply-hooks"))
    }
    pub(crate) fn claude_reply(&self, session: &str) -> Option<Reply> {
        lock(&self.hooks)
            .sessions
            .get(session)
            .map(|(_, reply)| reply.clone())
    }
    pub(crate) fn load_hook_token(&self, home: &Path) {
        let path = home.join("claude-reply-token");
        let token = std::fs::read_to_string(&path)
            .ok()
            .filter(|s| !s.is_empty());
        lock(&self.hooks).token = token;
    }
    /// Write only our plugin; Claude's own CLI installs it into its configuration.
    pub(crate) fn install_reply_hooks(
        self: &std::sync::Arc<Self>,
        home: &Path,
    ) -> Result<String, String> {
        let port = self.serve()?;
        let token = self.hook_token();
        let credential = home.join("claude-reply-token");
        std::fs::write(&credential, &token).map_err(|e| e.to_string())?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&credential, std::fs::Permissions::from_mode(0o600))
                .map_err(|e| e.to_string())?;
        }
        lock(&self.hooks).token = Some(token.clone());
        let root = home.join("claude-replies");
        let plugin = root.join("plugin");
        std::fs::create_dir_all(&root).map_err(|e| e.to_string())?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&root, std::fs::Permissions::from_mode(0o700))
                .map_err(|e| e.to_string())?;
        }
        std::fs::create_dir_all(root.join(".claude-plugin")).map_err(|e| e.to_string())?;
        std::fs::create_dir_all(plugin.join(".claude-plugin")).map_err(|e| e.to_string())?;
        std::fs::create_dir_all(plugin.join("hooks")).map_err(|e| e.to_string())?;
        let version = format!(
            "0.1.{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis()
        );
        let manifest = json!({"name":"totex-replies","version":version,"description":"Send reply lifecycle events to totex over HTTP"});
        let marketplace = json!({"name":"totex-local","owner":{"name":"totex"},"plugins":[{"name":"totex-replies","source":"./plugin","version":version}]});
        let hooks = hook_config(port, &token);
        let installed = root.join("installed.json");
        if std::fs::read(&installed)
            .ok()
            .and_then(|v| serde_json::from_slice::<Value>(&v).ok())
            .as_ref()
            == Some(&hooks)
        {
            return Ok("Claude reply hooks configured".into());
        }
        for (path, value) in [
            (root.join(".claude-plugin/marketplace.json"), marketplace),
            (plugin.join(".claude-plugin/plugin.json"), manifest),
            (plugin.join("hooks/hooks.json"), hooks.clone()),
        ] {
            std::fs::write(
                path,
                serde_json::to_vec_pretty(&value).map_err(|e| e.to_string())?,
            )
            .map_err(|e| e.to_string())?;
        }
        let env = ["HOME", "CLAUDE_CONFIG_DIR"]
            .into_iter()
            .filter_map(|key| std::env::var(key).ok().map(|v| (key.into(), v)))
            .collect();
        let source = root.to_str().ok_or("Invalid plugin path")?;
        crate::monitor::command_json_timeout(
            "claude",
            &[
                "plugin",
                "install",
                "totex-replies",
                "--marketplace",
                source,
                "--scope",
                "user",
                "--json",
            ],
            &env,
            Duration::from_secs(30),
        )?;
        // Refresh an already-installed plugin too: port and token belong to this runtime.
        crate::monitor::command_json_timeout(
            "claude",
            &["plugin", "update", "totex-replies@totex-local", "--json"],
            &env,
            Duration::from_secs(30),
        )?;
        std::fs::write(
            installed,
            serde_json::to_vec(&hooks).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
        Ok("Claude reply hooks installed. Restart existing Claude sessions to load them.".into())
    }
}

fn hook_config(port: u16, token: &str) -> Value {
    let hook = json!({"type":"http","url":format!("http://127.0.0.1:{port}/hooks/claude"),
        "headers":{"Authorization":format!("Bearer {token}")},"timeout":5});
    json!({"hooks":{
        "UserPromptSubmit":[{"hooks":[hook.clone()]}],
        "Stop":[{"hooks":[hook.clone()]}],
        "StopFailure":[{"hooks":[hook]}]
    }})
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn hook_lifecycle_keeps_full_body_and_deduplicates_stops() {
        let mut hooks = Hooks::default();
        assert!(hooks.receive(&json!({"hook_event_name":"UserPromptSubmit","session_id":"s"})));
        let first = hooks.sessions["s"].1.clone();
        assert_eq!(first.status, ReplyStatus::InProgress);
        let stop = json!({"hook_event_name":"Stop","session_id":"s","last_assistant_message":"完了\n本文\n```code```"});
        assert!(hooks.receive(&stop));
        let reply = hooks.sessions["s"].1.clone();
        assert_eq!(reply.status, ReplyStatus::Completed);
        assert_eq!(reply.text, "完了\n本文\n```code```");
        assert_eq!(reply.turn_id, first.turn_id);
        assert_ne!(reply.key, first.key);
        hooks.receive(&stop);
        assert_eq!(reply, hooks.sessions["s"].1);
        hooks.receive(&json!({"hook_event_name":"UserPromptSubmit","session_id":"s"}));
        assert_eq!(hooks.sessions["s"].1.text, "");
        assert_ne!(hooks.sessions["s"].1.turn_id, reply.turn_id);
        hooks.receive(&json!({"hook_event_name":"StopFailure","session_id":"s","last_assistant_message":"API error"}));
        assert_eq!(hooks.sessions["s"].1.status, ReplyStatus::Failed);
        assert!(!hooks.receive(&json!({"hook_event_name":"SubagentStop","session_id":"s"})));
    }

    #[test]
    fn http_hook_requires_authentication_and_refuses_browser_and_malformed_events() {
        use super::super::http::{Request, route};
        let sessions = std::sync::Arc::new(crate::Sessions::default());
        let door = Door::new(sessions);
        let mut request = Request {
            method: "POST".into(),
            target: "/hooks/claude".into(),
            bearer: None,
            from_page: false,
            body:
                json!({"hook_event_name":"Stop","session_id":"s","last_assistant_message":"reply"})
                    .to_string()
                    .into_bytes(),
        };
        assert_eq!(route(&door, &request).0, "401 Unauthorized");
        request.bearer = Some(door.hook_token());
        assert_eq!(route(&door, &request).0, "200 OK");
        assert_eq!(door.claude_reply("s").unwrap().text, "reply");
        assert!(door.claude_reply("unrelated").is_none());
        request.from_page = true;
        assert_eq!(route(&door, &request).0, "403 Forbidden");
        request.from_page = false;
        request.body = b"not json".to_vec();
        assert_eq!(route(&door, &request).0, "400 Bad Request");
    }
}
