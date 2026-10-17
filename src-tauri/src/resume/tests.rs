//! The hash, the reading of codex's first lines, and one fingerprint taken of a
//! real checkout on this machine.

use std::path::{Path, PathBuf};
use std::process::Command;

use super::codex::{days, local, matching, timestamp_ms};
use super::fingerprint::{Fnv, take};

fn fnv(bytes: &[u8]) -> String {
    let mut hash = Fnv::start();
    hash.write(bytes);
    hash.hex()
}

#[test]
fn the_hash_is_fnv_1a_as_published() {
    // The reference vectors, which are what makes a hash taken by one release
    // the same hash taken by the next.
    assert_eq!(fnv(b""), "cbf29ce484222325");
    assert_eq!(fnv(b"a"), "af63dc4c8601ec8c");
    assert_eq!(fnv(b"foobar"), "85944171f73967e8");
}

#[test]
fn where_one_part_ends_is_part_of_the_hash() {
    let mut one = Fnv::start();
    one.part(b"ab");
    one.part(b"c");
    let mut two = Fnv::start();
    two.part(b"a");
    two.part(b"bc");
    assert_ne!(one.hex(), two.hex());
    assert_eq!(one.hex().len(), 16);
}

const LINE: &str = r#"{"timestamp":"2026-10-17T02:31:47.049Z","type":"session_meta","payload":{"id":"01a147b2-780f-7573-b16d-2607d716c7fe","timestamp":"2026-10-17T02:30:40.927Z","cwd":"/home/a/repo/x","originator":"codex-tui"}}"#;

#[test]
fn a_time_reads_as_codex_writes_it() {
    assert_eq!(timestamp_ms("1970-01-01T00:00:00Z"), Some(0));
    assert_eq!(
        timestamp_ms("2026-10-17T02:30:40.927Z"),
        Some(1_792_204_240_927)
    );
    assert_eq!(
        timestamp_ms("2026-10-17T11:30:40.927+09:00"),
        Some(1_792_204_240_927)
    );
    assert_eq!(
        timestamp_ms("2026-10-17T02:30:40.9Z"),
        Some(1_792_204_240_900)
    );
    assert_eq!(
        timestamp_ms("2026-10-17T02:30:40.927123Z"),
        Some(1_792_204_240_927)
    );
    assert_eq!(timestamp_ms("2026-10-17"), None);
    assert_eq!(timestamp_ms("2026-10-17T02:30:40.927"), None);
}

#[test]
fn a_session_begun_here_since_the_launch_is_found() {
    let began = 1_792_204_240_927;
    assert_eq!(
        matching(LINE, "/home/a/repo/x", began),
        Some((began, "01a147b2-780f-7573-b16d-2607d716c7fe".to_string()))
    );
    // A separator at the end is the same directory.
    assert!(matching(LINE, "/home/a/repo/x/", began).is_some());
}

#[test]
fn a_session_a_little_before_the_launch_is_still_found() {
    let began = 1_792_204_240_927;
    assert!(matching(LINE, "/home/a/repo/x", began + 4_000).is_some());
    assert!(matching(LINE, "/home/a/repo/x", began + 6_000).is_none());
}

#[test]
fn a_session_somewhere_else_is_not() {
    assert!(matching(LINE, "/home/a/repo/y", 0).is_none());
    assert!(matching(LINE, "/home/a/repo", 0).is_none());
}

#[test]
fn a_line_that_is_not_a_session_is_nothing() {
    assert!(matching("", "/home/a/repo/x", 0).is_none());
    assert!(matching("{\"timestamp\":", "/home/a/repo/x", 0).is_none());
    assert!(
        matching(
            r#"{"type":"response_item","payload":{}}"#,
            "/home/a/repo/x",
            0
        )
        .is_none()
    );
}

#[test]
fn the_days_looked_through_cover_the_span_and_a_day_either_side() {
    let since = timestamp_ms("2026-10-17T02:30:00Z").unwrap();
    let now = timestamp_ms("2026-10-17T03:00:00Z").unwrap();
    assert_eq!(
        days(since, now),
        vec![(2026, 10, 16), (2026, 10, 17), (2026, 10, 18)]
    );

    // Across a year's end, and never further back than a month.
    let since = timestamp_ms("2026-12-31T23:00:00Z").unwrap();
    let now = timestamp_ms("2027-01-01T01:00:00Z").unwrap();
    assert_eq!(
        days(since, now),
        vec![(2026, 12, 30), (2026, 12, 31), (2027, 1, 1), (2027, 1, 2)]
    );
    assert_eq!(days(0, now).len(), 33);
}

#[test]
fn no_guard_is_no_fingerprint() {
    assert_eq!(take("/nowhere/at/all", "none"), Ok(None));
}

#[test]
fn a_directory_that_is_gone_says_so() {
    assert_eq!(
        take("/nowhere/at/all", "git"),
        Err("missing-directory".to_string())
    );
}

/// A temporary directory that removes itself.
struct TempDir(PathBuf);

impl TempDir {
    fn new(tag: &str) -> Self {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|elapsed| elapsed.as_nanos())
            .unwrap_or_default();
        let path = std::env::temp_dir().join(format!(
            "totex-resume-{tag}-{}-{unique}",
            std::process::id()
        ));
        std::fs::create_dir_all(&path).expect("create temp dir");
        Self(path)
    }

    fn path(&self) -> &Path {
        &self.0
    }

    fn spelled(&self) -> String {
        self.0.to_string_lossy().into_owned()
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

/// Runs git in the fixture, isolated from whatever git config the machine has.
fn git(dir: &Path, args: &[&str]) {
    let output = Command::new("git")
        .arg("-C")
        .arg(dir)
        .args(args)
        .env("GIT_AUTHOR_NAME", "totex")
        .env("GIT_AUTHOR_EMAIL", "totex@example.invalid")
        .env("GIT_COMMITTER_NAME", "totex")
        .env("GIT_COMMITTER_EMAIL", "totex@example.invalid")
        .env("GIT_CONFIG_GLOBAL", "/dev/null")
        .env("GIT_CONFIG_SYSTEM", "/dev/null")
        .output()
        .expect("run git");
    assert!(
        output.status.success(),
        "git {args:?} failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
}

#[test]
fn a_checkout_is_the_same_world_until_something_in_it_changes() {
    if crate::git::cmd::version(None).is_err() {
        return;
    }
    let temp = TempDir::new("git");
    let dir = temp.path();
    let cwd = temp.spelled();

    // Not a checkout yet: no world to speak of.
    assert_eq!(take(&cwd, "git"), Ok(None));

    git(dir, &["init", "-b", "main"]);
    // A repository with no commit is still one.
    let empty = take(&cwd, "git").unwrap().unwrap();
    assert!(empty.starts_with("git:"));
    assert_eq!(empty.len(), "git:".len() + 16);

    std::fs::write(dir.join("one.txt"), "1").unwrap();
    git(dir, &["add", "."]);
    git(dir, &["commit", "-m", "one"]);
    let committed = take(&cwd, "git").unwrap().unwrap();
    assert_ne!(committed, empty);
    assert_eq!(take(&cwd, "git").unwrap().unwrap(), committed);

    // An edit to a tracked file, and then a further edit to the same file,
    // which `status` alone would read as the same.
    std::fs::write(dir.join("one.txt"), "2").unwrap();
    let edited = take(&cwd, "git").unwrap().unwrap();
    assert_ne!(edited, committed);
    std::fs::write(dir.join("one.txt"), "3").unwrap();
    let edited_again = take(&cwd, "git").unwrap().unwrap();
    assert_ne!(edited_again, edited);

    // A file nobody has added yet.
    std::fs::write(dir.join("one.txt"), "1").unwrap();
    assert_eq!(take(&cwd, "git").unwrap().unwrap(), committed);
    std::fs::write(dir.join("two.txt"), "2").unwrap();
    assert_ne!(take(&cwd, "git").unwrap().unwrap(), committed);
}

#[cfg(not(windows))]
#[test]
fn a_command_guard_hashes_what_it_says_and_how_it_exits() {
    let temp = TempDir::new("cmd");
    let cwd = temp.spelled();

    let one = take(&cwd, "cmd:echo one").unwrap().unwrap();
    assert!(one.starts_with("cmd:"));
    assert_eq!(take(&cwd, "cmd:echo one").unwrap().unwrap(), one);
    assert_ne!(take(&cwd, "cmd:echo two").unwrap().unwrap(), one);
    // Run in the directory it was asked about.
    std::fs::write(temp.path().join("here.txt"), "").unwrap();
    assert_eq!(
        take(&cwd, "cmd:ls").unwrap(),
        take(&cwd, "cmd:echo here.txt").unwrap()
    );
    // The same silence with a different exit is a different world.
    assert_ne!(
        take(&cwd, "cmd:true").unwrap(),
        take(&cwd, "cmd:false").unwrap()
    );
    assert_eq!(take(&cwd, "cmd:"), Err("empty-guard".to_string()));
    assert_eq!(take(&cwd, "svn"), Err("unknown-guard".to_string()));
}

#[test]
fn the_sessions_on_this_machine_are_read_by_their_first_lines() {
    let temp = TempDir::new("codex");
    let day = temp.path().join("sessions/2026/10/17");
    std::fs::create_dir_all(&day).unwrap();
    std::fs::write(
        day.join("rollout-2026-10-17T11-30-40-01a147b2.jsonl"),
        format!("{LINE}\n{{\"type\":\"response_item\"}}\n"),
    )
    .unwrap();
    std::fs::write(day.join("notes.txt"), "not a session").unwrap();

    let found = local(temp.path(), &[(2026, 10, 16), (2026, 10, 17)]);
    assert_eq!(found, vec![LINE.to_string()]);
}
