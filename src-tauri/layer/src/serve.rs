//! Being asked down a pipe rather than called.
//!
//! What a downloaded layer runs as. One line of JSON in, one line of JSON out,
//! and the line carries the number the question came in under so that answers
//! can come back in whatever order they finish in — a listing of a directory
//! inside a distribution takes as long as that distribution takes, and holding
//! every other question behind it would make a replaceable layer slower than a
//! built-in one, which is not a trade anybody would take.
//!
//! The end of the conversation is the end of the pipe. Nothing here watches for
//! the program above to go away: when it does, the pipe closes, the read below
//! ends, and this process ends with it. That is the same answer for a program
//! that exited, one that crashed, and one that put a newer layer in front of
//! this one and let go — which is what makes it the only one worth having.

use std::io::{BufRead, BufReader, Read, Write};
use std::sync::{Arc, Mutex};

use serde::Deserialize;
use serde_json::{Value, json};

use crate::call::{answer, hello};

/// One question, as it arrives.
#[derive(Deserialize)]
struct Asked {
    /// What the answer will be marked with on the way back.
    id: u64,
    /// The name of the question -- see [`crate::ANSWERS`].
    #[serde(rename = "do")]
    command: String,
    #[serde(default, rename = "with")]
    with: Value,
}

/// Answers questions off `input` until it ends.
///
/// `version` is what this layer says it is, which the program above compares
/// with what it asked for: a directory of the wrong version is a download that
/// went somewhere unexpected, and it is worth finding out at the handshake
/// rather than by the answers being subtly from the wrong build.
pub fn serve(version: &str, input: impl Read, output: impl Write + Send + 'static) {
    let out = Arc::new(Mutex::new(output));
    say(&out, &hello(version));

    let mut lines = BufReader::new(input).lines();
    let mut asking = Vec::new();
    while let Some(Ok(line)) = lines.next() {
        if line.trim().is_empty() {
            continue;
        }
        let Ok(asked) = serde_json::from_str::<Asked>(&line) else {
            // A line that is not a question cannot be answered to anybody in
            // particular, because the number it would be answered under is the
            // part that would not read. Dropped rather than guessed at.
            continue;
        };
        let out = Arc::clone(&out);
        // A thread rather than a queue: every question in the table is a
        // blocking read of a disk that may be somebody else's.
        asking.push(std::thread::spawn(move || {
            let Asked { id, command, with } = asked;
            say(&out, &wrote(id, answer(&command, with)));
        }));
    }

    // The pipe has closed, which is the program above having gone. Whatever was
    // still being read is finished rather than abandoned: the answers go
    // nowhere now, but a half-written file is not a thing to leave behind.
    for thread in asking {
        let _ = thread.join();
    }
}

/// One answer, as it goes back.
fn wrote(id: u64, answer: Option<Result<Value, String>>) -> Value {
    match answer {
        Some(Ok(said)) => json!({ "id": id, "said": said }),
        Some(Err(but)) => json!({ "id": id, "but": but }),
        // Not this layer's question. The program above has one of its own to
        // ask -- see `answer`.
        None => json!({ "id": id, "unknown": true }),
    }
}

/// Writes one line, or gives up on the pipe.
///
/// A write that fails is the program above having closed the pipe mid-answer,
/// which is the same ending the read loop is already walking towards.
fn say(out: &Mutex<impl Write>, line: &Value) {
    let Ok(mut out) = out.lock() else {
        return;
    };
    let _ = serde_json::to_writer(&mut *out, line);
    let _ = out.write_all(b"\n");
    let _ = out.flush();
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::call::{ANSWERS, PROTOCOL};

    /// Everything one round of the conversation says back.
    fn asked(questions: &str) -> Vec<Value> {
        let out: Arc<Mutex<Vec<u8>>> = Arc::new(Mutex::new(Vec::new()));
        // The writer the loop is handed and the one read afterwards are the
        // same buffer, which is what an anonymous pipe is in one process.
        struct Shared(Arc<Mutex<Vec<u8>>>);
        impl Write for Shared {
            fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
                self.0.lock().expect("the buffer").write(bytes)
            }
            fn flush(&mut self) -> std::io::Result<()> {
                Ok(())
            }
        }
        serve("0.0.0", questions.as_bytes(), Shared(Arc::clone(&out)));
        let written = out.lock().expect("the buffer").clone();
        String::from_utf8(written)
            .expect("lines of JSON")
            .lines()
            .map(|line| serde_json::from_str(line).expect("a line of JSON"))
            .collect()
    }

    #[test]
    fn a_layer_says_what_it_is_before_it_is_asked_anything() {
        let said = asked("");
        assert_eq!(said.len(), 1);
        assert_eq!(said[0]["layer"]["version"], "0.0.0");
        assert_eq!(said[0]["layer"]["protocol"], PROTOCOL);
        assert_eq!(
            said[0]["layer"]["answers"].as_array().map(Vec::len),
            Some(ANSWERS.len())
        );
    }

    #[test]
    fn a_question_comes_back_under_the_number_it_was_asked_under() {
        let said = asked("{\"id\":7,\"do\":\"list_roots\",\"with\":{}}\n");
        assert_eq!(said.len(), 2);
        assert_eq!(said[1]["id"], 7);
        assert!(said[1]["said"].is_array(), "every machine has a root");
    }

    #[test]
    fn a_question_this_layer_does_not_answer_is_said_to_be_none_of_its_own() {
        let said = asked("{\"id\":1,\"do\":\"pty_open\",\"with\":{}}\n");
        assert_eq!(said[1], json!({ "id": 1, "unknown": true }));
    }

    #[test]
    fn a_question_that_went_wrong_comes_back_as_the_reason() {
        let said = asked("{\"id\":2,\"do\":\"read_directory\",\"with\":{}}\n");
        assert_eq!(said[1]["id"], 2);
        assert!(said[1]["but"].is_string());
    }

    #[test]
    fn a_line_that_is_not_a_question_is_dropped_rather_than_answered() {
        let said = asked("not json\n{\"id\":3,\"do\":\"list_roots\",\"with\":{}}\n");
        assert_eq!(said.len(), 2, "the hello and the one answer");
        assert_eq!(said[1]["id"], 3);
    }
}
