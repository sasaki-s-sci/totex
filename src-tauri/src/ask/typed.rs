//! The last thing typed at a session, read off the same screen its questions
//! are.
//!
//! A terminal has no interface to be asked what somebody typed into it, so this
//! is read the way a question is: off the drawing, because the drawing is the
//! only place it exists. What comes back is one line — the command a shell was
//! given, or the turn an agent was handed — and it is drawn beside the terminal
//! only while Ctrl is held, as what tells one mark in a stack from another.
//!
//! Two readings, and the order matters. What is being typed *now* is on the
//! caret's own line, which is where a shell's prompt and an agent's composer
//! both are. What was typed *last* is wherever the agent echoed it back into
//! its own transcript, and that is only ever a line opening with a turn mark —
//! never a line an agent wrote about what it has been doing, which is where a
//! reading that took any sigil anywhere would land instead.
//!
//! Neither survives the screen scrolling, and neither has to: the watcher holds
//! on to the last one that was read, so a session whose turn has long gone off
//! the top still says what it was given. See `Watcher::remember`.

use super::choice::choice_of;
use super::glyph::{SIGILS, blank, secret, undressed};
use super::screen::Screen;

/// What a line opens with when what follows it was typed by whoever is at the
/// terminal.
///
/// `MARKERS` beside the question reader has `●` in it too, because an agent
/// draws that against the answer it is standing on. It is left out here: the
/// same character opens every line of what an agent says it has done, and a
/// reading that took those would say `Listing 1 directory…` where somebody
/// asked for a directory to be listed.
const OPENERS: [char; 5] = ['❯', '>', '▶', '›', '»'];

/// The last thing typed at this session, if any of it is still drawn.
pub fn typed(screen: &Screen) -> Option<String> {
    let said = at_the_caret(screen).or_else(|| in_the_transcript(screen))?;
    // The same rule the cards are held to: nothing that names a secret is drawn
    // on a canvas somebody may well be sharing.
    (!secret(&said)).then_some(said)
}

/// What is being typed at this moment: the caret's own line, up to where the
/// caret is standing.
///
/// Up to the caret rather than the whole line, because the rest of it is not
/// what anybody typed — an agent's composer draws its own invitation after the
/// place the words go, and a shell that has redrawn its prompt over a longer
/// one leaves the tail of it lying there.
///
/// Whether the caret is being *drawn* is not asked. An agent hides it and moves
/// it about behind its own drawing, and it is still standing at the end of what
/// has been typed while somebody is typing — which is the moment this reading
/// is for.
///
/// And moving it about behind its own drawing is why the line has to be the
/// lowest place to type on the screen. An agent redrawing its transcript parks
/// the caret half way along a line it is in the middle of writing — `⎿  $ ls`,
/// with the rest of the command still to come — and that line has a place to
/// type on it by every test there is. What it does not have is the composer
/// *under* it, which is where anybody typing at this session would be typing.
fn at_the_caret(screen: &Screen) -> Option<String> {
    let standing = screen.standing();
    let lines = screen.lines();
    if lines
        .iter()
        .skip(standing.row + 1)
        .any(|line| a_place_to_type(undressed(line)))
    {
        return None;
    }
    let line = screen.upto(standing.row, standing.col);
    if standing.alt && standing.shown && line.trim_start().starts_with('▌') {
        return written(undressed(&line)).map(str::to_string);
    }
    if let Some(said) = prompted(undressed(&line)) {
        return Some(said.to_string());
    }
    if blank(undressed(&line))
        || choice_of(undressed(&line)).is_some()
        || !undressed(&line).starts_with(' ')
    {
        return None;
    }
    // Continuation rows retain the composer marker on an earlier row.
    let mut continuation = vec![undressed(&line).trim().to_string()];
    for previous in lines[..standing.row].iter().rev() {
        let previous = undressed(previous);
        if blank(previous) || super::glyph::is_edge(previous) {
            break;
        }
        if let Some(first) = opened(previous) {
            continuation.push(first.to_string());
            continuation.reverse();
            return Some(continuation.join("\n"));
        }
        if !previous.starts_with(' ') {
            break;
        }
        continuation.push(previous.trim().to_string());
    }
    None
}

/// Whether a line is somewhere to type at all, whether or not anything has been
/// typed there. An agent's composer standing empty is one of these.
fn a_place_to_type(line: &str) -> bool {
    line.trim()
        .chars()
        .next()
        .is_some_and(|first| OPENERS.contains(&first))
}

/// What was typed last: the lowest line of the screen that an agent has echoed
/// a turn onto.
///
/// From the foot upwards, because a transcript is read downwards and the last
/// turn is the one nearest the composer. A composer with nothing in it is one
/// of these lines with nothing after the mark, so it is passed over rather than
/// read as an empty answer.
fn in_the_transcript(screen: &Screen) -> Option<String> {
    screen
        .lines()
        .iter()
        .rev()
        .find_map(|line| opened(undressed(line)).map(str::to_string))
}

/// What follows the place to type on a line, wherever that place is.
///
/// A prompt is a line with somewhere to type at the end of it, and what is in
/// front of that is the shell's own — the machine, the directory, the branch.
/// So the first sigil with a space after it is where the prompt stops and what
/// was typed begins. The first rather than the last: a command may well have a
/// `>` in it, and the redirection in `cargo build > log` is part of what was
/// typed rather than another prompt.
fn prompted(line: &str) -> Option<&str> {
    let text = line.trim();
    if choice_of(text).is_some() {
        return None;
    }
    let sigil = |letter: char| OPENERS.contains(&letter) || SIGILS.contains(&letter);
    for (at, letter) in text.char_indices() {
        if !sigil(letter) {
            continue;
        }
        let Some(said) = text[at + letter.len_utf8()..].strip_prefix(' ') else {
            continue;
        };
        return written(said);
    }
    None
}

/// What follows the mark a line opens with, for a line that opens with one.
///
/// Only at the head, and only these marks: this reading walks a whole screen of
/// whatever an agent has drawn, and a sigil allowed anywhere on any line would
/// find one in half of it.
fn opened(line: &str) -> Option<&str> {
    let text = line.trim();
    if choice_of(text).is_some() {
        return None;
    }
    let first = text.chars().next()?;
    if !OPENERS.contains(&first) {
        return None;
    }
    written(text[first.len_utf8()..].strip_prefix(' ')?)
}

/// What is left when a place to type has nothing in it, which is nothing.
fn written(said: &str) -> Option<&str> {
    let said = said.trim();
    (!blank(said)).then_some(said)
}
