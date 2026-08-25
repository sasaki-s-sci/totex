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
