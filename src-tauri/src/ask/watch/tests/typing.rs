//! What is typed to walk, pick and answer, counted against the screen as it
//! stands at the moment of the press rather than as the card was drawn.

use super::super::Watcher;
use super::super::typing::{typing, walking};
use super::{feed, walking_box};
use crate::ask::Taking;

/// A list with no keys is answered from where the mark is standing, and from
/// where it is standing now: the same card pressed twice with the mark moved in
/// between is two different walks to the same answer.
#[test]
fn a_list_with_no_keys_is_answered_by_walking_the_mark() {
    let mut watcher = Watcher::new(24, 40);
    let ask = feed(&mut watcher, &walking_box(1))
        .expect("the question is news")
        .expect("and it is being asked");

    assert_eq!(ask.taking, Taking::Walk);
    assert_eq!(typing(&ask, "1").as_deref(), Some("\u{1b}[A\r"));
    assert_eq!(typing(&ask, "2").as_deref(), Some("\r"));
    assert_eq!(typing(&ask, "3").as_deref(), Some("\u{1b}[B\r"));
    assert!(typing(&ask, "4").is_none(), "there is no fourth answer");

    let moved = feed(&mut watcher, &walking_box(2))
        .expect("the mark moved")
        .expect("and it is still being asked");
    assert_eq!(moved.seq, ask.seq, "the answer is still the same answer");
    assert_eq!(typing(&moved, "1").as_deref(), Some("\u{1b}[A\u{1b}[A\r"));
}

/// The one place the two readings meet: an agent that puts a line to type on one
/// of its own rows is still drawing a keyed list, and the keys go on being what
/// takes an answer — until the mark stands in the row being typed into, when the
/// same key is a character in what is being written.
#[test]
fn a_key_is_not_an_answer_at_a_list_being_written_at() {
    let boxed = |caret: &str| {
        [
            "\u{1b}[?25l\u{1b}[2J\u{1b}[H",
            "\u{256d}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{256e}\r\n",
            "\u{2502} Proceed?                 \u{2502}\r\n",
            "\u{2502}   1. Yes                 \u{2502}\r\n",
            "\u{2502} \u{276f} 2. No, and say why    \u{2502}\r\n",
            "\u{2570}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{256f}\r\n",
            caret,
        ]
        .concat()
    };

    let mut watcher = Watcher::new(24, 40);
    let ask = feed(&mut watcher, &boxed(""))
        .expect("the question is news")
        .expect("and it is being asked");
    assert!(!ask.writing, "the caret is put away");
    assert_eq!(typing(&ask, "1").as_deref(), Some("1"));

    // The caret shown, standing in the answer that is a place to type.
    let writing = feed(&mut watcher, &boxed("\u{1b}[4;24H\u{1b}[?25h"))
        .expect("the caret moved into the list")
        .expect("and it is still being asked");
    assert_eq!(writing.seq, ask.seq, "still the same question");
    assert!(writing.writing);
    assert_eq!(typing(&writing, "1").as_deref(), Some("\u{1b}[A\r"));
    assert_eq!(typing(&writing, "2").as_deref(), Some("\r"));
}

/// A list several answers may be taken from. Both marks are carried and only one
/// names the question: the mark says where the walk has got to and the box says
/// what has been picked up on the way.
#[test]
fn picking_an_answer_up_leaves_the_question_the_one_it_was() {
    let picking = |held: [bool; 3]| {
        let answers = ["the reader", "the check", "the tests"];
        let mut drawn = String::from("\u{1b}[?1049h\u{1b}[?25l\u{1b}[2J\u{1b}[H");
        drawn.push_str("\u{256d}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{256e}\r\n");
        drawn.push_str("\u{2502} Which of these?      \u{2502}\r\n");
        for (at, answer) in answers.iter().enumerate() {
            let mark = if at == 0 { '\u{276f}' } else { ' ' };
            let box_mark = if held[at] { '\u{2612}' } else { '\u{2610}' };
            drawn.push_str(&format!(
                "\u{2502} {mark} {n}. {box_mark} {answer:<10} \u{2502}\r\n",
                n = at + 1
            ));
        }
        drawn.push_str("\u{2570}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{256f}\r\n");
        drawn
    };

    let mut watcher = Watcher::new(24, 40);
    let ask = feed(&mut watcher, &picking([false, false, false]))
        .expect("the question is news")
        .expect("and it is being asked");
    assert!(ask.picking);
    assert_eq!(ask.choices[0].label, "the reader");
    assert!(!ask.choices[0].picked);

    let held = feed(&mut watcher, &picking([false, true, false]))
        .expect("one was picked up")
        .expect("and it is still being asked");
    assert_eq!(held.seq, ask.seq, "the question is still the same question");
    assert!(held.choices[1].picked);
    assert!(!held.choices[0].picked);
}

/// Moving the mark is the walk an answer takes with the return left off, which
/// is the whole difference between the three: pointing walks, picking walks and
/// presses a space, answering walks and presses a return.
#[test]
fn a_mark_is_walked_without_the_return_that_would_answer() {
    let mut watcher = Watcher::new(24, 40);
    let ask = feed(&mut watcher, &walking_box(1))
        .expect("the question is news")
        .expect("and it is being asked");

    assert_eq!(walking(&ask, 0).as_deref(), Some("\u{1b}[A"));
    assert_eq!(walking(&ask, 1).as_deref(), Some(""));
    assert_eq!(walking(&ask, 2).as_deref(), Some("\u{1b}[B"));
    assert_eq!(typing(&ask, "3").as_deref(), Some("\u{1b}[B\r"));
}

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
