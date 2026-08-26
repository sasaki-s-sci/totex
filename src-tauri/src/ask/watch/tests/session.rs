//! The road between a running shell and the window: the pty, the seam its
//! output comes over, the screen it is followed into, the event, and the answer
//! going back the other way.

#![cfg(unix)]

use std::sync::mpsc;

use tauri::Listener;

use super::super::answer::{pty_answer, pty_reply};
use super::super::{ASK_EVENT, rederive};
use super::{answering, asking_now, draw_box, mock_app, wait_asked, wait_for};
use crate::pty;

/// Opens a shell with a listener on the ask event, and hands back both.
macro_rules! session {
    ($handle:ident, $id:ident, $rx:ident) => {
        let app = mock_app();
        let $handle = app.handle().clone();
        answering(&$handle, &$id);
        let (tx, $rx) = mpsc::channel();
        $handle.listen(ASK_EVENT, move |event| {
            let _ = tx.send(event.payload().to_string());
        });
        pty::spawn::pty_open(
            $handle.clone(),
            $id.clone(),
            std::env::temp_dir().display().to_string(),
            24,
            80,
            None,
        )
        .expect("the shell starts");
    };
}

/// A question that wants words: the window is told it is being asked for words
/// rather than a key, and a press is refused because there is nothing to press.
#[test]
fn a_question_that_wants_words_is_answered_by_writing_at_it() {
    let id = "writing".to_string();
    session!(handle, id, rx);
    pty::pty_write(
        handle.clone(),
        id.clone(),
        "printf '\\nWhat shall the branch be called: '; read name; sleep 30\n".to_string(),
    )
    .expect("the shell takes input");

    let Some(said) = wait_for(&rx, |ask| ask["taking"] == "words") else {
        pty::control::pty_close(handle.clone(), id.clone());
        panic!("the window was never told words were being asked for");
    };
    let ask = &said["ask"];
    assert_eq!(
        ask["question"],
        serde_json::json!("What shall the branch be called:")
    );
    assert_eq!(ask["choices"].as_array().map(Vec::len), Some(0));

    let seq = ask["seq"].as_u64().expect("the question is named");
    assert!(
        pty_answer(handle.clone(), id.clone(), seq, "1".to_string()).is_err(),
        "a question with nothing to press took a press"
    );
    assert!(
        pty_reply(handle.clone(), id.clone(), seq, "alpha".to_string()).is_ok(),
        "the answer was refused"
    );
    // And again, at a question nobody is asking any more.
    assert!(
        pty_reply(handle.clone(), id.clone(), seq, "alpha".to_string()).is_err(),
        "an answer to a question that has been answered went through"
    );

    pty::control::pty_close(handle.clone(), id.clone());
}

/// The box is printed rather than an agent run: what an agent actually draws is
/// the reading's own business, and is tested beside it.
#[test]
fn a_question_drawn_in_a_session_reaches_the_window_and_is_answered() {
    let id = "asking".to_string();
    session!(handle, id, rx);
    draw_box(&handle, &id);

    let Some(said) = wait_asked(&rx) else {
        pty::control::pty_close(handle.clone(), id.clone());
        panic!("the window was never told a question was being asked");
    };
    let ask = &said["ask"];
    assert_eq!(said["id"], serde_json::json!(id));
    assert_eq!(ask["question"], serde_json::json!("Proceed?"));
    assert_eq!(ask["choices"][0]["key"], serde_json::json!("1"));
    assert_eq!(ask["choices"][1]["label"], serde_json::json!("No"));
    assert_eq!(ask["choices"].as_array().map(Vec::len), Some(2));

    let seq = ask["seq"].as_u64().expect("the question is named");
    assert!(
        pty_answer(handle.clone(), id.clone(), seq, "1".to_string()).is_ok(),
        "the answer was refused"
    );
    // The same answer again, now for a question nobody is asking: this is what
    // stops a press landing on whatever came next.
    assert!(
        pty_answer(handle.clone(), id.clone(), seq, "1".to_string()).is_err(),
        "an answer to a question that has been answered went through"
    );

    pty::control::pty_close(handle.clone(), id.clone());
}

/// A press the session does nothing about puts the question back.
///
/// The card goes at the press, and what brings one back is the agent drawing
/// again — so a key an agent does not read would take a question off the graph
/// and leave it standing at the terminal, where nobody can see it. Drawn here
/// with the echo turned off, which is what makes a keystroke land and nothing
/// at all come of it.
#[test]
fn a_press_nothing_came_of_puts_the_question_back() {
    let id = "unread".to_string();
    session!(handle, id, rx);
    pty::pty_write(handle.clone(), id.clone(), "stty -echo\n".to_string())
        .expect("the shell takes input");
    draw_box(&handle, &id);

    let Some(said) = wait_asked(&rx) else {
        pty::control::pty_close(handle.clone(), id.clone());
        panic!("the window was never told a question was being asked");
    };
    let seq = said["ask"]["seq"].as_u64().expect("the question is named");

    assert!(
        pty_answer(handle.clone(), id.clone(), seq, "1".to_string()).is_ok(),
        "the answer was refused"
    );
    // Which is the card gone: the window is told so at the press.
    let back = wait_for(&rx, |ask| ask["seq"].as_u64() == Some(seq));
    pty::control::pty_close(handle.clone(), id.clone());
    assert!(
        back.is_some(),
        "a question the press did nothing about never came back"
    );
}

/// And an answer that named a question the session has moved on from says what
/// is being asked instead, for the same reason: the card was taken off the
/// graph at the press, and a refusal that said nothing would leave the graph
/// short of a question somebody still has to answer.
#[test]
fn an_answer_the_question_moved_on_from_says_what_is_being_asked_now() {
    let id = "moved".to_string();
    session!(handle, id, rx);
    draw_box(&handle, &id);

    let Some(said) = wait_asked(&rx) else {
        pty::control::pty_close(handle.clone(), id.clone());
        panic!("the window was never told a question was being asked");
    };
    let stale = said["ask"]["seq"].as_u64().expect("the question is named");

    // The agent asks something else, and the window is a moment behind it.
    pty::pty_write(handle.clone(), id.clone(), "\u{3}".to_string()).expect("the shell is stopped");
    pty::pty_write(
        handle.clone(),
        id.clone(),
        "printf '\\n\\u256d\\u2500\\u2500\\u2500\\u256e\\n\\u2502 Delete it? \\u2502\\n\\u2502 \\u276f 1. Yes \\u2502\\n\\u2502   2. No  \\u2502\\n\\u2570\\u2500\\u2500\\u2500\\u256f\\n'; sleep 30\n".to_string(),
    )
    .expect("the shell takes input");
    let asked_now = wait_for(&rx, |ask| {
        ask["question"] == serde_json::json!("Delete it?")
    });
    assert!(asked_now.is_some(), "the second question was never read");
    while rx.try_recv().is_ok() {}

    let refused = pty_answer(handle.clone(), id.clone(), stale, "1".to_string());
    let told = wait_for(&rx, |ask| {
        ask["question"] == serde_json::json!("Delete it?")
    });
    pty::control::pty_close(handle.clone(), id.clone());

    assert!(refused.is_err(), "an answer to the wrong question went in");
    assert!(
        told.is_some(),
        "a refused answer left the window without a question to draw"
    );
}

/// The boundary itself: everything on this side is thrown away while a session
/// stands on a question, and the question comes back under the same name — so
/// the card the window drew before any of it is still the card that answers it.
#[test]
fn the_reading_can_be_thrown_away_and_taken_again() {
    let id = "rebuilt".to_string();
    session!(handle, id, rx);
    draw_box(&handle, &id);

    let Some(said) = wait_asked(&rx) else {
        pty::control::pty_close(handle.clone(), id.clone());
        panic!("the window was never told a question was being asked");
    };
    let before = said["ask"].clone();
    let seq = before["seq"].as_u64().expect("the question is named");

    rederive(&handle);

    let running = pty::running(&handle);
    assert!(
        running.iter().any(|session| session.id == id),
        "the session went with the reading of it"
    );

    let after = asking_now(&handle, &id).expect("the question came back");
    assert_eq!(after, before, "the question came back as a different one");

    // Answered with the number the window has held since before any of this.
    assert!(
        pty_answer(handle.clone(), id.clone(), seq, "1".to_string()).is_ok(),
        "a card drawn before the rebuild could no longer be answered"
    );

    pty::control::pty_close(handle.clone(), id.clone());
}

/// Nothing about a session is the window's to remember: what is running is only
/// ever true where the processes are.
#[test]
fn what_is_running_is_asked_for_rather_than_remembered() {
    let app = mock_app();
    let handle = app.handle().clone();
    let id = "found".to_string();
    let cwd = std::env::temp_dir().display().to_string();

    pty::spawn::pty_open(
        handle.clone(),
        id.clone(),
        cwd.clone(),
        24,
        80,
        Some("{\"branch\":\"main\"}".to_string()),
    )
    .expect("the shell starts");

    let running = pty::running(&handle);
    let found = running
        .iter()
        .find(|session| session.id == id)
        .expect("the session is running");
    assert_eq!(found.cwd, cwd);
    assert_eq!(found.meta.as_deref(), Some("{\"branch\":\"main\"}"));

    pty::control::pty_close(handle.clone(), id.clone());
}
