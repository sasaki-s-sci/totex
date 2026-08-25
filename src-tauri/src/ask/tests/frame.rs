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
    // What stands between the rule and the question is inside the drawing.
    assert_eq!(found.detail, vec!["←  Q1  ✔ Submit  →".to_string()]);
}

/// A full-screen question drawn in place of the agent's composer.
fn ruled_question(on: usize, caret: (usize, usize)) -> String {
    let rule = "\u{2500}".repeat(58);
    let answers = [
        ("Rewrite the reader", "Start from the screen again"),
        ("Patch the check", "Leave the shape alone"),
        ("Hold it as it is", "Nothing changes today"),
    ];
    let mut drawn = String::from("\u{1b}[?1049h\u{1b}[?25l\u{1b}[2J\u{1b}[H");
    drawn.push_str("\u{25cf} Right, here we go.\r\n");
    drawn.push_str(&format!("{rule}\r\n"));
    drawn.push_str(" \u{2610} Approach\r\n\r\n");
    drawn.push_str("Which approach should we take for the reader?\r\n\r\n");
    for (at, (answer, under)) in answers.iter().enumerate() {
        let mark = if at == on { '\u{276f}' } else { ' ' };
        drawn.push_str(&format!("{mark} {}. {answer}\r\n", at + 1));
        drawn.push_str(&format!("     {under}\r\n"));
    }
    let mark = if on == 3 { '\u{276f}' } else { ' ' };
    drawn.push_str(&format!("{mark} 4. Type something.\r\n"));
    drawn.push_str(&format!("{rule}\r\n"));
    let mark = if on == 4 { '\u{276f}' } else { ' ' };
    drawn.push_str(&format!("{mark} 5. Chat about this\r\n\r\n"));
    drawn.push_str("Enter to select · ↑/↓ to navigate · Esc to cancel\r\n");
    let (row, col) = caret;
    drawn.push_str(&format!("\u{1b}[{};{}H", row + 1, col + 1));
    drawn
}

#[test]
fn a_question_a_full_screen_agent_drew_in_place_of_its_composer_is_a_question() {
    let found = read(&screen_of(&ruled_question(0, (6, 0)))).expect("the rules are a question");

    assert_eq!(
        found.question,
        "Which approach should we take for the reader?"
    );
    assert_eq!(found.taking, Taking::Key);
    assert_eq!(
        found
            .choices
            .iter()
            .map(|choice| (choice.key.as_str(), choice.label.as_str()))
            .collect::<Vec<_>>(),
        vec![
            ("1", "Rewrite the reader Start from the screen again"),
            ("2", "Patch the check Leave the shape alone"),
            ("3", "Hold it as it is Nothing changes today"),
            ("4", "Type something."),
            ("5", "Chat about this"),
        ]
    );
    assert!(found.choices[0].selected);
    assert_eq!(found.detail, vec!["☐ Approach".to_string()]);
    assert!(!found.writing);
}

#[test]
fn the_caret_in_among_the_words_is_a_row_being_written_at() {
    let found = read(&screen_of(&ruled_question(3, (12, 5)))).expect("still a question");
    assert!(found.writing);
    assert!(found.choices[3].selected);

    let found = read(&screen_of(&ruled_question(4, (14, 0)))).expect("still a question");
    assert!(!found.writing);
    assert!(found.choices[4].selected);
}

#[test]
fn a_diff_between_dashed_rules_is_what_the_question_is_about() {
    let rule = "\u{2500}".repeat(58);
    let dashes = "\u{254c}".repeat(58);
    let text = [
        "\u{1b}[?1049h\u{1b}[?25l\u{1b}[2J\u{1b}[H",
        "\u{25cf} Write(notes.txt)\r\n\r\n",
        &format!("{rule}\r\n"),
        " Create file\r\n",
        " notes.txt\r\n",
        &format!("{dashes}\r\n"),
        "  1 one\r\n",
        "  2 two\r\n",
        "  3 three\r\n",
        &format!("{dashes}\r\n"),
        " Do you want to create notes.txt?\r\n",
        " \u{276f} 1. Yes\r\n",
        "   2. Yes, and switch to accept edits for this session\r\n",
        "   3. No\r\n",
        "\r\n",
        " Esc to cancel · Tab to amend\r\n",
    ]
    .concat();

    let found = read(&screen_of(&text)).expect("the prompt is a question");
    assert_eq!(found.question, "Do you want to create notes.txt?");
    assert_eq!(found.choices.len(), 3);
    assert_eq!(
        found.detail,
        vec![
            "Create file".to_string(),
            "notes.txt".to_string(),
            "1 one".to_string(),
            "2 two".to_string(),
            "3 three".to_string(),
        ]
    );

    let long = text.replace(
        "  2 two\r\n",
        &(1..14)
            .map(|line| format!("  {line} more\r\n"))
            .collect::<String>(),
    );
    let found = read(&screen_of(&long)).expect("still a question");
    assert_eq!(found.question, "Do you want to create notes.txt?");
    assert_eq!(found.choices.len(), 3);

    let mut screen = screen_of(&text);
    screen.feed("\u{25cf} Wrote notes.txt\r\n\r\n");
    screen.feed(&format!("{rule}\r\n\u{276f} \r\n{rule}\r\n"));
    screen.feed("  \u{23f8} manual mode on · ? for shortcuts\r\n");
    assert!(read(&screen).is_none());
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
