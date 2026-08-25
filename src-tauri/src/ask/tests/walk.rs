//! Lists with no keys on them, which are answered by walking the agent's mark,
//! and what an agent draws beside the answers it is holding.

use super::super::{Taking, read};
use super::{labels, screen_of};

/// What the agents built on a full-screen library draw: the answers are lines,
/// the one you are standing on has the mark, and there is nothing to press but
/// the arrows and return.
#[test]
fn a_list_with_no_keys_is_read_as_one_to_walk() {
    let text = [
        "\u{1b}[?1049h\u{1b}[?25l\u{1b}[2J\u{1b}[H",
        "╭────────────────────────────────╮\r\n",
        "│ rm -rf build/                  │\r\n",
        "│                                │\r\n",
        "│ Run this command?              │\r\n",
        "│   Allow once                   │\r\n",
        "│ ❯ Allow always                 │\r\n",
        "│   Deny                         │\r\n",
        "╰────────────────────────────────╯\r\n",
        "  esc to cancel                  \r\n",
    ]
    .concat();

    let found = read(&screen_of(&text)).expect("the box is a question");
    assert_eq!(found.taking, Taking::Walk);
    assert_eq!(found.question, "Run this command?");
    assert_eq!(found.detail, vec!["rm -rf build/".to_string()]);
    assert_eq!(
        found
            .choices
            .iter()
            .map(|choice| (choice.key.as_str(), choice.label.as_str(), choice.selected))
            .collect::<Vec<_>>(),
        vec![
            ("1", "Allow once", false),
            ("2", "Allow always", true),
            ("3", "Deny", false),
        ]
    );
}

/// The same shape a question-and-answer library draws on a screen that scrolls.
#[test]
fn a_list_walked_on_an_ordinary_screen_is_a_question_too() {
    let text = [
        "? Which template? (Use arrow keys)\r\n",
        "❯ TypeScript\r\n",
        "  JavaScript\r\n",
    ]
    .concat();

    let found = read(&screen_of(&text)).expect("a list to walk");
    assert_eq!(found.taking, Taking::Walk);
    assert_eq!(found.question, "? Which template? (Use arrow keys)");
    assert_eq!(labels(&found), vec!["TypeScript", "JavaScript"]);
    assert!(found.choices[0].selected);
}

/// Two lines typed into a composer are a mark on the first and the second lined
/// up under it, which is what a list with the mark on its first line looks
/// like. The caret tells them apart, and the cost of getting it wrong is a card
/// that sends somebody's half-written message by walking it.
#[test]
fn a_message_being_written_is_not_a_list_to_walk() {
    let composing = [
        "╭──────────────────────────────────────╮\r\n",
        "│ > the first thing I want             │\r\n",
        "│   and the second                     │",
    ]
    .concat();
    assert!(read(&screen_of(&composing)).is_none());

    // The same drawing with the caret away from it is a list again.
    let away = composing.clone() + "\u{1b}[?25l";
    assert!(read(&screen_of(&away)).is_some());
}

/// A paragraph of bullets marks every line; a list being chosen from marks the
/// one the agent is standing on.
#[test]
fn a_bulleted_paragraph_is_not_a_list_to_walk() {
    let text = [
        "Here is what I found:\r\n",
        "● the test was never run\r\n",
        "● the fixture is stale\r\n",
    ]
    .concat();

    assert!(read(&screen_of(&text)).is_none());
}

/// A list that takes several answers says so by drawing a box beside each.
#[test]
fn a_list_with_boxes_beside_it_is_one_to_pick_from() {
    let text = [
        "\u{256d}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{256e}\r\n",
        "\u{2502} Which of these?          \u{2502}\r\n",
        "\u{2502} \u{276f} 1. \u{2612} the first one   \u{2502}\r\n",
        "\u{2502}   2. \u{2610} the second one  \u{2502}\r\n",
        "\u{2502}   3. \u{2612} the third one   \u{2502}\r\n",
        "\u{2570}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{256f}\r\n",
    ]
    .concat();

    let found = read(&screen_of(&text)).expect("a list to pick from");
    assert!(found.picking);
    assert_eq!(found.choices[0].label, "the first one");
    assert_eq!(
        found
            .choices
            .iter()
            .map(|choice| choice.picked)
            .collect::<Vec<_>>(),
        vec![true, false, true]
    );

    // The same thing in the characters a terminal has always had.
    let plain = text.replace('\u{2612}', "[x]").replace('\u{2610}', "[ ]");
    let found = read(&screen_of(&plain)).expect("a list to pick from");
    assert!(found.picking);
    assert_eq!(found.choices[1].label, "the second one");
    assert!(!found.choices[1].picked);
}

/// A list that holds one answer marks it with a tick after the words, and is
/// not a list to pick from.
#[test]
fn a_tick_after_an_answer_is_the_one_being_held() {
    let text = [
        "\u{256d}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{256e}\r\n",
        "\u{2502} Which one?               \u{2502}\r\n",
        "\u{2502} \u{276f} 1. keep it \u{2714}         \u{2502}\r\n",
        "\u{2502}   2. drop it             \u{2502}\r\n",
        "\u{2570}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{256f}\r\n",
    ]
    .concat();

    let found = read(&screen_of(&text)).expect("a question");
    assert!(
        !found.picking,
        "one answer held is not several to pick from"
    );
    assert_eq!(found.choices[0].label, "keep it");
    assert!(found.choices[0].picked);
    assert!(!found.choices[1].picked);
}

/// Every agent offers a "tell it what to do instead" and nothing in the words
/// says which answer it is. The caret does: it stands on that row while that
/// row is the one being typed into, and nowhere in the list otherwise.
#[test]
fn the_answer_the_caret_stands_in_is_one_to_write_at() {
    let text = [
        "\u{256d}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{256e}\r\n",
        "\u{2502} Do you want to proceed?          \u{2502}\r\n",
        "\u{2502}   1. Yes                         \u{2502}\r\n",
        "\u{2502}   2. Yes, and don't ask again    \u{2502}\r\n",
        "\u{2502} \u{276f} 3. No, and tell it instead    \u{2502}\r\n",
        "\u{2570}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{256f}\r\n",
    ]
    .concat();

    let standing = read(&screen_of(&text)).expect("a question");
    assert!(!standing.writing, "the caret is under the box");

    // The caret put back into the third answer, which is what an agent does
    // with the one of them that is a place to type.
    let mut screen = screen_of(&text);
    screen.feed("\u{1b}[5;32H");
    let found = read(&screen).expect("a question");
    assert!(found.writing);
    assert!(found.choices[2].selected);
}
