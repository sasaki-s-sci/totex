//! What a question is drawn in: a box, a rule, a pane beside the answers, or a
//! screen the program owns all of.

use super::super::{Taking, read};
use super::{full_screen_box, labels, screen_of};

/// A box round Japanese text is only square if the wide characters in it take
/// the two columns they are drawn in.
#[test]
fn wide_characters_take_two_columns() {
    let text = [
        "╭────────────────────────────╮\r\n",
        "│ 実行してよいですか?         │\r\n",
        "│ ❯ 1. はい                   │\r\n",
        "│   2. いいえ                 │\r\n",
        "╰────────────────────────────╯\r\n",
    ]
    .concat();

    let found = read(&screen_of(&text)).expect("a question in Japanese");
    assert_eq!(found.question, "実行してよいですか?");
    assert_eq!(labels(&found), vec!["はい", "いいえ"]);
}

/// The rule that a question is the last thing drawn is a rule about a screen
/// that scrolls. A program drawing the whole screen every frame has no wreckage
/// to tell apart and its own composer under everything, so what is asked of it
/// instead is a box round the question and the caret put away.
#[test]
fn a_box_a_full_screen_program_drew_is_read_under_its_own_composer() {
    let found = read(&screen_of(&full_screen_box())).expect("the box is a question");

    assert_eq!(found.question, "Allow this command to run?");
    assert_eq!(found.detail, vec!["cargo test --all".to_string()]);
    assert_eq!(found.taking, Taking::Key);
    assert_eq!(found.choices.len(), 3);
    assert!(found.choices[0].selected);

    // The very same drawing on a screen that scrolls is three lines of
    // something drawn since, which is a question that has been answered.
    let scrolling = full_screen_box().replace("\u{1b}[?1049h", "");
    assert!(read(&screen_of(&scrolling)).is_none());
}

/// A question drawn between two rules instead of in a box: what an agent that
/// redraws its whole output puts on the screen, with the rest of its own
/// drawing under the answers rather than nothing at all.
#[test]
fn a_question_between_two_rules_is_a_question() {
    let rule = "\u{2500}".repeat(52);
    let text = [
        "\r\n",
        &format!("{rule}\r\n"),
        "\u{2190}  Q1  \u{2714} Submit  \u{2192}\r\n",
        "Which approach do you want?\r\n",
        "\r\n",
        "\u{276f} 1. Rewrite the reader\r\n",
        "  2. Patch the check\r\n",
        "  3. Other\r\n",
        "\r\n",
        &format!("{rule}\r\n"),
        "  4. Chat about this\r\n",
        "\r\n",
        "  enter select \u{b7} tab switch questions \u{b7} escape cancel\r\n",
    ]
    .concat();

    let found = read(&screen_of(&text)).expect("a question between two rules");
    assert_eq!(found.question, "Which approach do you want?");
    assert_eq!(found.taking, Taking::Key);
    // The answer under the rule is one of the answers: the rule between them is
    // a line drawn, not a list ended.
    assert_eq!(
        labels(&found),
        vec![
            "Rewrite the reader",
            "Patch the check",
            "Other",
            "Chat about this",
        ]
    );
    assert!(found.choices[0].selected);
    // Nothing above the question is what it is about: there is no box.
    assert!(found.detail.is_empty());
}

/// The same question with a pane of its own beside the answers, drawn on the
/// same rows — so an answer read off a row comes away with the pane's side and
/// whatever it says stuck to it.
#[test]
fn a_pane_beside_the_answers_is_not_part_of_them() {
    let rule = "\u{2500}".repeat(52);
    let text = [
        "\r\n",
        &format!("{rule}\r\n"),
        "\u{2190}  Q1  \u{2714} Submit  \u{2192}\r\n",
        "Which approach do you want?\r\n",
        "\r\n",
        "\u{276f} 1. Rewrite the reader   \u{256d}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{256e}\r\n",
        "  2. Patch the check      \u{2502} none \u{2502}\r\n",
        "  3. Other                \u{2570}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{256f}\r\n",
        "\r\n",
        "                          Notes: press n\r\n",
        "\r\n",
        &format!("{rule}\r\n"),
        "  Chat about this\r\n",
        "\r\n",
        "  enter select \u{b7} escape cancel\r\n",
    ]
    .concat();

    let found = read(&screen_of(&text)).expect("a question with a pane beside it");
    assert_eq!(found.question, "Which approach do you want?");
    assert_eq!(
        labels(&found),
        vec!["Rewrite the reader", "Patch the check", "Other"],
    );
}
