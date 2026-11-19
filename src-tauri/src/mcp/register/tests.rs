use super::*;
use std::sync::atomic::{AtomicU64, Ordering};

const URL: &str = "http://127.0.0.1:26374/mcp/test-credential";
static NEXT: AtomicU64 = AtomicU64::new(0);

struct Temp(PathBuf);
impl Temp {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!(
            "totex-register-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir_all(&path).unwrap();
        Self(path)
    }
}
impl Drop for Temp {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn endpoint(status: &'static str, calls: usize) -> (String, std::thread::JoinHandle<()>) {
    use std::io::{BufRead, BufReader, Read, Write};
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!(
        "http://{}/mcp/test-credential",
        listener.local_addr().unwrap()
    );
    let serving = std::thread::spawn(move || {
        for _ in 0..calls {
            let (mut stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(std::time::Duration::from_secs(5)))
                .unwrap();
            let mut reading = BufReader::new(stream.try_clone().unwrap());
            let mut length = 0;
            loop {
                let mut line = String::new();
                reading.read_line(&mut line).unwrap();
                if line.trim().is_empty() {
                    break;
                }
                if let Some((key, value)) = line.split_once(':')
                    && key.eq_ignore_ascii_case("content-length")
                {
                    length = value.trim().parse::<usize>().unwrap();
                }
            }
            let mut body = vec![0; length];
            reading.read_exact(&mut body).unwrap();
            let request: serde_json::Value = serde_json::from_slice(&body).unwrap();
            if request["method"] == "notifications/initialized" {
                write!(
                    stream,
                    "HTTP/1.1 202 Accepted\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
                )
                .unwrap();
                continue;
            }
            let result = if request["method"] == "initialize" {
                serde_json::json!({
                    "protocolVersion": "2025-06-18",
                    "capabilities": {"tools": {}},
                    "serverInfo": {"name": "totex", "version": "test"}
                })
            } else {
                assert_eq!(request["method"], "tools/list");
                serde_json::json!({"tools": [{"name":"canvas", "inputSchema":{"type":"object"}}]})
            };
            let body = serde_json::json!({"jsonrpc":"2.0", "id":request["id"], "result":result})
                .to_string();
            write!(stream, "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).unwrap();
        }
    });
    (url, serving)
}

#[test]
fn registration_is_idempotent_and_preserves_unrelated_settings() {
    let before = r#"# My preferences
model = "gpt-test" # keep my model
[mcp_servers.other]
command = "other"
[mcp_servers.totex]
url = "http://127.0.0.1:26374/mcp"
bearer_token_env_var = "TOTEX_MCP_TOKEN"
enabled = false
startup_timeout_sec = 20
enabled_tools = ["old"]
[tui]
terminal_title = ["project-name", "session-id", "git-branch"] # keep the title
status_line = ["context-used"]
"#;
    let next = patched(before, URL, None).unwrap();
    let parsed = next.parse::<DocumentMut>().unwrap();
    assert_eq!(parsed["model"].as_str(), Some("gpt-test"));
    assert_eq!(
        parsed["mcp_servers"]["other"]["command"].as_str(),
        Some("other")
    );
    assert_eq!(parsed["mcp_servers"]["totex"]["url"].as_str(), Some(URL));
    assert_eq!(
        parsed["mcp_servers"]["totex"]["enabled"].as_bool(),
        Some(true)
    );
    assert_eq!(
        parsed["mcp_servers"]["totex"]["startup_timeout_sec"].as_integer(),
        Some(20)
    );
    assert!(
        next.contains("# My preferences")
            && next.contains("# keep my model")
            && next.contains("# keep the title")
    );
    assert!(!next.contains("TOTEX_MCP_TOKEN") && !next.contains("enabled_tools"));
    let titles: Vec<_> = parsed["tui"]["terminal_title"]
        .as_array()
        .unwrap()
        .iter()
        .map(|x| x.as_str().unwrap())
        .collect();
    assert_eq!(titles, ["thread-id", "project-name", "git-branch"]);
    assert_eq!(patched(&next, URL, None).unwrap(), next);
}

#[test]
fn transport_replacement_and_default_titles_are_complete() {
    let before = "[mcp_servers.totex]\ncommand = 'old'\nargs = ['old']\nenv = { KEY = 'old' }\n";
    let http = patched(before, URL, None).unwrap();
    assert!(!http.contains("command") && !http.contains("KEY"));
    let bridge = (
        "/home/a's/.codex/totex-mcp-bridge.sh".to_string(),
        "/mnt/c/Windows/System32/curl.exe".to_string(),
    );
    let stdio = patched(&http, URL, Some(&bridge)).unwrap();
    let parsed = stdio.parse::<DocumentMut>().unwrap();
    assert!(parsed["mcp_servers"]["totex"].get("url").is_none());
    assert_eq!(
        parsed["mcp_servers"]["totex"]["command"].as_str(),
        Some("sh")
    );
    assert_eq!(
        parsed["mcp_servers"]["totex"]["args"]
            .as_array()
            .unwrap()
            .get(2)
            .unwrap()
            .as_str(),
        Some(URL)
    );
    assert_eq!(parsed["tui"]["terminal_title"].as_array().unwrap().len(), 4);
    assert_eq!(patched(&stdio, URL, Some(&bridge)).unwrap(), stdio);
}

#[test]
fn malformed_settings_are_never_overwritten() {
    let dir = Temp::new();
    let config = dir.0.join("config.toml");
    for invalid in [
        "[",
        "mcp_servers = 1",
        "[mcp_servers]\ntotex = false",
        "[tui]\nterminal_title = 'bad'",
        "[tui]\nterminal_title = [2]",
    ] {
        std::fs::write(&config, invalid).unwrap();
        assert!(register(&Host::Local, &dir.0, URL).is_err());
        assert_eq!(std::fs::read_to_string(&config).unwrap(), invalid);
        assert_eq!(std::fs::read_dir(&dir.0).unwrap().count(), 1);
    }
}

#[test]
fn writes_are_atomic_private_and_refuse_external_changes() {
    let dir = Temp::new();
    let config = dir.0.join("config.toml");
    let (url, serving) = endpoint("200 OK", 6);
    register(&Host::Local, &dir.0, &url).unwrap();
    let before = std::fs::read_to_string(&config).unwrap();
    register(&Host::Local, &dir.0, &url).unwrap();
    serving.join().unwrap();
    assert_eq!(std::fs::read_to_string(&config).unwrap(), before);
    std::fs::write(&config, "model = 'external'").unwrap();
    assert!(atomic(&Host::Local, &config, "model = 'lost'", Some(&before)).is_err());
    assert_eq!(
        std::fs::read_to_string(&config).unwrap(),
        "model = 'external'"
    );
    assert_eq!(std::fs::read_dir(&dir.0).unwrap().count(), 1);
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(
            std::fs::metadata(config).unwrap().permissions().mode() & 0o777,
            0o600
        );
    }
}

#[cfg(unix)]
#[test]
fn registration_preserves_a_config_symlink() {
    let dir = Temp::new();
    let target = dir.0.join("shared.toml");
    std::fs::write(&target, "model = 'kept'").unwrap();
    let config = dir.0.join("config.toml");
    std::os::unix::fs::symlink(&target, &config).unwrap();
    let (url, serving) = endpoint("200 OK", 3);
    register(&Host::Local, &dir.0, &url).unwrap();
    serving.join().unwrap();
    assert!(std::fs::symlink_metadata(config).unwrap().is_symlink());
    assert!(std::fs::read_to_string(target).unwrap().contains(&url));
}

#[test]
fn an_old_server_cannot_change_or_create_codex_settings() {
    let dir = Temp::new();
    let config = dir.0.join("config.toml");
    let before = "model = 'kept'\n[tui]\nterminal_title = ['project-name']\n";
    std::fs::write(&config, before).unwrap();
    let (url, serving) = endpoint("404 Not Found", 2);
    assert!(register(&Host::Local, &dir.0, &url).is_err());
    assert_eq!(std::fs::read_to_string(&config).unwrap(), before);
    assert_eq!(std::fs::read_dir(&dir.0).unwrap().count(), 1);
    let missing = dir.0.join("new-codex-home");
    assert!(register(&Host::Local, &missing, &url).is_err());
    assert!(!missing.exists());
    serving.join().unwrap();
}

#[test]
fn registration_rejects_ambiguous_or_unsafe_arguments() {
    for args in [
        vec!["--unknown"],
        vec!["--codex-home"],
        vec!["--codex-home", "relative"],
        vec!["--wsl", "Ubuntu"],
        vec!["--wsl", "Ubuntu\nextra"],
        vec!["--codex-home", "/one", "--codex-home", "/two"],
    ] {
        assert!(destination(&args.into_iter().map(str::to_owned).collect::<Vec<_>>()).is_err());
    }
    let (host, path) =
        destination(&["--wsl", "Ubuntu", "--codex-home", "/home/a/custom"].map(str::to_string))
            .unwrap();
    assert_eq!(host.native(&path), "/home/a/custom");
}

#[cfg(unix)]
#[test]
fn bridge_uses_the_registered_endpoint_without_inherited_credentials() {
    use std::{
        io::Write,
        os::unix::fs::PermissionsExt,
        process::{Command, Stdio},
    };
    let dir = Temp::new();
    let curl = dir.0.join("curl's proxy");
    std::fs::write(
        &curl,
        "#!/bin/sh\nprintf '%s\\n' \"$@\" > \"$MCP_TEST_ARGS\"\ncat\n",
    )
    .unwrap();
    std::fs::set_permissions(&curl, std::fs::Permissions::from_mode(0o700)).unwrap();
    let log = dir.0.join("args");
    let mut child = Command::new("sh")
        .args(["-c", BRIDGE, "totex", curl.to_str().unwrap(), URL])
        .env_remove("TOTEX_MCP_TOKEN")
        .env_remove("TOTEX_MCP_URL")
        .env("MCP_TEST_ARGS", &log)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .unwrap();
    child
        .stdin
        .take()
        .unwrap()
        .write_all(b"{\"id\":1}\n{\"id\":2}")
        .unwrap();
    let result = child.wait_with_output().unwrap();
    assert!(result.status.success());
    assert_eq!(
        String::from_utf8(result.stdout).unwrap(),
        "{\"id\":1}\n{\"id\":2}\n"
    );
    let args = std::fs::read_to_string(log).unwrap();
    assert!(args.ends_with(&format!("{URL}\n")));
    assert!(args.contains("--noproxy\n*\n"));
}
