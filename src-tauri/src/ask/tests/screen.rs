//! Erasing, scrolling and the cursor being sent about: what a screen is for.

use super::super::Screen;

#[test]
fn the_screen_follows_what_it_is_told_to_do() {
    let mut screen = Screen::new(3, 10);
    screen.feed("one\r\ntwo\r\nthree\r\nfour");
    assert_eq!(screen.lines(), vec!["two", "three", "four"], "it scrolled");

    // Back to the top and over the first row.
    screen.feed("\u{1b}[1;1Hnine\u{1b}[K");
    assert_eq!(screen.lines(), vec!["nine", "three", "four"]);

    // A line wider than the screen carries on onto the next one.
    let mut narrow = Screen::new(2, 4);
    narrow.feed("abcdef");
    assert_eq!(narrow.lines(), vec!["abcd", "ef"]);
}

/// Output arrives in runs of whatever the process happened to write, and a
/// sequence split across two of them is still one sequence.
#[test]
fn a_sequence_split_between_two_runs_still_arrives() {
    let mut screen = Screen::new(3, 10);
    screen.feed("one\r\ntwo");
    screen.feed("\u{1b}[1");
    screen.feed(";1Hten");
    assert_eq!(screen.lines(), vec!["ten", "two", ""]);
}

#[test]
fn logical_lines_join_only_automatic_wraps_and_include_the_last_column() {
    let mut screen = Screen::new(3, 5);
    screen.feed("$ codex");
    assert_eq!(screen.before_caret(), "$ codex");
    screen.feed("123");
    assert_eq!(screen.before_caret(), "$ codex123");
    screen.feed("\r\nnext");
    assert_eq!(screen.before_caret(), "next");
}

#[test]
fn logical_lines_survive_scrolling_and_forget_erased_rows() {
    let mut screen = Screen::new(3, 5);
    screen.feed("old\r\n$ codex1234");
    assert_eq!(screen.before_caret(), "$ codex1234");
    screen.feed("\x1b[2J\x1b[Hnew\x1b[2;1Htext");
    assert_eq!(screen.before_caret(), "text");

    screen.feed("\x1b[2J\x1b[H$ codex\r\x1b[2Ktext");
    assert_eq!(screen.before_caret(), "text");
}
