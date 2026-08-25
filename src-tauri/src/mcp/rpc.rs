//! What is said through the door: MCP, and the one thing this server offers.
//!
//! The protocol is a handshake and a list, so what is written out here is the
//! smallest server that is a real one: `initialize`, `tools/list`, `tools/call`
//! and a ping. The tool is deliberately one — an agent calls what it is given,
//! so what it is given is the shape of what ends up on the graph, and anything
//! wider would draw a different card every time.

use serde_json::{Value, json};
use tauri::{AppHandle, Runtime};

use super::{Report, Step};

/// The version of the protocol this speaks, and the ones it will answer in.
///
/// Nothing here differs between them: a handshake, a list of one tool and a
/// call. So a client that asks for an older one is answered in it rather than
/// being argued with.
const SPOKEN: [&str; 3] = ["2025-06-18", "2025-03-26", "2024-11-05"];

/// What an agent is told this server is for, at the moment it connects.
///
/// This is the only place in the app that writes to somebody else's agent, and
/// it is worth being exact about what it asks for. Two things: report about the
/// work rather than about the tool in your hand, and do not report every time
/// something happens. A line that changes ten times a second is a line nobody
/// can read, and the whole point of it is to be readable from across a canvas
/// by somebody who has not opened the terminal.
const INSTRUCTIONS: &str = "\
This terminal is running inside totex — a window that draws a git repository, \
the worktrees standing on it, and the terminals working in them. What you \
report here is drawn on that graph, beside this terminal's own mark, where it \
can be read without the terminal being opened.

Report when you take up a piece of work, when you finish a step of it, and when \
you are done. One line, about the work rather than about the tool you happen to \
be reaching for: \"rewriting the session layout\", not \"running grep\". Report \
with nothing in it when there is nothing left to show.

Do not report on every tool call. Somebody is reading this from across a room.";

/// What the tool itself says it is for.
const TOOL: &str = "\
Say what this terminal is working on, so it can be seen on the totex graph \
without the terminal being opened. Call it when you take up a piece of work, \
when you finish a step of it, and when you are done — not on every tool call. \
Call it with an empty `doing` and no steps when there is nothing to show.";

/// How much of a line is kept.
///
/// The card cuts what it draws to the room it has; this is the other cut, at
/// the seam, so that what is held is a sentence rather than whatever an agent
/// felt like sending. Generous enough that the cut is never what the card is
/// showing.
const DOING_LIMIT: usize = 240;
const TITLE_LIMIT: usize = 120;
const STEPS_LIMIT: usize = 32;

/// Answers one message, or says there is nothing to answer.
///
/// `None` is a notification — a message with no id, which is a client telling
/// rather than asking. There is exactly one of those in the handshake and
/// nothing is expected back.
pub fn answer<R: Runtime>(app: &AppHandle<R>, session: &str, body: &[u8]) -> Option<Value> {
    let Ok(message) = serde_json::from_slice::<Value>(body) else {
        return Some(fault(Value::Null, -32700, "the message is not json"));
    };

    let id = message.get("id").cloned().unwrap_or(Value::Null);
    let method = message.get("method").and_then(Value::as_str).unwrap_or("");
    let params = message.get("params").cloned().unwrap_or(Value::Null);

    // A notification, which is a message with no id on it. The one this server
    // is ever sent says the handshake is finished.
    if id.is_null() {
        return None;
    }

    Some(match method {
        "initialize" => said(id, hello(&params)),
        "ping" => said(id, json!({})),
        "tools/list" => said(id, json!({ "tools": [tool()] })),
        "tools/call" => said(id, call(app, session, &params)),
        _ => fault(id, -32601, "there is no such method"),
    })
}

/// The answer to being connected to.
fn hello(params: &Value) -> Value {
    let asked = params.get("protocolVersion").and_then(Value::as_str);
    let version = asked
        .filter(|asked| SPOKEN.contains(asked))
        .unwrap_or(SPOKEN[0]);

    json!({
        "protocolVersion": version,
        "capabilities": { "tools": { "listChanged": false } },
        "serverInfo": { "name": "totex", "version": env!("CARGO_PKG_VERSION") },
        "instructions": INSTRUCTIONS,
    })
}

/// The one tool, and the shape of what it takes.
fn tool() -> Value {
    json!({
        "name": "report",
        "title": "Report what this terminal is working on",
        "description": TOOL,
        "inputSchema": {
            "type": "object",
            "properties": {
                "doing": {
                    "type": "string",
                    "description": "One line: what is being worked on right now. Empty when there is nothing to show.",
                },
                "steps": {
                    "type": "array",
                    "description": "The plan that line is a step of, in order. Leave it out when there is no plan.",
                    "items": {
                        "type": "object",
                        "properties": {
                            "title": { "type": "string" },
                            "done": { "type": "boolean", "description": "Finished. The first step that is not is the one being worked on." },
                        },
                        "required": ["title", "done"],
                    },
                },
            },
            "required": ["doing"],
        },
    })
}

/// One call of it.
fn call<R: Runtime>(app: &AppHandle<R>, session: &str, params: &Value) -> Value {
    let name = params.get("name").and_then(Value::as_str).unwrap_or("");
    if name != "report" {
        return refused(&format!("there is no tool called {name}"));
    }

    let arguments = params.get("arguments").cloned().unwrap_or(Value::Null);
    let report = Report {
        doing: line(arguments.get("doing").and_then(Value::as_str).unwrap_or("")),
        steps: steps(arguments.get("steps")),
    };
    let shown = shown(&report);
    super::keep(app, session, report);

    json!({ "content": [{ "type": "text", "text": shown }] })
}

/// What the agent is told back, which is what the window is now showing.
fn shown(report: &Report) -> String {
    if report.doing.is_empty() && report.steps.is_empty() {
        return "Nothing is being shown beside this terminal now.".to_string();
    }
    let done = report.steps.iter().filter(|step| step.done).count();
    match report.steps.len() {
        0 => format!("Shown beside this terminal: {}", report.doing),
        all => format!(
            "Shown beside this terminal: {} ({done}/{all})",
            report.doing
        ),
    }
}

/// One line, cut to what is kept.
///
/// Whatever arrives with a newline in it was meant as one line by somebody who
/// had a paragraph — the card draws a line, and a line is what is kept.
fn line(said: &str) -> String {
    let flat: String = said
        .split_whitespace()
        .collect::<Vec<&str>>()
        .join(" ")
        .chars()
        .take(DOING_LIMIT)
        .collect();
    flat
}

fn steps(said: Option<&Value>) -> Vec<Step> {
    let Some(all) = said.and_then(Value::as_array) else {
        return Vec::new();
    };
    all.iter()
        .filter_map(|step| {
            let title: String = step
                .get("title")
                .and_then(Value::as_str)
                .map(line)?
                .chars()
                .take(TITLE_LIMIT)
                .collect();
            if title.is_empty() {
                return None;
            }
            Some(Step {
                title,
                done: step.get("done").and_then(Value::as_bool).unwrap_or(false),
            })
        })
        .take(STEPS_LIMIT)
        .collect()
}

/// A result, under the id it was asked for.
fn said(id: Value, result: Value) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "result": result })
}

/// A tool that would not do what it was asked, which is an answer rather than
/// an error: the agent is meant to read this and carry on.
fn refused(why: &str) -> Value {
    json!({ "content": [{ "type": "text", "text": why }], "isError": true })
}

/// A message that was not one.
fn fault(id: Value, code: i32, why: &str) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": why } })
}
