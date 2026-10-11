//! The MCP bridge run against a stand-in curl that answers requests by echoing
//! them back with what it was told, and notifications with nothing.

use std::io::Write;
use std::os::unix::fs::PermissionsExt;
use std::path::PathBuf;
use std::process::{Command, Stdio};

use super::super::MCP_BRIDGE;

fn scratch(name: &str) -> PathBuf {
    let unique = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let root = std::env::temp_dir().join(format!("totex-{name}-{}-{unique}", std::process::id()));
    std::fs::create_dir_all(&root).unwrap();
    root
}

/// A curl that prints its auth header, its URL and its body, for requests.
fn fake_curl(root: &std::path::Path) -> PathBuf {
    let curl = root.join("curl.exe");
    std::fs::write(
        &curl,
        "#!/bin/sh\nbody=$(cat)\ncase \"$body\" in *'\"id\"'*) printf '%s|%s|%s' \"$3\" \"$8\" \"$body\" ;; esac\n",
    )
    .unwrap();
    std::fs::set_permissions(&curl, std::fs::Permissions::from_mode(0o755)).unwrap();
    curl
}

fn run(mut command: Command, input: &[u8]) -> String {
    let mut child = command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .unwrap();
    child.stdin.take().unwrap().write_all(input).unwrap();
    String::from_utf8(child.wait_with_output().unwrap().stdout).unwrap()
}

#[test]
fn posts_each_line_and_writes_back_each_answer() {
    let root = scratch("bridge");
    let curl = fake_curl(&root);
    let mut command = Command::new("sh");
    command
        .arg("-c")
        .arg(MCP_BRIDGE)
        .arg("sh")
        .arg(&curl)
        .env("TOTEX_URL", "http://127.0.0.1:1/mcp")
        .env("TOTEX_TOKEN", "t")
        .env_remove("TOTEX_MCP_URL");
    let said = run(
        command,
        b"{\"id\":1,\"a\":\"x\\\\n y\"}\n\n{\"method\":\"n\"}\n{\"id\":2}",
    );
    std::fs::remove_dir_all(&root).unwrap();
    assert_eq!(
        said,
        "Authorization: Bearer t|http://127.0.0.1:1/mcp|{\"id\":1,\"a\":\"x\\\\n y\"}\n\
         Authorization: Bearer t|http://127.0.0.1:1/mcp|{\"id\":2}\n"
    );
}

/// An agent that starts its servers with an environment of its own still has
/// the terminal's address above it.
#[test]
fn finds_the_terminal_address_in_an_ancestor() {
    let root = scratch("bridge-ancestor");
    let curl = fake_curl(&root);
    let mut command = Command::new("sh");
    command
        .arg("-c")
        .arg("env -u TOTEX_MCP_URL sh -c \"$1\" sh \"$2\"; :")
        .arg("sh")
        .arg(MCP_BRIDGE)
        .arg(&curl)
        .env("TOTEX_MCP_URL", "http://127.0.0.1:2/s/abc")
        .env_remove("TOTEX_URL")
        .env_remove("TOTEX_TOKEN");
    let said = run(command, b"{\"id\":1}\n");
    std::fs::remove_dir_all(&root).unwrap();
    assert_eq!(said, "X-Totex: 1|http://127.0.0.1:2/s/abc|{\"id\":1}\n");
}
