//! What starting an overseer leaves behind in the folder it is started in, and
//! the line typed to start it.
//!
//! The overseer is an agent like any other, run in a shell like any other, so
//! it is started the way somebody would start one by hand: with a file saying
//! where its server is, a file saying what it is for, and a command line. All
//! three are written into the folder's own `.totex`, beside whatever else the
//! folder keeps there, where the agent can read them with a relative path
//! whatever shell it is in and whichever machine the folder is on.

use std::path::Path;

use serde_json::json;

use crate::host::Host;

/// Where under the folder the files go.
pub const DIR: &str = "overseer";

/// What the overseer is told to do, word for word.
pub const PROMPT: &str = include_str!("prompt.md");

/// The name the server is registered under, which is also the prefix of every
/// one of its tools in the agent's own permission rules.
pub const SERVER: &str = "totex-overseer";

/// The size the overseer's shell is opened at, before any terminal is drawn
/// for it: the same a window opens any shell at — see `src/lib/pty.ts`.
pub const ROWS: u16 = 24;
pub const COLS: u16 = 80;

/// The line typed into the shell.
///
/// The prompt comes first: `--mcp-config` and `--allowedTools` each take as
/// many words as follow them, and a prompt written after either would be read
/// as one more config file or one more tool. Double quotes and forward slashes
/// only, which bash, PowerShell and cmd all read the same way. The tools are
/// allowed up front because the whole of the overseer's work is calling them
/// over and over, and a loop that stops to ask permission for each call is not
/// a loop.
pub fn command() -> String {
    format!(
        "claude \"Read .totex/{DIR}/prompt.md and follow it.\" --mcp-config .totex/{DIR}/mcp.json --allowedTools mcp__{SERVER}\r"
    )
}

/// How the agent is to reach the server.
pub fn config(port: u16, token: &str) -> String {
    let config = json!({
        "mcpServers": {
            SERVER: {
                "type": "http",
                "url": format!("http://127.0.0.1:{port}/mcp"),
                "headers": { "Authorization": format!("Bearer {token}") },
            }
        }
    });
    let mut text = serde_json::to_string_pretty(&config).unwrap_or_default();
    text.push('\n');
    text
}

/// Writes the files into `cwd`, in place of whatever was there.
///
/// Beside them goes a `.gitignore` that ignores the lot: the config holds the
/// token, and a token committed to a repository is a token handed to whoever
/// can read it.
pub fn write(cwd: &str, port: u16, token: &str) -> Result<(), String> {
    let host = Host::of_str(cwd);
    let space = host.join(Path::new(cwd), totex_host::space::DIR);
    let dir = host.join(&space, DIR);
    host.create_dir_all(&dir)?;
    for (name, text) in [
        (".gitignore", "*\n".to_string()),
        ("mcp.json", config(port, token)),
        ("prompt.md", PROMPT.to_string()),
    ] {
        let file = host.join(&dir, name);
        match host.stat(&file) {
            Some(stat) => host.write(&file, &text, stat.size).map(|_| ())?,
            None => host.write_new(&file, text.as_bytes())?,
        }
    }
    Ok(())
}
