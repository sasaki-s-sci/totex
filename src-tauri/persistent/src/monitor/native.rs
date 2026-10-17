//! The state a coding agent keeps for its own session, read where it keeps it.
//! No model call and no terminal reading: the agent's record is the report.
//! Each reader is best-effort. `None` means this terminal has no such state
//! here, and the configured observer runs as before.
//! shortcut: Linux and the local host only, Codex has no reader yet; a permission
//! prompt is invisible to these records, so it is never reported natively.

use super::{Report, Status};
use rusqlite::{Connection, OpenFlags};
use serde_json::Value;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

/// Only the end of a transcript is read: the current turn is there.
const TAIL_BYTES: u64 = 512 * 1024;

/// The report the agent running under `root` gives from its own state.
pub fn observe(root: u32, cwd: &str) -> Option<Report> {
    let descendants = super::descendants(root);
    if let Some(config) = claude_config_dir() {
        for pid in &descendants {
            if let Some(report) = claude(&config, *pid) {
                return Some(report);
            }
        }
    }
    if descendants.iter().any(|pid| is_opencode(*pid)) {
        return opencode(&opencode_database()?, cwd);
    }
    None
}

fn claude_config_dir() -> Option<PathBuf> {
    std::env::var_os("CLAUDE_CONFIG_DIR")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".claude")))
}

/// Claude Code writes `sessions/<pid>.json` for each process it runs.
fn claude(config: &Path, pid: u32) -> Option<Report> {
    let registry: Value = serde_json::from_str(
        &std::fs::read_to_string(config.join("sessions").join(format!("{pid}.json"))).ok()?,
    )
    .ok()?;
    // A pid is reused once its process ends; the start time tells the two apart.
    if registry["procStart"].as_str()? != start_time(pid)? {
        return None;
    }
    let session = registry["sessionId"].as_str()?;
    if !session.chars().all(|c| c.is_ascii_hexdigit() || c == '-') {
        return None;
    }
    let transcript = std::fs::read_dir(config.join("projects"))
        .ok()?
        .flatten()
        .map(|dir| dir.path().join(format!("{session}.jsonl")))
        .find(|path| path.is_file())?;
    Some(claude_report(&tail_records(&transcript)?))
}

/// The start time field of `/proc/<pid>/stat`, which is clock ticks since boot.
fn start_time(pid: u32) -> Option<String> {
    let stat = std::fs::read_to_string(format!("/proc/{pid}/stat")).ok()?;
    let (_, fields) = stat.rsplit_once(") ")?;
    fields.split_whitespace().nth(19).map(str::to_owned)
}

/// The JSON records at the end of a transcript, whole lines only.
fn tail_records(path: &Path) -> Option<Vec<Value>> {
    let mut file = File::open(path).ok()?;
    let length = file.metadata().ok()?.len();
    let cut = length > TAIL_BYTES;
    if cut {
        file.seek(SeekFrom::Start(length - TAIL_BYTES)).ok()?;
    }
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes).ok()?;
    let text = String::from_utf8_lossy(&bytes).into_owned();
    // The first line of a window cut from the middle is not a whole record.
    let body = if cut {
        text.split_once('\n').map_or("", |(_, rest)| rest)
    } else {
        &text
    };
    Some(
        body.lines()
            .filter_map(|line| serde_json::from_str(line).ok())
            .collect(),
    )
}

fn claude_report(records: &[Value]) -> Report {
    let turns: Vec<&Value> = records
        .iter()
        .filter(|r| matches!(r["type"].as_str(), Some("user" | "assistant")))
        .filter(|r| r["isSidechain"] != true)
        .collect();
    let Some(last) = turns.last() else {
        return Report::default();
    };
    // A turn that ends normally leaves the agent waiting for its user.
    let status = if last["type"] == "assistant" && last["message"]["stop_reason"] == "end_turn" {
        Status::Stopped
    } else {
        Status::Running
    };
    let request = records
        .iter()
        .rev()
        .find(|r| r["type"] == "last-prompt")
        .and_then(|r| r["lastPrompt"].as_str())
        .map(str::to_owned);
    let latest = turns.iter().rev().find(|r| r["type"] == "assistant");
    let task = latest
        .map(|r| claude_text(&r["message"]["content"]))
        .filter(|text| !text.is_empty())
        .or_else(|| {
            records
                .iter()
                .rev()
                .find(|r| r["type"] == "ai-title")
                .and_then(|r| r["aiTitle"].as_str())
                .map(str::to_owned)
        });
    Report {
        status,
        request_summary: request,
        task_summary: task,
        ..Report::default()
    }
}

/// The text of a message, or the tools it calls when it has no text.
fn claude_text(content: &Value) -> String {
    let Some(blocks) = content.as_array() else {
        return content.as_str().unwrap_or_default().to_owned();
    };
    let text: Vec<_> = blocks
        .iter()
        .filter(|b| b["type"] == "text")
        .filter_map(|b| b["text"].as_str())
        .collect();
    if !text.is_empty() {
        return text.join("\n");
    }
    blocks
        .iter()
        .filter(|b| b["type"] == "tool_use")
        .filter_map(|b| b["name"].as_str())
        .map(|name| format!("Using {name}"))
        .collect::<Vec<_>>()
        .join(", ")
}

fn is_opencode(pid: u32) -> bool {
    let Ok(command) = std::fs::read(format!("/proc/{pid}/cmdline")) else {
        return false;
    };
    // Installed as a native binary or as a script run by node: the name is in
    // the first two words either way.
    command
        .split(|b| *b == 0)
        .take(2)
        .any(|word| word.rsplit(|b| *b == b'/').next() == Some(&b"opencode"[..]))
}

fn opencode_database() -> Option<PathBuf> {
    let data = std::env::var_os("XDG_DATA_HOME")
        .map(PathBuf::from)
        .filter(|path| path.is_absolute())
        .or_else(|| {
            std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".local/share"))
        })?;
    Some(data.join("opencode/opencode.db"))
}

/// The newest session OpenCode has in `cwd`, from its own database, read-only.
/// shortcut: a session in the same directory is taken as this terminal's, so
/// two OpenCode sessions in one folder show the one updated last.
fn opencode(database: &Path, cwd: &str) -> Option<Report> {
    let db = Connection::open_with_flags(
        database,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .ok()?;
    let (session, title): (String, String) = db
        .query_row(
            "select id, title from session where directory = ?1 and time_archived is null \
             order by time_updated desc limit 1",
            [cwd],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .ok()?;
    let messages = recent_messages(&db, &session)?;
    let newest = messages.first()?;
    // A reply that ends with a `stop` step has finished; one still making
    // tool calls, or a prompt not yet answered, is running.
    let status = if newest.role == "assistant"
        && newest
            .parts
            .iter()
            .rev()
            .find(|p| p["type"] == "step-finish")
            .is_some_and(|p| p["reason"] == "stop")
    {
        Status::Stopped
    } else {
        Status::Running
    };
    let request = messages
        .iter()
        .find(|m| m.role == "user")
        .map(|m| part_text(&m.parts));
    let task = messages
        .iter()
        .find(|m| m.role == "assistant")
        .map(|m| part_text(&m.parts))
        .filter(|text| !text.is_empty())
        .unwrap_or(title);
    Some(Report {
        status,
        request_summary: request.filter(|text| !text.is_empty()),
        task_summary: Some(task),
        ..Report::default()
    })
}

struct Message {
    role: String,
    parts: Vec<Value>,
}

/// The last few messages of a session, newest first, with their parts.
fn recent_messages(db: &Connection, session: &str) -> Option<Vec<Message>> {
    let mut statement = db
        .prepare(
            "select id, data from message where session_id = ?1 \
             order by time_created desc limit 8",
        )
        .ok()?;
    let rows: Vec<(String, String)> = statement
        .query_map([session], |row| Ok((row.get(0)?, row.get(1)?)))
        .ok()?
        .flatten()
        .collect();
    Some(
        rows.into_iter()
            .map(|(id, data)| {
                let role = serde_json::from_str::<Value>(&data)
                    .ok()
                    .and_then(|v| v["role"].as_str().map(str::to_owned));
                Message {
                    role: role.unwrap_or_default(),
                    parts: parts(db, &id),
                }
            })
            .collect(),
    )
}

fn parts(db: &Connection, message: &str) -> Vec<Value> {
    let Ok(mut statement) =
        db.prepare("select data from part where message_id = ?1 order by time_created")
    else {
        return vec![];
    };
    statement
        .query_map([message], |row| row.get::<_, String>(0))
        .map(|rows| {
            rows.flatten()
                .filter_map(|data| serde_json::from_str(&data).ok())
                .collect()
        })
        .unwrap_or_default()
}

fn part_text(parts: &[Value]) -> String {
    parts
        .iter()
        .filter(|p| p["type"] == "text")
        .filter_map(|p| p["text"].as_str())
        .collect::<Vec<_>>()
        .join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn records(lines: &str) -> Vec<Value> {
        lines
            .lines()
            .map(|line| serde_json::from_str(line).unwrap())
            .collect()
    }

    #[test]
    fn a_finished_claude_turn_is_stopped_with_its_prompt_and_reply() {
        let report = claude_report(&records(
            r#"{"type":"last-prompt","lastPrompt":"fix the tests"}
{"type":"user","message":{"role":"user","content":"fix the tests"}}
{"type":"assistant","message":{"role":"assistant","stop_reason":"tool_use","content":[{"type":"tool_use","name":"Bash"}]}}
{"type":"user","message":{"role":"user","content":[{"type":"tool_result"}]}}
{"type":"assistant","message":{"role":"assistant","stop_reason":"end_turn","content":[{"type":"text","text":"Done."}]}}"#,
        ));
        assert_eq!(report.status, Status::Stopped);
        assert_eq!(report.request_summary.as_deref(), Some("fix the tests"));
        assert_eq!(report.task_summary.as_deref(), Some("Done."));
    }

    #[test]
    fn a_claude_turn_still_calling_tools_is_running() {
        let report = claude_report(&records(
            r#"{"type":"assistant","message":{"role":"assistant","stop_reason":"tool_use","content":[{"type":"tool_use","name":"Edit"}]}}"#,
        ));
        assert_eq!(report.status, Status::Running);
        assert_eq!(report.task_summary.as_deref(), Some("Using Edit"));
    }

    #[test]
    fn a_cut_transcript_drops_its_partial_first_line() {
        let dir = std::env::temp_dir().join(format!("totex-native-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("cut.jsonl");
        let whole = "{\"type\":\"user\"}\n".repeat(4);
        let padding = "x".repeat(TAIL_BYTES as usize);
        std::fs::write(&path, format!("{{\"pad\":\"{padding}\"}}\n{whole}")).unwrap();
        let read = tail_records(&path).unwrap();
        assert_eq!(read.len(), 4);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn opencode_reports_the_newest_session_in_its_folder() {
        let dir = std::env::temp_dir().join(format!("totex-native-db-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("opencode.db");
        let db = Connection::open(&path).unwrap();
        db.execute_batch(
            "create table session (id text, directory text, title text, time_updated integer, time_archived integer);
             create table message (id text, session_id text, time_created integer, data text);
             create table part (id text, message_id text, time_created integer, data text);
             insert into session values ('s1', '/work', 'Old title', 1, null);
             insert into session values ('s2', '/work', 'Fix the parser', 2, null);
             insert into message values ('m1', 's2', 1, '{\"role\":\"user\"}');
             insert into message values ('m2', 's2', 2, '{\"role\":\"assistant\"}');
             insert into part values ('p1', 'm1', 1, '{\"type\":\"text\",\"text\":\"parse the file\"}');
             insert into part values ('p2', 'm2', 2, '{\"type\":\"text\",\"text\":\"Parser fixed.\"}');
             insert into part values ('p3', 'm2', 3, '{\"type\":\"step-finish\",\"reason\":\"stop\"}');",
        )
        .unwrap();
        drop(db);
        let report = opencode(&path, "/work").unwrap();
        assert_eq!(report.status, Status::Stopped);
        assert_eq!(report.request_summary.as_deref(), Some("parse the file"));
        assert_eq!(report.task_summary.as_deref(), Some("Parser fixed."));
        assert!(opencode(&path, "/elsewhere").is_none());
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
