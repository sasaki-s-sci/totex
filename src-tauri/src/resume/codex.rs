//! Which session a codex launch became.
//!
//! claude and opencode are handed the id of the session they are to keep, and
//! a launch that was handed one can be resumed by it. codex cannot be handed
//! one: it chooses its own, and says which only in the file it keeps the
//! session in. So the window launches it, notes when, and asks here afterwards
//! for the sessions that began in that directory since then.
//!
//! codex keeps every session as `$CODEX_HOME/sessions/YYYY/MM/DD/rollout-…jsonl`,
//! `~/.codex` when `CODEX_HOME` says nothing, and the first line of each is the
//! session's own description of itself: its id, when it began and where. That
//! line is all that is read. It is read on the machine the directory is on,
//! because that is the machine the codex that was launched in it ran on.

use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::Value;

use crate::host::Host;

/// How much of a file's first line is read. The line carries codex's whole
/// set of instructions as well as the few fields wanted from it, and runs to
/// tens of kilobytes; a line longer than this is one that will not parse, and
/// a session not found.
const HEAD: usize = 256 * 1024;

/// How far before the launch a session may say it began. The window notes the
/// launch when it types the line, and codex notes the session when it has
/// started — which is later — but the two clocks are not always one clock: a
/// WSL distribution or another machine keeps its own.
const SLACK_MS: u64 = 5_000;

const DAY_MS: u64 = 24 * 60 * 60 * 1_000;

/// The most days of directories one question looks through. A launch is
/// resumed within hours of it, and a `since` of zero would otherwise be every
/// day since 1970.
const DAYS: u64 = 32;

/// Every directory, file and first line read on the far machine in one go.
///
/// One process however many sessions there are, rather than one per file:
/// over ssh each is a round trip. Only first lines that name the directory
/// somewhere are printed, which leaves out nearly all of them — what is
/// printed is still checked properly on this side, so the check here only has
/// to be loose in the right direction.
const SCRIPT: &str = r#"root="${CODEX_HOME:-$HOME/.codex}/sessions"
needle=$1
limit=$2
shift 2
for day in "$@"; do
  for file in "$root/$day"/rollout-*.jsonl; do
    [ -f "$file" ] || continue
    head -n 1 "$file" | head -c "$limit" | grep -F -e "$needle"
  done
done
exit 0"#;

/// See [`super::resume_codex_sessions`].
pub fn sessions(cwd: &str, since_ms: u64) -> Vec<String> {
    let dir = Path::new(cwd);
    let host = Host::of(dir);
    let native = host.native(dir);
    let days = days(since_ms, now_ms());

    let lines = match host {
        Host::Local => codex_home()
            .map(|root| local(&root, &days))
            .unwrap_or_default(),
        Host::Wsl(_) | Host::Ssh(_) => remote(&host, &native, &days),
    };

    let mut found: Vec<(u64, String)> = lines
        .iter()
        .filter_map(|line| matching(line, &native, since_ms))
        .collect();
    found.sort();
    found.dedup_by(|a, b| a.1 == b.1);
    found.into_iter().map(|(_, id)| id).collect()
}

/// The id of the session a first line describes, and when it began, where it
/// is a session begun in `cwd` no earlier than `since_ms` allows.
///
/// The line is codex's `session_meta`, and the fields read are the payload's:
/// the top level carries a timestamp too, but that is when the line was
/// written rather than when the session began.
pub fn matching(first_line: &str, cwd: &str, since_ms: u64) -> Option<(u64, String)> {
    let line: Value = serde_json::from_str(first_line.trim()).ok()?;
    let payload = &line["payload"];
    let id = payload["id"].as_str().filter(|id| !id.is_empty())?;
    if !same_directory(payload["cwd"].as_str()?, cwd) {
        return None;
    }
    let began = timestamp_ms(payload["timestamp"].as_str()?)?;
    (began >= since_ms.saturating_sub(SLACK_MS)).then(|| (began, id.to_string()))
}

/// Whether two spellings of a directory are the same one, a separator at the
/// end aside.
fn same_directory(a: &str, b: &str) -> bool {
    fn bare(path: &str) -> &str {
        let trimmed = path.trim_end_matches(['/', '\\']);
        if trimmed.is_empty() { path } else { trimmed }
    }
    bare(a) == bare(b)
}

/// The first lines of the sessions in `days` under the codex home `root`, on
/// this machine.
pub fn local(root: &Path, days: &[(i64, u32, u32)]) -> Vec<String> {
    let sessions = root.join("sessions");

    let mut lines = Vec::new();
    for (year, month, day) in days {
        let dir = sessions
            .join(format!("{year:04}"))
            .join(format!("{month:02}"))
            .join(format!("{day:02}"));
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let name = entry.file_name();
            let name = name.to_string_lossy();
            if !name.starts_with("rollout-") || !name.ends_with(".jsonl") {
                continue;
            }
            if let Some(line) = first_line(&entry.path()) {
                lines.push(line);
            }
        }
    }
    lines
}

/// Where codex on this machine keeps what it keeps.
fn codex_home() -> Option<PathBuf> {
    match std::env::var_os("CODEX_HOME") {
        Some(home) if !home.is_empty() => Some(PathBuf::from(home)),
        _ => crate::fs_browse::home_dir().map(|home| home.join(".codex")),
    }
}

/// The first line of a file, read no further than [`HEAD`].
fn first_line(path: &Path) -> Option<String> {
    use std::io::Read;
    let file = std::fs::File::open(path).ok()?;
    let mut bytes = Vec::new();
    file.take(HEAD as u64).read_to_end(&mut bytes).ok()?;
    let end = bytes
        .iter()
        .position(|byte| *byte == b'\n')
        .unwrap_or(bytes.len());
    Some(String::from_utf8_lossy(&bytes[..end]).into_owned())
}

/// The first lines of the sessions in `days` that name `native`, on the far
/// machine — see [`SCRIPT`].
fn remote(host: &Host, native: &str, days: &[(i64, u32, u32)]) -> Vec<String> {
    // The directory as the line spells it, which is JSON's spelling: a
    // backslash or a quote in a path is escaped there, and has to be here too
    // for the one to be found in the other.
    let Ok(quoted) = serde_json::to_string(native) else {
        return Vec::new();
    };
    let needle = &quoted[1..quoted.len() - 1];
    let limit = HEAD.to_string();
    let days: Vec<String> = days
        .iter()
        .map(|(year, month, day)| format!("{year:04}/{month:02}/{day:02}"))
        .collect();

    let mut argv = vec!["sh", "-c", SCRIPT, "sh", needle, limit.as_str()];
    argv.extend(days.iter().map(String::as_str));

    let Ok(said) = host.exec(None, &[], &argv) else {
        return Vec::new();
    };
    String::from_utf8_lossy(&said.stdout)
        .lines()
        .map(str::to_string)
        .collect()
}

/// The days whose directories can hold a session begun since `since_ms`.
///
/// codex names the directory by the day on the machine it ran on, in whatever
/// zone that machine keeps, and the dates here are UTC — so a day either side
/// of the span covers every zone there is, at the cost of a directory or two
/// that is read and has nothing in it.
pub fn days(since_ms: u64, now_ms: u64) -> Vec<(i64, u32, u32)> {
    let last = now_ms.saturating_add(DAY_MS) / DAY_MS;
    let first = (since_ms.saturating_sub(DAY_MS) / DAY_MS).max(last.saturating_sub(DAYS));
    (first..=last).map(|day| civil(day as i64)).collect()
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as u64)
        .unwrap_or_default()
}

/// Milliseconds since 1970 for an RFC 3339 time as codex writes it —
/// `2026-10-17T02:30:40.927Z` — or with an offset in place of the `Z`.
pub fn timestamp_ms(text: &str) -> Option<u64> {
    let bytes = text.as_bytes();
    let number = |from: usize, to: usize| -> Option<i64> {
        let digits = text.get(from..to)?;
        if !digits.bytes().all(|byte| byte.is_ascii_digit()) {
            return None;
        }
        digits.parse().ok()
    };
    if bytes.len() < 20
        || bytes[4] != b'-'
        || bytes[7] != b'-'
        || !matches!(bytes[10], b'T' | b't' | b' ')
        || bytes[13] != b':'
        || bytes[16] != b':'
    {
        return None;
    }
    let (year, month, day) = (number(0, 4)?, number(5, 7)?, number(8, 10)?);
    let (hour, minute, second) = (number(11, 13)?, number(14, 16)?, number(17, 19)?);
    if !(1..=12).contains(&month) || !(1..=31).contains(&day) || hour > 23 || minute > 59 {
        return None;
    }

    // The fraction, to the millisecond and no further.
    let mut at = 19;
    let mut millis = 0;
    if bytes[at] == b'.' {
        at += 1;
        let start = at;
        while at < bytes.len() && bytes[at].is_ascii_digit() {
            at += 1;
        }
        if at == start {
            return None;
        }
        let fraction = format!("{:0<3}", &text[start..at.min(start + 3)]);
        millis = fraction.parse::<i64>().ok()?;
    }

    let offset_minutes = match &text[at..] {
        "Z" | "z" => 0,
        zone if zone.len() == 6 && zone.as_bytes()[3] == b':' => {
            let sign = match zone.as_bytes()[0] {
                b'+' => 1,
                b'-' => -1,
                _ => return None,
            };
            sign * (number(at + 1, at + 3)? * 60 + number(at + 4, at + 6)?)
        }
        _ => return None,
    };

    let seconds = days_from_civil(year, month as u32, day as u32) * 86_400
        + hour * 3_600
        + minute * 60
        + second
        - offset_minutes * 60;
    u64::try_from(seconds * 1_000 + millis).ok()
}

/// Days since 1970-01-01 for a date in the proleptic Gregorian calendar.
///
/// Howard Hinnant's `days_from_civil`, for the reason the hash is written out
/// by hand: a date library is a dependency for two lines of arithmetic.
fn days_from_civil(year: i64, month: u32, day: u32) -> i64 {
    let year = if month <= 2 { year - 1 } else { year };
    let era = year.div_euclid(400);
    let of_era = year - era * 400;
    let month = i64::from(month);
    let of_year =
        (153 * (if month > 2 { month - 3 } else { month + 9 }) + 2) / 5 + i64::from(day) - 1;
    let of_era_days = of_era * 365 + of_era / 4 - of_era / 100 + of_year;
    era * 146_097 + of_era_days - 719_468
}

/// The date `days` after 1970-01-01 — the inverse of [`days_from_civil`].
fn civil(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let of_era = z - era * 146_097;
    let year_of_era = (of_era - of_era / 1_460 + of_era / 36_524 - of_era / 146_096) / 365;
    let of_year = of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let shifted = (5 * of_year + 2) / 153;
    let day = (of_year - (153 * shifted + 2) / 5 + 1) as u32;
    let month = if shifted < 10 {
        shifted + 3
    } else {
        shifted - 9
    } as u32;
    let year = year_of_era + era * 400 + i64::from(month <= 2);
    (year, month, day)
}
