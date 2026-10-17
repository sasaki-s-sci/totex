//! What a screen rebuilt out of a backlog says about the program on it: the
//! same agent the live screen said, however the backlog was cut.

use super::super::Watcher;

#[test]
fn replay_preserves_agent_identity() {
    for agent in ["codex", "claude", "opencode"] {
        let mut watcher = Watcher::new(24, 60);
        let text =
            format!("$ {agent}\r\n\x1b[?1004h\x1b[2J\x1b[H› fix the bug\r\nesc to interrupt");
        watcher.replay(&text, text.len());
        assert_eq!(watcher.doing(), crate::ask::Doing::Working);
        assert_eq!(watcher.typed(), Some("fix the bug"));
    }
}

#[test]
fn replay_preserves_an_agent_command_split_across_rows() {
    for agent in ["claude", "codex", "opencode"] {
        let mut watcher = Watcher::new(24, 40);
        let text = format!(
            "user@host:/{}$ {agent}\r\n\x1b[?1004h\x1b[2J\x1b[H› fix the bug\r\nesc to interrupt",
            "d".repeat(26)
        );
        watcher.replay(&text, text.len());
        assert_eq!(watcher.doing(), crate::ask::Doing::Working, "{agent}");
        assert_eq!(watcher.typed(), Some("fix the bug"));
    }
}

/// A backlog keeps the tail of what was said, and an agent says what it is only
/// at the head: the line that ran it, and the mode it set coming up.
#[test]
fn a_cut_backlog_is_read_as_the_agent_that_was_kept() {
    let head = "$ claude\r\n\x1b[?1004h";
    let tail = "\x1b[2J\x1b[H› fix the bug\r\nesc to interrupt";

    let mut before = Watcher::new(24, 60);
    before.replay(&format!("{head}{tail}"), head.len() + tail.len());
    let taken = before.taken().expect("the agent has the terminal");

    let mut cut = Watcher::new(24, 60);
    cut.replay(tail, head.len() + tail.len());
    assert_eq!(cut.doing(), crate::ask::Doing::Running, "nothing says so");

    let mut resumed = Watcher::new(24, 60);
    resumed.resume(&taken);
    resumed.replay(tail, head.len() + tail.len());
    assert_eq!(resumed.doing(), crate::ask::Doing::Working);
    assert!(!resumed.retaken(), "and it stands as it was kept");
}

/// What the tail does say is read over what was kept.
#[test]
fn an_agent_that_left_in_the_tail_is_not_kept_standing() {
    let mut before = Watcher::new(24, 60);
    let head = "$ claude\r\n\x1b[?1004h";
    before.replay(head, head.len());
    let taken = before.taken().expect("the agent has the terminal");

    let tail = "› bye\r\n\x1b[?1004l\r\n$ ";
    let mut resumed = Watcher::new(24, 60);
    resumed.resume(&taken);
    resumed.replay(tail, 400_000);
    assert_eq!(resumed.doing(), crate::ask::Doing::Idle);
    assert!(resumed.taken().is_none());
}
