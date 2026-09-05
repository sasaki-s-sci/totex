//! The two readings that find a list of answers drawn under a question.

use super::super::choice::{Key, choice_of, item_at, key_column, marked_at};
use super::super::glyph::{beside, blank, indent, is_edge, is_rule, typed_at};
use super::super::screen::Standing;
use super::super::{Choice, Reading, Taking};
use super::{BREAK_LINES, Framing, asked_above, last_thing};

/// A list the agent put keys beside, answered by typing one of them.
///
/// The shape is a list counting from its own first key at the foot of the box
/// it is drawn in, with the question above it — all of it required, because a
/// keyed list is also how an agent writes out three suggestions mid-answer, and
/// the difference is that a question is the last thing on the screen.
pub fn keyed(inner: &[&str], standing: &Standing) -> Option<Reading> {
    // The last keyed list, taken from its foot upwards: an agent that has asked
    // twice has answered the first, and what is left above is history.
    let end = inner.iter().rposition(|line| choice_of(line).is_some())?;
    // Where the keys stand, which is what tells the rest of an answer too long
    // for one line from the question above the list.
    let column = key_column(inner[end])?;
    let runs = |line: &str| !blank(line) && !is_edge(line) && indent(line) > column;

    let start = head_of(inner, end, runs);
    // The last answer runs on the same way as the ones above it.
    let mut foot = end;
    while foot + 1 < inner.len() && runs(inner[foot + 1]) {
        foot += 1;
    }

    let (choices, picking) = counted(&inner[start..=foot])?;
    let (detail, question, framing) = asked_above(&inner[..start]);
    // A list written inside a user turn is not an interactive question.
    if typed_at(question.trim()) && !choices.iter().any(|choice| choice.selected) {
        return None;
    }
    // One answer is a question when the box says so, and nothing at all when it
    // is a line of somebody's answer that happens to begin with a number.
    if choices.len() < 2 && framing != Framing::Boxed {
        return None;
    }
    if !last_thing(inner, foot, framing, standing) {
        return None;
    }

    Some(Reading {
        detail,
        question,
        taking: Taking::Key,
        picking,
        writing: written_at(standing, start..=foot, column),
        choices,
    })
}

/// Whether the caret is in the writable part of a keyed answer row.
///
/// A cursor parked for list navigation stands at the head of the row. A cursor
/// accepting text stands past the key, among the words where input will land;
/// some agents hide that cursor while keeping its position.
fn written_at(standing: &Standing, rows: std::ops::RangeInclusive<usize>, key: usize) -> bool {
    rows.contains(&standing.row) && standing.col > key
}

/// Upwards to the head of the list, over anything drawn across it on the way.
fn head_of(inner: &[&str], end: usize, runs: impl Fn(&str) -> bool) -> usize {
    let mut start = end;
    loop {
        let mut above = start;
        let mut crossed = 0;
        while above > 0
            && crossed < BREAK_LINES
            && (blank(inner[above - 1]) || is_rule(inner[above - 1]))
        {
            above -= 1;
            crossed += 1;
        }
        if above == 0 {
            break;
        }
        // The rest of an answer runs on directly under it, never across a break.
        if choice_of(inner[above - 1]).is_some() || (crossed == 0 && runs(inner[above - 1])) {
            start = above - 1;
            continue;
        }
        break;
    }
    start
}

/// The answers on those lines, in order from the first key of their kind. A
/// list that is not in order was written rather than offered.
fn counted(lines: &[&str]) -> Option<(Vec<Choice>, bool)> {
    let mut choices: Vec<Choice> = Vec::new();
    let mut counted: Option<Key> = None;
    let mut picking = false;
    for line in lines {
        // The agent's own drawing, neither an answer nor the rest of one.
        if blank(line) || is_edge(line) {
            continue;
        }
        match choice_of(line) {
            Some((key, marked)) => {
                let due = match counted {
                    Some(last) => last.after() == Some(key),
                    None => key.opens(),
                };
                if !due {
                    return None;
                }
                counted = Some(key);
                // A box beside any of them is a box beside all of them.
                picking |= marked.boxed;
                choices.push(Choice {
                    key: key.printed(),
                    label: marked.label,
                    selected: marked.selected,
                    picked: marked.picked,
                });
            }
            // The rest of the answer above it, with the line break taken out.
            None => run_on(&mut choices, line)?,
        }
    }
    Some((choices, picking))
}

/// A list with no keys on it, answered by walking the agent's own mark.
///
/// The shape is a run of lines whose words all begin at the same column with
/// the mark on exactly one of them — which is what tells a list being offered
/// from a bulleted paragraph, where every line is marked.
pub fn marked(inner: &[&str], standing: &Standing) -> Option<Reading> {
    let mark = inner.iter().rposition(|line| marked_at(line).is_some())?;
    let column = marked_at(inner[mark])?;
    let runs = |line: &str| !blank(line) && !is_edge(line) && indent(line) > column;

    let mut start = mark;
    while start > 0 && (item_at(inner[start - 1], column).is_some() || runs(inner[start - 1])) {
        start -= 1;
    }
    let mut foot = mark;
    while foot + 1 < inner.len()
        && (item_at(inner[foot + 1], column).is_some() || runs(inner[foot + 1]))
    {
        foot += 1;
    }

    let mut choices: Vec<Choice> = Vec::new();
    let mut picking = false;
    for line in &inner[start..=foot] {
        match item_at(line, column) {
            Some(marked) => {
                picking |= marked.boxed;
                choices.push(Choice {
                    // Where it stands, because the agent gave it nothing else to
                    // be called by; the walk is counted when the press comes.
                    key: (choices.len() + 1).to_string(),
                    label: marked.label,
                    selected: marked.selected,
                    picked: marked.picked,
                });
            }
            None => run_on(&mut choices, line)?,
        }
    }
    if choices.len() < 2 {
        return None;
    }
    // Exactly one, or there is nowhere to walk from.
    if choices.iter().filter(|choice| choice.selected).count() != 1 {
        return None;
    }
    // And the caret is not in it. A composer with two lines typed into it is a
    // mark on the first and the second lined up under it — the caret is the
    // only difference, and getting it wrong sends a half-written message.
    if standing.shown && (start..=foot).contains(&standing.row) {
        return None;
    }

    let (detail, question, framing) = asked_above(&inner[..start]);
    if !last_thing(inner, foot, framing, standing) {
        return None;
    }

    Some(Reading {
        detail,
        question,
        taking: Taking::Walk,
        picking,
        writing: false,
        choices,
    })
}

/// An answer that ran on to the next line, joined back onto the one above it.
fn run_on(choices: &mut [Choice], line: &str) -> Option<()> {
    let choice = choices.last_mut()?;
    choice.label.push(' ');
    choice.label.push_str(beside(line));
    Some(())
}
