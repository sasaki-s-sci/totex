//! One line of a list, read as an answer: which key it offers, what it says,
//! and what the agent has drawn round it.

use super::glyph::{MARKERS, TAKEN, TICKS, UNTAKEN, beside, blank, indent, is_edge};

/// What an agent printed beside an answer to have it answered by.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Key {
    Count(u32),
    Letter(char),
}

impl Key {
    /// Whether a list may open with this one. A list beginning anywhere else is
    /// the tail of one whose head has scrolled away.
    pub fn opens(self) -> bool {
        matches!(self, Key::Count(0 | 1) | Key::Letter('a' | 'A'))
    }

    /// The one that comes next, which is the only thing the list may say next.
    pub fn after(self) -> Option<Key> {
        Some(match self {
            Key::Count(number) => Key::Count(number.checked_add(1)?),
            Key::Letter(letter) => Key::Letter(char::from_u32(letter as u32 + 1)?),
        })
    }

    /// What is typed to take it, which is what the agent itself printed.
    pub fn printed(self) -> String {
        match self {
            Key::Count(number) => number.to_string(),
            Key::Letter(letter) => letter.to_string(),
        }
    }
}

/// What one line of a list says about the answer on it, beyond which one it is.
pub struct Marked {
    pub label: String,
    /// Where the agent's own mark stands.
    pub selected: bool,
    /// Whether the agent is holding this one as taken.
    pub picked: bool,
    /// Whether a box was drawn beside it, which says the list takes several.
    pub boxed: bool,
}

/// The answer on a line, with everything drawn round it taken off.
fn answer_on(text: &str, selected: bool) -> Option<Marked> {
    let (boxed, filled, rest) = match box_mark(text) {
        Some((filled, rest)) => (true, filled, rest),
        None => (false, false, text),
    };
    let (ticked, label) = tick_after(beside(rest));
    if label.is_empty() {
        return None;
    }
    Some(Marked {
        label: label.to_string(),
        selected,
        picked: filled || ticked,
        boxed,
    })
}

/// The box an agent drew beside an answer, if it drew one: whether it is filled
/// in, and what is left of the line after it.
fn box_mark(text: &str) -> Option<(bool, &str)> {
    if let Some(rest) = text.strip_prefix(TAKEN.as_slice()) {
        return Some((true, rest.trim_start()));
    }
    if let Some(rest) = text.strip_prefix(UNTAKEN.as_slice()) {
        return Some((false, rest.trim_start()));
    }
    // The same box in the characters a terminal has always had.
    for (open, shut) in [('[', ']'), ('(', ')')] {
        let Some(rest) = text.strip_prefix(open) else {
            continue;
        };
        let mut inside = rest.chars();
        let held = inside.next()?;
        if inside.next() != Some(shut) {
            return None;
        }
        let filled = match held {
            ' ' => false,
            'x' | 'X' | '*' => true,
            letter if TICKS.contains(&letter) => true,
            // Anything else in brackets is a word in brackets.
            _ => return None,
        };
        return Some((filled, inside.as_str().trim_start()));
    }
    None
}

/// The tick an agent set after the answer it is holding, taken off it. The
/// space in front is required, so an answer ending in a tick is left as written.
fn tick_after(label: &str) -> (bool, &str) {
    let text = label.trim_end();
    match text.strip_suffix(TICKS.as_slice()) {
        Some(rest) if rest.ends_with(' ') => (true, rest.trim_end()),
        _ => (false, text),
    }
}

/// One line of a keyed list, if that is what it is.
pub fn choice_of(line: &str) -> Option<(Key, Marked)> {
    let (key, selected, rest) = keyed_line(line)?;
    Some((key, answer_on(rest.trim(), selected)?))
}

/// Where in a line its key stands: the first letter or digit on it, since what
/// may come before a key is a mark and the spaces around it.
pub fn key_column(line: &str) -> Option<usize> {
    keyed_line(line)?;
    line.chars()
        .position(|letter| letter.is_ascii_alphanumeric())
}

/// The key at the head of a line, what marked it, and what follows it.
fn keyed_line(line: &str) -> Option<(Key, bool, &str)> {
    let mut rest = line.trim_start();
    let mut selected = false;
    if let Some(first) = rest.chars().next()
        && MARKERS.contains(&first)
    {
        selected = true;
        rest = rest[first.len_utf8()..].trim_start();
    }

    let digits: String = rest
        .chars()
        .take_while(|letter| letter.is_ascii_digit())
        .collect();
    let (key, after) = if digits.is_empty() {
        // One letter and no more: `a)` is a key and `as)` is a word.
        let letter = rest.chars().next()?;
        if !letter.is_ascii_alphabetic() {
            return None;
        }
        (Key::Letter(letter), &rest[letter.len_utf8()..])
    } else {
        // Two digits at the outside: a wider number is a line of a document.
        if digits.len() > 2 {
            return None;
        }
        (Key::Count(digits.parse().ok()?), &rest[digits.len()..])
    };

    let mut after = after.chars();
    if !matches!(after.next(), Some('.') | Some(')')) {
        return None;
    }
    let rest = after.as_str();
    // The space is part of the pattern: `1.5` is a number, `1. Yes` an answer.
    if !rest.starts_with(' ') {
        return None;
    }

    Some((key, selected, rest))
}

/// The column a marked line's words start at, for a line the agent has put its
/// own mark on.
pub fn marked_at(line: &str) -> Option<usize> {
    // A keyed list is answered by its keys, and is read as one.
    if keyed_line(line).is_some() {
        return None;
    }
    let rest = line.trim_start();
    let first = rest.chars().next()?;
    if !MARKERS.contains(&first) {
        return None;
    }
    let after = &rest[first.len_utf8()..];
    let words = after.trim_start();
    let gap = after.chars().count() - words.chars().count();
    // A space between the mark and the words: `> quoted` is a mark and
    // `>redirected` is not.
    if gap == 0 || words.is_empty() {
        return None;
    }
    Some(indent(line) + 1 + gap)
}

/// One line of an unkeyed list, if it is one of a run standing at a column.
pub fn item_at(line: &str, column: usize) -> Option<Marked> {
    if blank(line) || is_edge(line) || keyed_line(line).is_some() {
        return None;
    }
    let words = line.trim_start();
    match words.chars().next() {
        Some(first) if MARKERS.contains(&first) => {
            if marked_at(line)? != column {
                return None;
            }
            answer_on(words[first.len_utf8()..].trim(), true)
        }
        _ => {
            if indent(line) != column {
                return None;
            }
            answer_on(words.trim_end(), false)
        }
    }
}
