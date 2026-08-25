//! The two readings that find a question with no list under it at all.

use super::super::glyph::{before_field, blank, ends_asking, secret, typed_at, words};
use super::super::screen::Standing;
use super::super::{Choice, Reading, Taking};
use super::asked_above;

/// A question with the answers written into the end of it: `[y/N]` and its like.
///
/// The oldest way of asking anything at a terminal, and the whole of it is on
/// one line. What says it is live is the caret sitting at the end of that line.
pub fn confirmed(inner: &[&str], standing: &Standing) -> Option<Reading> {
    let line = at_the_caret(inner, standing)?;
    if typed_at(line.trim()) {
        return None;
    }
    let choices = yes_or_no(line)?;
    let (detail, _, _) = asked_above(&inner[..standing.row]);

    Some(Reading {
        detail,
        question: line.trim().to_string(),
        taking: Taking::Line,
        picking: false,
        writing: false,
        choices,
    })
}

/// A question with nothing under it, which is answered by writing something.
///
/// The hardest of the four to be sure of, because what it looks like is a line
/// of text with a caret after it — and so does every shell prompt and every
/// idle composer. Two shapes are taken: a line opening with the `? ` those
/// question-and-answer libraries all print, and a line ending the way a
/// question ends with at least two words in front of it.
pub fn written(inner: &[&str], standing: &Standing) -> Option<Reading> {
    let line = at_the_caret(inner, standing)?;
    let text = line.trim();
    if secret(text) {
        return None;
    }

    let question = match text.strip_prefix('?') {
        // What follows a second mark is the default they have written in,
        // which is theirs to redraw and not the card's to repeat.
        Some(rest) if rest.starts_with(' ') && !rest.trim().is_empty() => before_field(rest.trim()),
        _ => {
            if typed_at(text) || words(text) < 2 || !ends_asking(text) {
                return None;
            }
            text.to_string()
        }
    };
    if question.is_empty() {
        return None;
    }

    let (detail, _, _) = asked_above(&inner[..standing.row]);
    Some(Reading {
        detail,
        question,
        taking: Taking::Words,
        picking: false,
        // The whole question is a place to write; `writing` is about one row of
        // a list being one, which this has none of.
        writing: false,
        choices: Vec::new(),
    })
}

/// The line the caret stands at the end of, with nothing drawn under it. A
/// prompt is being asked only while the place to answer it is where the caret
/// is; an agent that has moved on took the caret with it.
fn at_the_caret<'a>(inner: &[&'a str], standing: &Standing) -> Option<&'a str> {
    if !standing.shown || !standing.clear {
        return None;
    }
    let line = inner.get(standing.row)?;
    if blank(line) {
        return None;
    }
    inner[standing.row + 1..]
        .iter()
        .all(|line| blank(line))
        .then_some(*line)
}

/// The two answers written into the end of a line, held to exactly the two: a
/// `[y,n,a,q,d]` means things the line never says, and is left in the terminal
/// where whoever presses `?` will be told what they are.
fn yes_or_no(line: &str) -> Option<Vec<Choice>> {
    let text = line.trim_end();
    // The last bracketed group, with nothing after it but ending punctuation.
    let open = text.rfind(['[', '('])?;
    let shut = open + 1 + text[open + 1..].find([']', ')'])?;
    if !text[shut + 1..]
        .chars()
        .all(|letter| matches!(letter, ' ' | ':' | '?' | '.'))
    {
        return None;
    }

    let offered: Vec<&str> = text[open + 1..shut]
        .split(['/', ',', '|'])
        .map(str::trim)
        .collect();
    let said: Vec<String> = offered.iter().map(|word| word.to_lowercase()).collect();
    let words: Vec<&str> = said.iter().map(String::as_str).collect();
    if !matches!(
        words[..],
        ["y", "n"] | ["n", "y"] | ["yes", "no"] | ["no", "yes"]
    ) {
        return None;
    }

    // Which one a bare return takes, said by printing that one in capitals.
    // Both in capitals is neither, which is what `[Y/N]` means.
    let capitals = offered
        .iter()
        .filter(|word| word.starts_with(char::is_uppercase))
        .count();

    Some(
        offered
            .iter()
            .zip(said.iter())
            .map(|(printed, said)| Choice {
                key: said.clone(),
                // The two words the line did not print, ours because a
                // bracketed letter is not something to read.
                label: if said.starts_with('y') { "Yes" } else { "No" }.to_string(),
                selected: capitals == 1 && printed.starts_with(char::is_uppercase),
                // Pressing either is the end: there is nothing to be holding.
                picked: false,
            })
            .collect(),
    )
}
