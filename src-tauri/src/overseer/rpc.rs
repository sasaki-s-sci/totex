//! What is said to the overseer: MCP, and the four things it can do.
//!
//! Three of them look and one of them writes, and what it writes is a line of
//! text beside somebody else's terminal. Nothing here types into a session,
//! answers its question or ends it: the overseer is somebody watching over the
//! person's shoulder, and the person is the one at the keyboard.

use std::time::Duration;

use serde::Serialize;
use serde_json::{Value, json};

use totex_persistent::door::Report;

use super::journal::{Change, Journal};
use crate::ask::Doing;

/// The versions of the protocol this speaks, the first being the one answered
/// in when a client asks for one not listed. Nothing here differs between them.
const SPOKEN: [&str; 3] = ["2025-06-18", "2025-03-26", "2024-11-05"];

/// How long a wait is held by default, and the most and least it may be asked
/// for. Long enough that a quiet window costs the overseer one call every few
/// minutes, and short enough that a request is not held open for longer than
/// an HTTP client is likely to be patient for.
const WAIT_DEFAULT: u64 = 240;
const WAIT_LEAST: u64 = 1;
const WAIT_MOST: u64 = 600;

/// How long a wait that has been woken goes on gathering — see `Journal::wait`.
const LINGER: Duration = Duration::from_millis(1500);

/// How much of a status line is kept. The canvas cuts it again to the room it
/// has; this is the cut at the seam, so that what is held is a line.
const STATUS_LIMIT: usize = 200;

/// What the overseer is told it is, as it connects.
const INSTRUCTIONS: &str = "\
You are the overseer of a totex window: a canvas of git repositories and the \
terminals working in them. Through this server you can see every other \
terminal in the window — what is running in it, whether it is asking the \
person something, what its agent says it is doing, and its screen — and you \
can write one short status line per terminal, which is drawn beside that \
terminal on the canvas. It is the only thing drawn there: the agents' own \
reports and questions reach the person through your line.

This server is read-only towards the terminals: it cannot type into them, \
answer their questions or end them, and neither should you. Loop on `wait`, \
look at what changed with `terminals` and `screen`, and keep each terminal's \
line current with `describe`.";

/// What the window knows that the tools are answered out of.
///
/// A seam rather than the app itself, so that what is said over the wire can
/// be tested without a window behind it.
pub trait Sight: Send + Sync {
    /// Every running session but the overseer's own.
    fn terminals(&self) -> Vec<Terminal>;
    /// The rows of a session's screen as it stands, or nothing where there is
    /// no such session or it is the overseer's own.
    fn screen(&self, id: &str) -> Option<Vec<String>>;
    /// Sets or clears the line drawn beside a session, or says why not.
    fn describe(
        &self,
        id: &str,
        status: Option<String>,
        reply_key: Option<&str>,
    ) -> Result<(), String>;
    fn journal(&self) -> &Journal;
    /// The overseer's own session, which is never in what it is told.
    fn own(&self) -> Option<String>;
}

/// One session, as the overseer is shown it.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Terminal {
    pub id: String,
    pub cwd: String,
    pub branch: Option<String>,
    /// Nothing for a session that has not been read yet.
    pub doing: Option<Doing>,
    pub asking: Option<Asking>,
    pub typed: Option<String>,
    pub report: Option<Report>,
    pub status: Option<String>,
}

/// A question a session is standing on, as words rather than as a card.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Asking {
    pub question: String,
    pub choices: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

impl Asking {
    pub fn of(ask: &crate::ask::Ask) -> Self {
        let detail = ask.detail.join("\n");
        Self {
            question: ask.question.clone(),
            choices: ask
                .choices
                .iter()
                .map(|choice| choice.label.clone())
                .collect(),
            detail: (!detail.is_empty()).then_some(detail),
        }
    }
}

/// Answers one message, or says there is nothing to answer — a message with no
/// id is a client telling rather than asking.
pub fn answer(sight: &dyn Sight, body: &[u8]) -> Option<Value> {
    let Ok(message) = serde_json::from_slice::<Value>(body) else {
        return Some(fault(Value::Null, -32700, "the message is not json"));
    };

    let id = message.get("id").cloned().unwrap_or(Value::Null);
    let method = message.get("method").and_then(Value::as_str).unwrap_or("");
    let params = message.get("params").cloned().unwrap_or(Value::Null);

    if id.is_null() {
        return None;
    }

    Some(match method {
        "initialize" => said(id, hello(&params)),
        "ping" => said(id, json!({})),
        "tools/list" => said(id, json!({ "tools": tools() })),
        "tools/call" => said(id, call(sight, &params)),
        _ => fault(id, -32601, "there is no such method"),
    })
}

fn hello(params: &Value) -> Value {
    let asked = params.get("protocolVersion").and_then(Value::as_str);
    let version = asked
        .filter(|asked| SPOKEN.contains(asked))
        .unwrap_or(SPOKEN[0]);

    json!({
        "protocolVersion": version,
        "capabilities": { "tools": { "listChanged": false } },
        "serverInfo": { "name": "totex-overseer", "version": env!("CARGO_PKG_VERSION") },
        "instructions": INSTRUCTIONS,
    })
}

fn tools() -> Value {
    json!([
        {
            "name": "terminals",
            "title": "Every terminal in the window",
            "description": "Every terminal in the totex window except your own: where it is, its branch, what it is doing (idle | running | agent | working), the question it is asking the user if any, the last line typed at it, what its agent reports it is working on, and the status line you last wrote for it. Also returns the cursor to pass to `wait`.",
            "inputSchema": { "type": "object", "properties": {} },
        },
        {
            "name": "screen",
            "title": "One terminal's screen",
            "description": "The text on one terminal's screen as it stands, trailing blank lines removed.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "id": { "type": "string", "description": "The terminal's id, from `terminals`." },
                    "rows": { "type": "number", "description": "Only the last this many lines." },
                },
                "required": ["id"],
            },
        },
        {
            "name": "wait",
            "title": "Wait for a terminal to change",
            "description": "Blocks until some terminal changes after `since`, or the timeout runs out, and returns {cursor, changes, missed}. Pass the returned cursor as `since` next time. Each change has an id and a kind: opened, ended, doing (with `doing`), asking (with `question`, null when the question went away) or report (with `report`, the agent's own line). When `missed` is true some changes were lost: read `terminals` again in full.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "since": { "type": "number", "description": "The cursor from the last `wait` or `terminals`. Leave it out to wait from now." },
                    "timeout_seconds": { "type": "number", "description": "How long to wait, 1 to 600. Defaults to 240." },
                },
            },
        },
        {
            "name": "describe",
            "title": "Write a terminal's status line",
            "description": "Sets the one-line status drawn beside a terminal on the canvas: what it is doing right now and whether it needs the user. Keep it short. An empty status clears it. You cannot describe your own terminal.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "id": { "type": "string" },
                    "status": { "type": "string" },
                    "replyKey": { "type": "string", "description": "Copy report.reply.key from terminals when summarizing a reply; stale summaries are rejected." },
                },
                "required": ["id", "status"],
            },
        },
    ])
}

fn call(sight: &dyn Sight, params: &Value) -> Value {
    let name = params.get("name").and_then(Value::as_str).unwrap_or("");
    let arguments = params.get("arguments").cloned().unwrap_or(Value::Null);
    match name {
        "terminals" => text(&json!({
            // Read before the sessions are, so that anything changing while
            // they are being read is still after it.
            "cursor": sight.journal().cursor(),
            "terminals": sight.terminals(),
        })),
        "screen" => screen(sight, &arguments),
        "wait" => wait(sight, &arguments),
        "describe" => describe(sight, &arguments),
        _ => refused(&format!("there is no tool called {name}")),
    }
}

fn screen(sight: &dyn Sight, arguments: &Value) -> Value {
    let Some(id) = arguments.get("id").and_then(Value::as_str) else {
        return refused("`id` is required");
    };
    let Some(mut lines) = sight.screen(id) else {
        return refused(&format!("there is no terminal {id}"));
    };
    while lines.last().is_some_and(|line| line.trim().is_empty()) {
        lines.pop();
    }
    if let Some(rows) = arguments.get("rows").and_then(Value::as_f64)
        && rows >= 0.0
    {
        let rows = rows as usize;
        let from = lines.len().saturating_sub(rows);
        lines.drain(..from);
    }
    json!({ "content": [{ "type": "text", "text": lines.join("\n") }] })
}

fn wait(sight: &dyn Sight, arguments: &Value) -> Value {
    let since = arguments
        .get("since")
        .and_then(Value::as_f64)
        .filter(|since| *since >= 0.0)
        .map(|since| since as u64);
    let timeout = arguments
        .get("timeout_seconds")
        .and_then(Value::as_f64)
        .map_or(WAIT_DEFAULT, |seconds| seconds.max(0.0) as u64)
        .clamp(WAIT_LEAST, WAIT_MOST);
    let own = sight.own();
    let caught = sight.journal().wait(
        since,
        Duration::from_secs(timeout),
        LINGER,
        |change: &Change| own.as_deref() != Some(change.id.as_str()),
    );
    text(&serde_json::to_value(caught).unwrap_or(Value::Null))
}

fn describe(sight: &dyn Sight, arguments: &Value) -> Value {
    let Some(id) = arguments.get("id").and_then(Value::as_str) else {
        return refused("`id` is required");
    };
    let status = line(
        arguments
            .get("status")
            .and_then(Value::as_str)
            .unwrap_or(""),
    );
    let shown = (!status.is_empty()).then(|| status.clone());
    match sight.describe(id, shown, arguments.get("replyKey").and_then(Value::as_str)) {
        Ok(()) if status.is_empty() => text_of(format!("Cleared the status of {id}.")),
        Ok(()) => text_of(format!("Shown beside {id}: {status}")),
        Err(why) => refused(&why),
    }
}

/// One line, flattened and cut to what is kept.
pub fn line(said: &str) -> String {
    said.split_whitespace()
        .collect::<Vec<&str>>()
        .join(" ")
        .chars()
        .take(STATUS_LIMIT)
        .collect()
}

fn text(value: &Value) -> Value {
    text_of(value.to_string())
}

fn text_of(text: String) -> Value {
    json!({ "content": [{ "type": "text", "text": text }] })
}

fn said(id: Value, result: Value) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "result": result })
}

/// A tool that would not do what it was asked: an answer the agent reads and
/// carries on from, rather than an error.
fn refused(why: &str) -> Value {
    json!({ "content": [{ "type": "text", "text": why }], "isError": true })
}

fn fault(id: Value, code: i32, why: &str) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": why } })
}
