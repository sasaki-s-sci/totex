//! What is kept of a session left running all day.

use super::super::backlog::{Backlog, KEPT, SLACK};

/// What a session says is counted in full, and what is kept is the end of it,
/// beginning where a line begins.
#[test]
fn a_long_session_keeps_its_tail_and_counts_the_whole() {
    let mut backlog = Backlog::default();
    let line = "a line of output\n";
    assert_eq!(backlog.keep(line), 0, "the first run starts at nothing");

    let runs = 40_000;
    let mut at = 0;
    for _ in 1..runs {
        at = backlog.keep(line);
    }

    assert_eq!(backlog.said, line.len() * runs);
    assert_eq!(at, backlog.said - line.len());
    assert!(backlog.text.len() <= KEPT + SLACK);
    assert!(backlog.text.len() >= KEPT);
    assert!(
        backlog.text.starts_with(line),
        "the tail begins part way through a line: {:?}",
        &backlog.text[..line.len().min(backlog.text.len())]
    );
}

/// Output with no line breaks in it at all — a full-screen program redrawing
/// itself. There is nowhere tidy to cut, and the one thing the cut must not do
/// is land inside a character.
#[test]
fn the_tail_is_cut_between_characters() {
    let mut backlog = Backlog::default();
    backlog.keep(&"\u{3042}".repeat(200_000));
    assert!(backlog.text.len() <= KEPT + SLACK);
    assert!(
        backlog.text.chars().all(|letter| letter == '\u{3042}'),
        "a character was cut in half"
    );
}
