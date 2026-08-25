//! What an answer is addressed to, and what it is not.

use super::super::Watcher;
use super::feed;
use crate::ask::tests::asking_box;

/// The same question is the same question every time it is read — a card
/// somebody is part way through answering is not refused because the agent
/// redrew the box under it — and anything that changes what the question says
/// is a different one.
#[test]
fn a_question_is_named_by_what_it_says() {
    let mut watcher = Watcher::new(24, 60);

    let first = feed(&mut watcher, &asking_box())
        .expect("the question is news")
        .expect("and it is being asked");

    // The very same screen again: nothing to say.
    assert!(feed(&mut watcher, "").is_none());

    // Answered, and the agent draws on. The card goes away.
    watcher.screen.feed("\u{1b}[2J\u{1b}[H");
    watcher.screen.feed("⏺ Removed the build directory.\r\n");
    assert_eq!(feed(&mut watcher, ""), Some(None));
    assert!(watcher.asking().is_none());

    // And a question that says something else is something else.
    let second = feed(
        &mut watcher,
        &asking_box().replace("rm -rf build/", "rm -rf src/"),
    )
    .expect("asked again")
    .expect("and being asked");
    assert_ne!(
        second.seq, first.seq,
        "an answer must not reach the wrong question"
    );
}

/// The unit of the claim `rederive` makes: nothing about a question's name comes
/// from the screen it was read off.
#[test]
fn the_same_question_read_on_another_screen_is_the_same_question() {
    let mut one = Watcher::new(24, 60);
    let mut two = Watcher::new(24, 60);

    let first = feed(&mut one, &asking_box()).unwrap().unwrap();
    // In one go rather than in runs, which is how a backlog arrives.
    let again = feed(&mut two, &asking_box()).unwrap().unwrap();

    assert_eq!(first, again);
}

#[test]
fn a_selection_moving_leaves_the_question_the_one_it_was() {
    let mut watcher = Watcher::new(24, 60);
    let first = feed(&mut watcher, &asking_box()).unwrap().unwrap();

    watcher.screen.feed("\u{1b}[2J\u{1b}[H");
    let moved = feed(
        &mut watcher,
        &asking_box().replace("│ ❯ 1. Yes", "│   1. Yes"),
    )
    .expect("the cursor moved")
    .expect("and it is still being asked");

    assert_eq!(moved.seq, first.seq, "the answer is still the same answer");
    assert!(!moved.choices[0].selected);
}

#[test]
fn an_answer_to_a_question_that_has_moved_on_is_refused() {
    let mut watcher = Watcher::new(24, 60);
    let ask = feed(&mut watcher, &asking_box()).unwrap().unwrap();

    assert!(!watcher.answered(ask.seq + 1), "not the question on screen");
    assert!(watcher.answered(ask.seq));
    assert!(watcher.asking().is_none(), "and it is put away at once");
}
