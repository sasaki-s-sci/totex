//! Questions with no list under them, and the ones deliberately left alone.

use super::super::{Taking, read};
use super::screen_of;

/// The oldest way of asking anything at a terminal. The one printed in capitals
/// is the one a bare return takes.
#[test]
fn a_line_offering_yes_or_no_is_a_question() {
    let found = read(&screen_of("Delete the branch old-work? [y/N] ")).expect("a question");

    assert_eq!(found.taking, Taking::Line);
    assert_eq!(found.question, "Delete the branch old-work? [y/N]");
    assert_eq!(
        found
            .choices
            .iter()
            .map(|choice| (choice.key.as_str(), choice.label.as_str(), choice.selected))
            .collect::<Vec<_>>(),
        vec![("y", "Yes", false), ("n", "No", true)]
    );

    // Letters meaning something the line never says are left where they are
    // explained.
    assert!(read(&screen_of("Stage this hunk [y,n,q,a,d,e,?]? ")).is_none());
}

/// A question with nothing under it, which is answered by writing.
#[test]
fn a_line_asking_to_be_written_at_is_a_question() {
    let found = read(&screen_of("Enter a name for the branch: ")).expect("a question");

    assert_eq!(found.taking, Taking::Words);
    assert_eq!(found.question, "Enter a name for the branch:");
    assert!(found.choices.is_empty());

    // And the mark those libraries ask with, with the default left where it is.
    let asked = read(&screen_of("? What is your project named? › my-app")).expect("a question");
    assert_eq!(asked.taking, Taking::Words);
    assert_eq!(asked.question, "What is your project named?");
}

/// The whole difficulty of reading a written answer: a composer is a box with a
/// mark and a caret in it, which is what a question wanting words looks like,
/// and it stands there all day.
#[test]
fn a_composer_with_nothing_in_it_is_not_a_question() {
    let idle = [
        "╭──────────────────────────────────────────╮\r\n",
        "│ > Try \"fix the failing test\"             │",
    ]
    .concat();
    assert!(read(&screen_of(&idle)).is_none());

    // Nor is a shell at its own prompt, whatever the prompt says.
    assert!(read(&screen_of("~/repo/totex on main $ ")).is_none());
    assert!(read(&screen_of("bash-5.2$ printf 'Enter a name: ")).is_none());
    // Nor anything that stopped asking and went on writing.
    assert!(read(&screen_of("Enter a name: alpha\r\nDone.\r\n")).is_none());
    // Nor a question whose caret has been put away, which is being drawn rather
    // than asked.
    assert!(read(&screen_of("\u{1b}[?25lEnter a name: ")).is_none());
}

/// The one elicitation that is never drawn on a card.
#[test]
fn a_password_is_left_in_the_terminal() {
    assert!(read(&screen_of("Enter the deploy password: ")).is_none());
    assert!(read(&screen_of("[sudo] password for a: ")).is_none());
    assert!(read(&screen_of("Enter passphrase for key '/home/a/.ssh/id': ")).is_none());
}

#[test]
fn multiline_user_questions_are_not_asking_panels() {
    for marker in ["❯", "›", ">"] {
        for ending in ["does this work?", "Continue? [y/N]"] {
            let screen = super::screen_of(&format!("{marker} Please explain\r\n  {ending}"));
            assert!(super::super::read(&screen).is_none());
        }
    }
}

#[test]
fn user_numbered_lists_are_not_choices() {
    let screen = super::screen_of("› Please implement:\r\n  1. Read input\r\n  2. Show state");
    assert!(super::super::read(&screen).is_none());
}

#[test]
fn codex_multiline_input_with_blank_lines_is_not_elicitation() {
    for text in [
        "› Explain this\r\n\r\n  why does this fail?",
        "› Explain this\r\n\r\n  Continue? [y/N]",
        "› Implement this\r\n\r\n  Requirements:\r\n  1. Read input\r\n  2. Show state",
    ] {
        assert!(read(&screen_of(text)).is_none(), "{text}");
    }
}
