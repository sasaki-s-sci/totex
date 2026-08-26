//! Lists the agent put keys beside, which are answered by typing one of them.

use super::super::read;
use super::{asking_box, labels, screen_of};

#[test]
fn a_prompt_box_is_read_as_a_question_with_answers() {
    let found = read(&screen_of(&asking_box())).expect("the box is a question");

    assert_eq!(found.question, "Do you want to proceed?");
    assert_eq!(
        found.detail,
        vec![
            "Bash command".to_string(),
            "rm -rf build/".to_string(),
            "Remove the build directory".to_string(),
        ]
    );
    assert_eq!(
        found
            .choices
            .iter()
            .map(|choice| (choice.key.as_str(), choice.selected))
            .collect::<Vec<_>>(),
        vec![("1", true), ("2", false), ("3", false)]
    );
    assert_eq!(found.choices[1].label, "Yes, and don't ask again");
}

/// The one thing that tells a question from a list somebody wrote: what is
/// under it. An agent that has answered goes on drawing.
#[test]
fn a_numbered_list_with_the_conversation_under_it_is_not_a_question() {
    let mut text = asking_box();
    text.push_str("\r\n⏺ Removed the build directory.\r\n");
    text.push_str("╭──────────────────────────────────────────────╮\r\n");
    text.push_str("│ > Try \"fix the failing test\"                 │\r\n");
    text.push_str("╰──────────────────────────────────────────────╯\r\n");

    assert!(read(&screen_of(&text)).is_none());
}

/// The same thing on a screen an agent owns all of, where the drawing it rules
/// off is a long way above whatever it has since written.
///
/// What is under the list is still the whole of the answer: three lines of
/// what was being said, or the composer the agent goes back to waiting at.
/// Either of them means the list was written rather than offered, and neither
/// of them is any less true for the rule being twenty rows up.
#[test]
fn a_written_list_is_told_by_what_the_agent_went_on_to_draw() {
    let rule = "\u{2500}".repeat(52);
    let listed = |after: &str| {
        let mut drawn = String::from("\u{1b}[?1049h\u{1b}[?25l\u{1b}[2J\u{1b}[H");
        drawn.push_str(&format!("{rule}\r\n"));
        for line in 0..20 {
            drawn.push_str(&format!("⏺ a line of what was said, number {line}\r\n"));
        }
        drawn.push_str("Here are three ways to go about it:\r\n");
        drawn.push_str("  1. Rewrite the reader\r\n");
        drawn.push_str("  2. Patch the check\r\n");
        drawn.push_str("  3. Leave it alone\r\n");
        drawn.push_str(after);
        drawn
    };

    for after in [
        "One.\r\nTwo.\r\nThree.\r\n",
        "\u{276f} Try \"fix the failing test\"\r\n",
        "I would take the first.\r\n\u{276f} \r\n",
    ] {
        assert!(read(&screen_of(&listed(after))).is_none(), "{after:?}");
    }
}

/// A list that does not count from one was written rather than offered.
#[test]
fn a_list_that_does_not_count_from_one_is_not_a_question() {
    let text = [
        "Which of these did you mean?\r\n",
        "  2. the second one\r\n",
        "  3. the third one\r\n",
    ]
    .concat();

    assert!(read(&screen_of(&text)).is_none());
}

/// A question with nothing but its answers is still a question; what it cannot
/// be is a question with nothing to answer.
#[test]
fn one_answer_is_not_a_list() {
    let text = "Carry on?\r\n❯ 1. Yes\r\n";
    assert!(read(&screen_of(text)).is_none());
}

/// The whole reason the screen is followed rather than the stream: an agent
/// redraws its box by going back up over what it drew last.
#[test]
fn a_box_drawn_over_the_last_one_is_read_as_the_one_on_top() {
    let mut screen = screen_of(&asking_box());
    screen.feed("\u{1b}[12A\u{1b}[J");
    screen.feed(
        &[
            "╭──────────────────────────────────────────────╮\r\n",
            "│ Bash command                                 │\r\n",
            "│                                              │\r\n",
            "│   rm -rf build/                              │\r\n",
            "│   Remove the build directory                 │\r\n",
            "│                                              │\r\n",
            "│ Do you want to proceed?                      │\r\n",
            "│   1. Yes                                     │\r\n",
            "│ ❯ 2. Yes, and don't ask again                │\r\n",
            "│   3. No, and tell Claude what to do instead  │\r\n",
            "│                                              │\r\n",
            "╰──────────────────────────────────────────────╯\r\n",
        ]
        .concat(),
    );

    let found = read(&screen).expect("the box is still a question");
    assert_eq!(found.choices.len(), 3, "the old box was drawn over");
    assert!(found.choices[1].selected, "the selection moved");
    assert!(!found.choices[0].selected);
}

/// An answer too long for the box runs on under itself and is one answer, in
/// the colours an agent actually draws it in.
#[test]
fn an_answer_that_runs_on_is_still_one_answer() {
    let text = [
        "\u{256d}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{256e}\r\n",
        "\u{2502} \u{1b}[1mBash command\u{1b}[0m  \u{2502}\r\n",
        "\u{2502}                \u{2502}\r\n",
        "\u{2502}   rm -rf build/\u{2502}\r\n",
        "\u{2502}                \u{2502}\r\n",
        "\u{2502} Proceed?       \u{2502}\r\n",
        "\u{2502} \u{1b}[36m\u{276f} 1. Yes\u{1b}[0m      \u{2502}\r\n",
        "\u{2502}   2. Yes, and  \u{2502}\r\n",
        "\u{2502}      not again \u{2502}\r\n",
        "\u{2502}   3. No        \u{2502}\r\n",
        "\u{2570}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{256f}\r\n",
    ]
    .concat();

    let found = read(&screen_of(&text)).expect("the box is a question");
    assert_eq!(found.choices.len(), 3, "the run-on line is not an answer");
    assert_eq!(found.choices[1].label, "Yes, and not again");
    assert!(found.choices[0].selected, "the colour is not the answer");
    assert_eq!(
        found.detail,
        vec!["Bash command".to_string(), "rm -rf build/".to_string()]
    );
}

/// An agent that offers one way on has still stopped and asked, when the box
/// says that is what it is doing.
#[test]
fn one_answer_in_a_box_is_a_question() {
    let text = [
        "╭──────────────────────────────╮\r\n",
        "│ The plan is ready            │\r\n",
        "│                              │\r\n",
        "│ Shall I start?               │\r\n",
        "│ ❯ 1. Yes, go ahead           │\r\n",
        "╰──────────────────────────────╯\r\n",
    ]
    .concat();

    let found = read(&screen_of(&text)).expect("a question with one way on");
    assert_eq!(found.choices.len(), 1);
    assert_eq!(found.question, "Shall I start?");
}

/// The lists that count in letters, and the ones that count from nothing.
#[test]
fn a_list_may_count_in_letters_or_from_zero() {
    let letters = ["Which one?\r\n", "❯ a) keep it\r\n", "  b) drop it\r\n"].concat();
    let found = read(&screen_of(&letters)).expect("a lettered list");
    assert_eq!(found.taking, super::super::Taking::Key);
    assert_eq!(found.choices[1].key, "b");
    assert_eq!(labels(&found), vec!["keep it", "drop it"]);

    let zero = ["Which one?\r\n", "❯ 0. keep it\r\n", "  1. drop it\r\n"].concat();
    let found = read(&screen_of(&zero)).expect("a list counting from zero");
    assert_eq!(found.choices[0].key, "0");

    // And a list that begins in the middle of itself is still no list.
    let middle = ["Which one?\r\n", "❯ c) keep it\r\n", "  d) drop it\r\n"].concat();
    assert!(read(&screen_of(&middle)).is_none());
}
