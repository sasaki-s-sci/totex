//! Carrying what a child process says to whoever is listening.
//!
//! Anything that streams hands over very little at a time: an agent writing a
//! token, a shell echoing a keystroke, a prompt being drawn. A read comes back
//! with a byte or two, hundreds of times a second. Passing each of those on as
//! it arrives is what makes output stutter — every message crosses a socket and
//! then a window as a script for it to evaluate, on the same thread that draws —
//! so the cost is paid per character rather than per screenful.
//!
//! Reading and handing over are therefore separated. The reader never waits on
//! the listener, and what it reads is gathered for a fraction of a frame before
//! it goes: a stream arriving a character at a time then costs one message a
//! frame instead of one a character, and a burst costs one message instead of
//! a hundred. Nothing is delayed by more than a frame, which is the soonest
//! any of it could have been seen.

use std::io::Read;
use std::sync::mpsc::{self, RecvTimeoutError};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

/// How long output is gathered before it is handed over. Under a frame, so
/// nothing waits on it visibly.
const WINDOW: Duration = Duration::from_millis(8);

/// How much is gathered before it goes without waiting out the window. A
/// screenful at a time keeps the window drawing while the rest is still
/// coming, rather than arriving as one enormous message at the end.
const ENOUGH: usize = 64 * 1024;

/// What one read asks for. A pty hands over far less than this at a time; a
/// process redirecting a file hands over all of it.
const READ_SIZE: usize = 8192;

/// Reads `source` to its end, handing over what it says in batches.
///
/// `send` is called from a thread of its own, and returns false when there is
/// no longer anyone to hand anything to — which ends the read. The returned
/// handle finishes once everything the source said has been handed over.
pub fn pump<S, F>(mut source: S, send: F) -> JoinHandle<()>
where
    S: Read + Send + 'static,
    F: Fn(String) -> bool + Send + 'static,
{
    let (tx, rx) = mpsc::channel::<Vec<u8>>();

    // Reading blocks until the process says something, and handing over blocks
    // on the listener: neither is allowed to hold up the other.
    thread::spawn(move || {
        let mut buffer = [0u8; READ_SIZE];
        loop {
            match source.read(&mut buffer) {
                Ok(0) | Err(_) => break,
                Ok(read) => {
                    if tx.send(buffer[..read].to_vec()).is_err() {
                        break;
                    }
                }
            }
        }
    });

    thread::spawn(move || {
        let mut held: Vec<u8> = Vec::new();
        // Nothing to hand over and nothing to hold up: the first of a batch is
        // waited for however long it takes.
        while let Ok(first) = rx.recv() {
            held.extend_from_slice(&first);

            // Whatever else the process says within the window goes with it.
            let until = Instant::now() + WINDOW;
            let mut ended = false;
            while held.len() < ENOUGH {
                let left = until.saturating_duration_since(Instant::now());
                if left.is_zero() {
                    break;
                }
                match rx.recv_timeout(left) {
                    Ok(more) => held.extend_from_slice(&more),
                    Err(RecvTimeoutError::Timeout) => break,
                    Err(RecvTimeoutError::Disconnected) => {
                        ended = true;
                        break;
                    }
                }
            }

            let text = take_text(&mut held);
            if !text.is_empty() && !send(text) {
                return;
            }
            if ended {
                break;
            }
        }

        // The source has ended, so a character that never finished arriving
        // never will: what is left over is said as it is rather than dropped.
        if !held.is_empty() {
            send(String::from_utf8_lossy(&held).into_owned());
        }
    })
}

/// The bytes that make whole characters, leaving one that has not all arrived
/// yet for the next batch to finish.
///
/// A read lands wherever the process happened to stop, which for anything not
/// written in ASCII is regularly halfway through a character — so decoding
/// each batch on its own would turn that half into a replacement mark every
/// few kilobytes. The tail waits instead. Bytes that are not the start of a
/// character at all are still replaced: they are never going to become one.
fn take_text(held: &mut Vec<u8>) -> String {
    let whole = match std::str::from_utf8(held) {
        Ok(_) => held.len(),
        // No length on the error means the input simply stops mid-character.
        Err(error) if error.error_len().is_none() => error.valid_up_to(),
        // A byte that cannot begin a character is not worth holding on to.
        Err(_) => held.len(),
    };
    let rest = held.split_off(whole);
    let text = String::from_utf8_lossy(held).into_owned();
    *held = rest;
    text
}

#[cfg(test)]
mod tests {
    use std::sync::mpsc;

    use super::*;

    /// Collects everything a pump hands over, in order.
    fn drain(source: impl Read + Send + 'static) -> String {
        let (tx, rx) = mpsc::channel();
        pump(source, move |text| tx.send(text).is_ok())
            .join()
            .expect("the pump finishes");
        rx.into_iter().collect()
    }

    #[test]
    fn everything_the_source_said_comes_out_in_order() {
        let said = "one\ntwo\nthree\n".repeat(4096);
        assert_eq!(drain(std::io::Cursor::new(said.clone())), said);
    }

    #[test]
    fn a_character_split_across_reads_survives_whole() {
        // Wide enough to be split by any read boundary, and long enough that
        // there are boundaries to split it at.
        let said = "\u{3042}\u{3044}\u{3046}\u{3048}\u{304a}".repeat(16_384);
        let seen = drain(std::io::Cursor::new(said.clone()));
        assert!(!seen.contains('\u{fffd}'), "a character was cut in half");
        assert_eq!(seen, said);
    }

    #[test]
    fn a_character_that_never_finishes_arriving_is_still_said() {
        // The first two bytes of a three-byte character, and then nothing.
        let seen = drain(std::io::Cursor::new(vec![b'a', 0xE3, 0x81]));
        assert_eq!(seen, "a\u{fffd}");
    }

    #[test]
    fn output_arriving_a_character_at_a_time_is_gathered_up() {
        /// A source that says one byte per read, as a pty does under a stream.
        struct Trickle(std::vec::IntoIter<u8>);
        impl Read for Trickle {
            fn read(&mut self, out: &mut [u8]) -> std::io::Result<usize> {
                match self.0.next() {
                    Some(byte) => {
                        out[0] = byte;
                        Ok(1)
                    }
                    None => Ok(0),
                }
            }
        }

        let said = "a stream, one byte at a time".repeat(64);
        let (tx, rx) = mpsc::channel();
        pump(
            Trickle(said.clone().into_bytes().into_iter()),
            move |text| tx.send(text).is_ok(),
        )
        .join()
        .expect("the pump finishes");

        let batches: Vec<String> = rx.into_iter().collect();
        assert_eq!(batches.concat(), said);
        assert!(
            batches.len() < said.len() / 8,
            "{} bytes went out as {} messages",
            said.len(),
            batches.len()
        );
    }

    #[test]
    fn a_listener_that_has_gone_away_ends_the_read() {
        // Endless output, and nobody to hand it to: the pump has to stop by
        // itself rather than read forever.
        struct Endless;
        impl Read for Endless {
            fn read(&mut self, out: &mut [u8]) -> std::io::Result<usize> {
                out.fill(b'.');
                Ok(out.len())
            }
        }

        pump(Endless, |_| false).join().expect("the pump gives up");
    }
}
