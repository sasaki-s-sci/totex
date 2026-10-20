//! Observers driven through an agent's own non-interactive CLI: Claude Code
//! (`claude -p`) and Codex (`codex exec`). Each run gets the prompt on stdin,
//! no tools, no user configuration and no saved session.
use std::process::Stdio;

use serde_json::{Map, Value, json};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use totex_host::host::Host;

use super::{
    Model, browser,
    launch::{Workspace, failure, run, trimmed_tail},
    prompt::final_report,
};

pub(super) async fn claude(
    program: &str,
    model: &str,
    host: &Host,
    environment: &str,
    prompt: &str,
    schema: &Value,
    browser: Option<&browser::Setup>,
) -> Result<Map<String, Value>, String> {
    let files: Vec<(&str, &str)> = browser
        .map(|setup| ("browser.json", setup.config.as_str()))
        .into_iter()
        .collect();
    let workspace = Workspace::prepare(host, environment, program, &files).await?;
    let schema = schema.to_string();
    let mut argv = vec![program, "-p"];
    if !model.is_empty() {
        argv.extend(["--model", model]);
    }
    if browser.is_some() {
        argv.extend(["--mcp-config", "browser.json", "--allowedTools"]);
        argv.extend(browser::TOOLS);
    }
    argv.extend([
        "--tools",
        "",
        "--strict-mcp-config",
        "--setting-sources",
        "",
        "--no-session-persistence",
        "--output-format",
        "json",
        "--json-schema",
        &schema,
    ]);
    let output = run(workspace.command(&argv), prompt).await?;
    let result = claude_result(&output.stdout);
    if let Some(result) = &result
        && result["is_error"] == true
    {
        return Err(match result["result"].as_str() {
            Some(text) if !text.trim().is_empty() => trimmed_tail(text, 600),
            _ => format!("{program} reported an error"),
        });
    }
    if !output.status.success() {
        return Err(failure(&output, program));
    }
    let result = result.ok_or("Monitor returned no structured report")?;
    claude_report(&result)
}

/// The result object of `claude -p --output-format json`; a stream of events
/// (as `--verbose` prints) ends with it too.
fn claude_result(stdout: &str) -> Option<Value> {
    match serde_json::from_str::<Value>(stdout.trim()).ok()? {
        Value::Array(events) => events
            .into_iter()
            .rev()
            .find(|event| event["type"] == "result"),
        object @ Value::Object(_) => Some(object),
        _ => None,
    }
}

fn claude_report(result: &Value) -> Result<Map<String, Value>, String> {
    if let Some(Value::Object(report)) = result.get("structured_output") {
        return Ok(report.clone());
    }
    final_report(result["result"].as_str().unwrap_or_default())
}

pub(super) async fn codex(
    program: &str,
    model: &str,
    host: &Host,
    environment: &str,
    prompt: &str,
    schema: &Value,
) -> Result<Map<String, Value>, String> {
    let schema = schema.to_string();
    let workspace =
        Workspace::prepare(host, environment, program, &[("schema.json", &schema)]).await?;
    let mut argv = vec![program, "exec"];
    if !model.is_empty() {
        argv.extend(["-m", model]);
    }
    argv.extend([
        "--ephemeral",
        "--skip-git-repo-check",
        "--ignore-user-config",
        "-s",
        "read-only",
        "--color",
        "never",
        "--output-schema",
        "schema.json",
        "-",
    ]);
    let output = run(workspace.command(&argv), prompt).await?;
    if !output.status.success() {
        return Err(failure(&output, program));
    }
    final_report(&output.stdout)
}

/// Claude Code lists its models in the answer to the SDK's `initialize`
/// control request; no prompt is sent and no turn is started.
pub(super) async fn claude_models(
    program: &str,
    host: &Host,
    environment: &str,
) -> Result<Vec<Model>, String> {
    let workspace = Workspace::prepare(host, environment, program, &[]).await?;
    let mut command = tokio::process::Command::from(workspace.command(&[
        program,
        "-p",
        "--input-format",
        "stream-json",
        "--output-format",
        "stream-json",
        "--verbose",
        "--setting-sources",
        "",
        "--strict-mcp-config",
        "--no-session-persistence",
    ]));
    command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    let mut child = command.spawn().map_err(|e| e.to_string())?;
    let mut stdin = child.stdin.take().ok_or("Agent stdin is unavailable")?;
    let stdout = child.stdout.take().ok_or("Agent stdout is unavailable")?;
    let mut stderr = child.stderr.take().ok_or("Agent stderr is unavailable")?;
    let request =
        json!({"type":"control_request","request_id":"1","request":{"subtype":"initialize"}});
    let _ = stdin.write_all(format!("{request}\n").as_bytes()).await;
    drop(stdin);
    // Read beside stdout so a chatty stderr cannot fill its pipe and stall.
    let errors = tokio::spawn(async move {
        let mut text = Vec::new();
        let _ = (&mut stderr).take(64_000).read_to_end(&mut text).await;
        String::from_utf8_lossy(&text).into_owned()
    });
    let mut lines = BufReader::new(stdout).lines();
    while let Some(line) = lines.next_line().await.map_err(|e| e.to_string())? {
        let Ok(message) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        if message["type"] == "control_response" {
            // The process is killed when `child` drops; it has nothing more to say.
            return parse_claude_models(&message);
        }
    }
    let status = child.wait().await.map_err(|e| e.to_string())?;
    let errors = errors.await.unwrap_or_default();
    Err(if errors.trim().is_empty() {
        format!("{program} exited with {status} before listing models")
    } else {
        trimmed_tail(&errors, 600)
    })
}

fn parse_claude_models(message: &Value) -> Result<Vec<Model>, String> {
    let response = &message["response"];
    if response["subtype"] == "error" {
        return Err(response["error"]
            .as_str()
            .unwrap_or("Claude Code refused to list models")
            .to_owned());
    }
    let models = response["response"]["models"]
        .as_array()
        .ok_or("Claude Code did not list any models")?;
    Ok(models
        .iter()
        .filter_map(|model| {
            let id = model["value"].as_str()?.to_owned();
            Some(Model {
                name: model["displayName"].as_str().unwrap_or(&id).to_owned(),
                description: model["description"].as_str().map(str::to_owned),
                id,
            })
        })
        .collect())
}

pub(super) async fn codex_models(
    program: &str,
    host: &Host,
    environment: &str,
) -> Result<Vec<Model>, String> {
    let workspace = Workspace::prepare(host, environment, program, &[]).await?;
    let output = run(workspace.command(&[program, "debug", "models"]), "").await?;
    if !output.status.success() {
        return Err(failure(&output, program));
    }
    parse_codex_models(&output.stdout)
}

fn parse_codex_models(stdout: &str) -> Result<Vec<Model>, String> {
    let listing: Value = serde_json::from_str(stdout.trim())
        .map_err(|e| format!("Unreadable Codex model list: {e}"))?;
    let models = listing["models"]
        .as_array()
        .ok_or("Codex did not list any models")?;
    Ok(models
        .iter()
        .filter(|model| model["visibility"] == "list")
        .filter_map(|model| {
            let id = model["slug"].as_str()?.to_owned();
            Some(Model {
                name: model["display_name"].as_str().unwrap_or(&id).to_owned(),
                description: model["description"].as_str().map(str::to_owned),
                id,
            })
        })
        .collect())
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::path::PathBuf;

    /// A folder holding one fake agent executable, which records its argv,
    /// stdin and working directory and prints the reply it was given.
    struct Fake(PathBuf);
    impl Fake {
        fn new(name: &str, script: &str) -> Self {
            use std::os::unix::fs::PermissionsExt;
            let directory = std::env::temp_dir().join(format!(
                "totex-monitor-fake-{name}-{}-{:?}",
                std::process::id(),
                std::thread::current().id()
            ));
            let _ = std::fs::remove_dir_all(&directory);
            std::fs::create_dir_all(&directory).unwrap();
            let program = directory.join(name);
            std::fs::write(
                &program,
                format!(
                    "#!/bin/sh\ndir={}\n{script}",
                    totex_host::remote::quote(&directory.to_string_lossy())
                ),
            )
            .unwrap();
            std::fs::set_permissions(&program, std::fs::Permissions::from_mode(0o755)).unwrap();
            Self(directory)
        }
        fn program(&self, name: &str) -> String {
            self.0.join(name).to_string_lossy().into_owned()
        }
        fn read(&self, name: &str) -> String {
            std::fs::read_to_string(self.0.join(name)).unwrap_or_default()
        }
    }
    impl Drop for Fake {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    const RECORD: &str =
        "printf '%s\\n' \"$@\" > \"$dir/argv\"\ncat > \"$dir/stdin\"\npwd > \"$dir/cwd\"\n";

    fn schema() -> Value {
        json!({"type":"object","properties":{"status":{"type":"string"}},"required":["status"],"additionalProperties":false})
    }

    #[tokio::test]
    async fn claude_runs_without_tools_or_settings_and_reads_structured_output() {
        let fake = Fake::new(
            "claude",
            &format!(
                "{RECORD}printf '%s' '{{\"type\":\"result\",\"is_error\":false,\"result\":\"\",\"structured_output\":{{\"status\":\"running\"}}}}'\n"
            ),
        );
        let report = claude(
            &fake.program("claude"),
            "sonnet",
            &Host::Local,
            "Local",
            "PROMPT 日本語",
            &schema(),
            None,
        )
        .await
        .unwrap();
        assert_eq!(Value::Object(report), json!({"status":"running"}));
        let argv: Vec<String> = fake.read("argv").lines().map(str::to_owned).collect();
        let schema = schema().to_string();
        let expected = [
            "-p",
            "--model",
            "sonnet",
            "--tools",
            "",
            "--strict-mcp-config",
            "--setting-sources",
            "",
            "--no-session-persistence",
            "--output-format",
            "json",
            "--json-schema",
            schema.as_str(),
        ];
        assert_eq!(argv, expected);
        assert_eq!(fake.read("stdin"), "PROMPT 日本語");
        assert!(fake.read("cwd").contains("/totex/monitor/"));
    }

    #[tokio::test]
    async fn claude_falls_back_to_the_result_text_and_reports_its_errors() {
        let fake = Fake::new(
            "claude",
            "cat >/dev/null\nprintf '%s' '{\"type\":\"result\",\"is_error\":false,\"result\":\"Done.\\n{\\\"status\\\":\\\"success\\\"}\"}'\n",
        );
        let report = claude(
            &fake.program("claude"),
            "",
            &Host::Local,
            "Local",
            "p",
            &schema(),
            None,
        )
        .await
        .unwrap();
        assert_eq!(Value::Object(report), json!({"status":"success"}));
        let failing = Fake::new(
            "claude",
            "cat >/dev/null\nprintf '%s' '{\"type\":\"result\",\"is_error\":true,\"result\":\"Not logged in\"}'\nexit 1\n",
        );
        let error = claude(
            &failing.program("claude"),
            "",
            &Host::Local,
            "Local",
            "p",
            &schema(),
            None,
        )
        .await
        .unwrap_err();
        assert_eq!(error, "Not logged in");
    }

    #[tokio::test]
    async fn codex_gets_the_schema_file_and_a_read_only_sandbox() {
        let fake = Fake::new(
            "codex",
            &format!(
                "{RECORD}cp schema.json \"$dir/schema\"\necho progress >&2\nprintf '%s\\n' '{{\"status\":\"stopped\"}}'\n"
            ),
        );
        let report = codex(
            &fake.program("codex"),
            "gpt-5",
            &Host::Local,
            "WSL · test",
            "PROMPT",
            &schema(),
        )
        .await
        .unwrap();
        assert_eq!(Value::Object(report), json!({"status":"stopped"}));
        let argv: Vec<String> = fake.read("argv").lines().map(str::to_owned).collect();
        assert_eq!(
            argv,
            [
                "exec",
                "-m",
                "gpt-5",
                "--ephemeral",
                "--skip-git-repo-check",
                "--ignore-user-config",
                "-s",
                "read-only",
                "--color",
                "never",
                "--output-schema",
                "schema.json",
                "-"
            ]
        );
        assert_eq!(fake.read("stdin"), "PROMPT");
        assert_eq!(fake.read("schema"), schema().to_string());
    }

    #[tokio::test]
    async fn a_failing_cli_reports_the_tail_of_its_stderr() {
        let fake = Fake::new(
            "codex",
            "cat >/dev/null\nhead -c 2000 /dev/zero | tr '\\0' x >&2\necho ' last words' >&2\nexit 3\n",
        );
        let error = codex(
            &fake.program("codex"),
            "",
            &Host::Local,
            "Local",
            "p",
            &schema(),
        )
        .await
        .unwrap_err();
        assert_eq!(error.chars().count(), 600);
        assert!(error.ends_with("x last words"));
    }

    #[tokio::test]
    async fn claude_models_come_from_the_initialize_control_response() {
        let fake = Fake::new(
            "claude",
            &format!(
                "{RECORD}echo '{{\"type\":\"system\"}}'\necho '{}'\nsleep 30\n",
                json!({"type":"control_response","response":{"subtype":"success","request_id":"1","response":{"models":[
                    {"value":"default","displayName":"Default","description":"Recommended"},
                    {"value":"opus","displayName":"Opus"}
                ]}}})
            ),
        );
        let started = std::time::Instant::now();
        let models = claude_models(&fake.program("claude"), &Host::Local, "Local")
            .await
            .unwrap();
        assert!(started.elapsed() < std::time::Duration::from_secs(20));
        assert_eq!(models.len(), 2);
        assert_eq!(
            (
                models[0].id.as_str(),
                models[0].name.as_str(),
                models[0].description.as_deref()
            ),
            ("default", "Default", Some("Recommended"))
        );
        assert_eq!(models[1].description, None);
        let stdin: Value = serde_json::from_str(fake.read("stdin").trim()).unwrap();
        assert_eq!(stdin["request"]["subtype"], "initialize");
        assert!(fake.read("argv").lines().any(|arg| arg == "stream-json"));
    }

    #[tokio::test]
    async fn codex_models_keep_listed_ones() {
        let fake = Fake::new(
            "codex",
            &format!(
                "printf '%s\\n' \"$@\" > \"$dir/argv\"\necho '{}'\n",
                json!({"models":[
                    {"slug":"gpt-5","display_name":"GPT-5","description":"Frontier","visibility":"list"},
                    {"slug":"hidden","display_name":"Hidden","description":null,"visibility":"hide"}
                ]})
            ),
        );
        let models = codex_models(&fake.program("codex"), &Host::Local, "Local")
            .await
            .unwrap();
        assert_eq!(models.len(), 1);
        assert_eq!(models[0].id, "gpt-5");
        assert_eq!(models[0].name, "GPT-5");
        assert_eq!(fake.read("argv"), "debug\nmodels\n");
    }

    #[test]
    fn model_listings_parse_errors_and_fallbacks() {
        assert_eq!(
            parse_claude_models(
                &json!({"type":"control_response","response":{"subtype":"error","error":"nope"}})
            )
            .unwrap_err(),
            "nope"
        );
        let models = parse_claude_models(
            &json!({"response":{"response":{"models":[{"value":"x"},{"displayName":"no id"}]}}}),
        )
        .unwrap();
        assert_eq!((models.len(), models[0].name.as_str()), (1, "x"));
        assert!(parse_codex_models("not json").is_err());
        assert!(parse_codex_models("{\"models\":[]}").unwrap().is_empty());
    }
}
