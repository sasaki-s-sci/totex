//! What is typed at a session to act on the question it is asking.

use super::super::{Ask, Taking};

/// The keystrokes an answer is, rather than the answer: typing at it is the
/// only way a terminal has of being told anything, and the four kinds of
/// question are four different things to type.
pub(super) fn typing(ask: &Ask, key: &str) -> Option<String> {
    let at = ask.choices.iter().position(|choice| choice.key == key)?;
    Some(match ask.taking {
        // A key typed at a list whose mark stands in a row being written at is a
        // letter going into what has been written, not an answer. Such a list is
        // answered the way a list with no keys is: walked to, taken with return.
        Taking::Key => match ask.writing.then(|| walking(ask, at)).flatten() {
            Some(walk) => format!("{walk}\r"),
            None => ask.choices[at].key.clone(),
        },
        Taking::Line => format!("{}\r", ask.choices[at].key),
        Taking::Walk => format!("{}\r", walking(ask, at)?),
        // Words are written rather than pressed, and go by `pty_reply`.
        Taking::Words => return None,
    })
}

/// The arrow keys that carry the agent's own mark from where it is standing to
/// one of the answers, and nothing else.
///
/// How far to walk is a fact about the screen at the moment of the press — not
/// about the reading a card was drawn from, which by then is old enough for the
/// mark to have been walked in the terminal since. `None` when the agent is not
/// standing anywhere, the one case there is nothing to count from.
pub(super) fn walking(ask: &Ask, at: usize) -> Option<String> {
    let here = ask.choices.iter().position(|choice| choice.selected)?;
    let step = if at > here { "\u{1b}[B" } else { "\u{1b}[A" };
    Some(step.repeat(at.abs_diff(here)))
}

/// Where in the list an answer stands, for the acts that walk to it.
pub(super) fn answer_at(ask: &Ask, key: &str) -> Result<usize, String> {
    ask.choices
        .iter()
        .position(|choice| choice.key == key)
        .ok_or_else(|| "no-answer".to_string())
}

/// What may be sent of something written on a canvas: as often pasted as typed,
/// and a return in the middle of it would answer the question half way through.
pub(super) fn said(text: &str) -> String {
    text.chars().filter(|letter| !letter.is_control()).collect()
}
