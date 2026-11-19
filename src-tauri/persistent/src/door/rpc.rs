//! MCP canvas operations, scoped to the authenticated terminal.

use serde_json::{Value, json};

use super::{Door, Report, Step};

/// The version of the protocol this speaks, and the ones it will answer in.
///
/// Nothing here differs between them: a handshake, a list of one tool and a
/// call. So a client that asks for an older one is answered in it rather than
/// being argued with.
const SPOKEN: [&str; 3] = ["2025-06-18", "2025-03-26", "2024-11-05"];

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
pub fn answer(door: &Door, session: Option<&str>, body: &[u8]) -> Option<Value> {
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
        "tools/list" => said(id, json!({ "tools": [super::canvas::tool()] })),
        "tools/call" => {
            let terminal = session
                .map(str::to_string)
                .map(Ok)
                .unwrap_or_else(|| door.terminal(&params["_meta"]));
            said(
                id,
                match terminal {
                    Ok(terminal) => call(door, &terminal, &params),
                    Err(why) => refused(&why),
                },
            )
        }
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
        "instructions": "Use the canvas tool to show evidence while you work: running web apps, Playwright screenshots, files, code and explanations. totex identifies the terminal running this conversation automatically; do not ask the user for terminal IDs. Keep existing pane IDs when updating evidence. Read the canvas before replacing user-added material. The user can navigate and remove panes with the keyboard. Prefer evidence to status summaries.",
    })
}

/// One call of it.
fn call(door: &Door, session: &str, params: &Value) -> Value {
    let name = params.get("name").and_then(Value::as_str).unwrap_or("");
    if name == "canvas" {
        return match super::canvas::call(
            door,
            session,
            params.get("arguments").cloned().unwrap_or(json!({})),
        ) {
            Ok(canvas) => {
                json!({ "content": [{ "type": "text", "text": serde_json::to_string(&canvas).unwrap() }], "structuredContent": canvas })
            }
            Err(why) => refused(&why),
        };
    }
    if name != "report" {
        return refused(&format!("there is no tool called {name}"));
    }

    // Previously connected agents can finish reporting, but new clients only see canvas.

    let arguments = params.get("arguments").cloned().unwrap_or(Value::Null);
    let report = Report {
        doing: line(arguments.get("doing").and_then(Value::as_str).unwrap_or("")),
        steps: steps(arguments.get("steps")),
    };
    let shown = shown(&report);
    super::report::keep(door, session, report);

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
