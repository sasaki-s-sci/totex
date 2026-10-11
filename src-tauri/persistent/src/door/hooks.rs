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
        let token = self.keep_hook_token(home)?;
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
        let [marketplace, manifest, hooks] = plugin_files(http_hook(port, &token));
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

    /// The same plugin, installed into a WSL distribution's own Claude Code.
    ///
    /// The files are written inside the distribution rather than on the
    /// Windows side: a marketplace on `/mnt/c` would tie the distribution's
    /// configuration to a path that only means something while the drive is
    /// mounted the same way. The hooks reach this runtime's loopback through
    /// Windows' own curl, see `windows_curl`, which works whatever networking
    /// the distribution has. Every start reinstalls,
    /// because the record of what was installed would otherwise have to live
    /// in a place this side cannot cheaply read.
    pub(crate) fn install_reply_hooks_wsl(
        self: &std::sync::Arc<Self>,
        home: &Path,
        distro: &str,
    ) -> Result<String, String> {
        let port = self.serve()?;
        let token = self.keep_hook_token(home)?;
        let curl = totex_host::wsl::windows_curl(distro)?;
        let [marketplace, manifest, hooks] = plugin_files(curl_hook(&curl, port, &token));
        let mut contents = Vec::new();
        for value in [marketplace, manifest, hooks] {
            contents.push(serde_json::to_string_pretty(&value).map_err(|e| e.to_string())?);
        }
        let args: Vec<&str> = contents.iter().map(String::as_str).collect();
        let output = totex_host::wsl::script(distro, None, WSL_INSTALL, &args)
            .map_err(|error| format!("{distro}: {error}"))?;
        if !output.ok() {
            let message = String::from_utf8_lossy(&output.stderr).trim().to_string();
            return Err(format!(
                "{distro}: {}",
                if message.is_empty() {
                    "Could not install Claude reply hooks"
                } else {
                    &message
                }
            ));
        }
        Ok(format!(
            "Claude reply hooks installed in {distro}. Restart existing Claude sessions to load them."
        ))
    }

    /// The hook credential, kept in this runtime's home so a relaunched
    /// runtime accepts the hooks an earlier one installed.
    fn keep_hook_token(&self, home: &Path) -> Result<String, String> {
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
        Ok(token)
    }
}

/// Writes the plugin given as `$1` (marketplace), `$2` (manifest) and `$3`
/// (hooks) under the distribution's own data directory and has its Claude
/// Code install it. Run through a login shell, which is where a user's PATH to
/// `claude` is set up; the contents arrive as arguments and are never part of
/// the script text.
const WSL_INSTALL: &str = r#"
exec bash -lc '
command -v claude >/dev/null || { echo "Claude Code was not found in the WSL login PATH." >&2; exit 1; }
test -n "$HOME" && test "${HOME#/}" != "$HOME" || exit 1
dir="$HOME/.local/share/totex/claude-replies"
umask 077
mkdir -p -- "$dir/.claude-plugin" "$dir/plugin/.claude-plugin" "$dir/plugin/hooks" && chmod 700 -- "$dir" || exit 1
printf "%s" "$1" > "$dir/.claude-plugin/marketplace.json" || exit 1
printf "%s" "$2" > "$dir/plugin/.claude-plugin/plugin.json" || exit 1
printf "%s" "$3" > "$dir/plugin/hooks/hooks.json" || exit 1
claude plugin install totex-replies --marketplace "$dir" --scope user --json >/dev/null || exit 1
claude plugin update totex-replies@totex-local --json >/dev/null
' totex "$@"
"#;

/// The marketplace, the plugin manifest and its hooks, in that order. The
/// version changes on every install so Claude's CLI picks up a new port or
/// token even when the plugin is already installed.
fn plugin_files(hook: Value) -> [Value; 3] {
    let version = format!(
        "0.1.{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis()
    );
    [
        json!({"name":"totex-local","owner":{"name":"totex"},"plugins":[{"name":"totex-replies","source":"./plugin","version":version}]}),
        json!({"name":"totex-replies","version":version,"description":"Send reply lifecycle events to totex over HTTP"}),
        hook_config(hook),
    ]
}

fn http_hook(port: u16, token: &str) -> Value {
    json!({"type":"http","url":format!("http://127.0.0.1:{port}/hooks/claude"),
        "headers":{"Authorization":format!("Bearer {token}")},"timeout":5})
}

/// The same request, made by the Windows `curl` at `curl` with the hook's
/// input as the body.
fn curl_hook(curl: &str, port: u16, token: &str) -> Value {
    let command = format!(
        "{} -s -m 5 -H {} -H {} --data-binary @- {} >/dev/null",
        quote(curl),
        quote(&format!("Authorization: Bearer {token}")),
        quote("Content-Type: application/json"),
        quote(&format!("http://127.0.0.1:{port}/hooks/claude")),
    );
    json!({"type":"command","command":command,"timeout":10})
}

/// One shell word, whatever is in it.
fn quote(word: &str) -> String {
    format!("'{}'", word.replace('\'', "'\\''"))
}

fn hook_config(hook: Value) -> Value {
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
    fn plugin_files_agree_on_version_and_point_hooks_at_this_door() {
        let [marketplace, manifest, hooks] = plugin_files(http_hook(4242, "secret"));
        assert_eq!(marketplace["plugins"][0]["version"], manifest["version"]);
        assert_eq!(marketplace["plugins"][0]["name"], manifest["name"]);
        let hook = &hooks["hooks"]["Stop"][0]["hooks"][0];
        assert_eq!(hook["url"], "http://127.0.0.1:4242/hooks/claude");
        assert_eq!(hook["headers"]["Authorization"], "Bearer secret");
    }

    /// The command a distribution runs posts its input to the same door, with
    /// every word quoted for the shell it runs in.
    #[cfg(unix)]
    #[test]
    fn curl_hook_posts_its_input_to_this_door() {
        let hook = curl_hook("/mnt/c/it's/curl.exe", 4242, "secret");
        let command = hook["command"].as_str().unwrap();
        let said = std::process::Command::new("sh")
            .args([
                "-c",
                &format!(
                    "set -- {}; printf '%s\\n' \"$@\"",
                    command.trim_end_matches(" >/dev/null")
                ),
            ])
            .output()
            .unwrap();
        assert_eq!(
            String::from_utf8(said.stdout).unwrap(),
            "/mnt/c/it's/curl.exe\n-s\n-m\n5\n-H\nAuthorization: Bearer secret\n-H\nContent-Type: application/json\n--data-binary\n@-\nhttp://127.0.0.1:4242/hooks/claude\n"
        );
    }

    /// The distribution's half, run against a stand-in `claude` on this
    /// machine: the files land where the marketplace is installed from, with
    /// contents taken verbatim from the arguments.
    #[cfg(unix)]
    #[test]
    fn wsl_install_script_writes_arguments_verbatim_and_installs_from_them() {
        use std::os::unix::fs::PermissionsExt;
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root =
            std::env::temp_dir().join(format!("totex-wsl-hooks-{}-{unique}", std::process::id()));
        let bin = root.join("bin");
        std::fs::create_dir_all(&bin).unwrap();
        let log = root.join("calls");
        let fake = bin.join("claude");
        std::fs::write(
            &fake,
            format!("#!/bin/sh\necho \"$*\" >> '{}'\n", log.display()),
        )
        .unwrap();
        std::fs::set_permissions(&fake, std::fs::Permissions::from_mode(0o755)).unwrap();
        let quoted = "it's \"$(not run)\" `nor this`";
        let output = std::process::Command::new("sh")
            .args(["-c", WSL_INSTALL, "totex", "{\"m\":1}", "{\"p\":2}", quoted])
            .env("HOME", &root)
            .env(
                "PATH",
                format!("{}:{}", bin.display(), std::env::var("PATH").unwrap()),
            )
            .output()
            .unwrap();
        let dir = root.join(".local/share/totex/claude-replies");
        let read = |path: &str| std::fs::read_to_string(dir.join(path)).unwrap();
        let calls = std::fs::read_to_string(&log).unwrap_or_default();
        let mode = std::fs::metadata(&dir).map(|m| m.permissions().mode() & 0o777);
        let hooks = read("plugin/hooks/hooks.json");
        let marketplace = read(".claude-plugin/marketplace.json");
        let manifest = read("plugin/.claude-plugin/plugin.json");
        std::fs::remove_dir_all(&root).unwrap();
        assert!(output.status.success(), "{output:?}");
        assert_eq!(marketplace, "{\"m\":1}");
        assert_eq!(manifest, "{\"p\":2}");
        assert_eq!(hooks, quoted);
        assert_eq!(mode.unwrap(), 0o700);
        assert_eq!(
            calls,
            format!(
                "plugin install totex-replies --marketplace {} --scope user --json\nplugin update totex-replies@totex-local --json\n",
                dir.display()
            )
        );
    }

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
