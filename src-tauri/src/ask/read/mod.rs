//! The question on a screen, if one is being asked.

mod lists;
mod prompt;

use super::glyph::{blank, is_dashed, is_edge, is_rule, is_top, typed_at, undressed};
use super::screen::{Screen, Standing};
use super::{Reading, choice::choice_of};

/// How many lines above a question are kept as what it is about. The box holds
/// a tool and its argument, never a document.
///
/// A limit on what is *kept*, and the only one there is: how far up the drawing
/// a question stands in reaches is the agent's business, and a question is not
/// less of one for being asked about something long.
const DETAIL_LIMIT: usize = 6;

/// How many lines of shortcuts — `esc to cancel` and its like — an agent may
/// set under its own drawing and still be asking. A third means something has
/// been drawn since, which means the question was answered.
const HINT_LINES: usize = 2;

/// How much of a question's own drawing may stand under the answers before any
/// of it has been closed off: the foot of a pane set beside the list, and a
/// line of what is in it. Only a question drawn in something is allowed any.
const PANEL_LINES: usize = 2;

/// How much drawing may cross a list without the list stopping being one: a
/// rule between two runs of answers, and the blank line on either side of it.
const BREAK_LINES: usize = 3;

/// Four readings, tried in the order a question is most surely told by: the
/// lists first, because a list under a question is the least mistakable thing
/// on a terminal, and the bare written answer last, because a line asking to be
/// typed at is the most easily confused with a line that is merely there.
pub fn read(screen: &Screen) -> Option<Reading> {
    let lines = screen.lines();
    let inner: Vec<&str> = lines.iter().map(|line| undressed(line)).collect();
    let standing = screen.standing();

    lists::keyed(&inner, &standing)
        .or_else(|| lists::marked(&inner, &standing))
        .or_else(|| prompt::confirmed(&inner, &standing))
        .or_else(|| prompt::written(&inner, &standing))
}

/// What a question is drawn in, as far as the lines above it say. Three rather
/// than two, because an agent that redraws its whole output rules a line above
/// its question instead of boxing it, and that is as much a framing as a box.
#[derive(Clone, Copy, Debug, PartialEq)]
enum Framing {
    Boxed,
    Ruled,
    Bare,
}

/// What is above a list, in the order the box says it: the question on the
/// nearest line with anything on it, then whatever was set above that.
fn asked_above(above: &[&str]) -> (Vec<String>, String, Framing) {
    let mut at = above.len();
    while at > 0 && blank(above[at - 1]) {
        at -= 1;
    }
    // A list that opens the box has no question above it and is still a
    // question — what it asks is then said by the answers alone.
    let question = match at.checked_sub(1) {
        Some(line) if !is_edge(above[line]) => {
            at = line;
            above[line].trim().to_string()
        }
        _ => String::new(),
    };
    let (detail, framing) = detail_above(above, at);
    (detail, question, framing)
}

/// What is set above a question, and what the whole of it is drawn in. The walk
/// stops at a box or solid rule, but crosses dashed rules drawn inside it.
///
/// It goes to the top of the screen rather than a set way up, because how far
/// above a question its frame stands is a fact about what is being asked rather
/// than about the asking: a command of one line puts the rule six rows up and a
/// command of twenty puts it twenty-five, and a question is not turned into
/// something else by the length of what it is about. What is kept off the way
/// is still `DETAIL_LIMIT`, so the card shows the same few lines either way, and
/// what says a question is being asked rather than lying answered on the screen
/// is what stands *under* the answers — see `last_thing`.
fn detail_above(above: &[&str], question: usize) -> (Vec<String>, Framing) {
    let mut detail = Vec::new();
    let mut framing = Framing::Bare;
    let mut dashed = false;
    let mut walk = question;

    while walk > 0 {
        walk -= 1;
        let line = above[walk];
        if is_dashed(line) {
            dashed = true;
            continue;
        }
        if is_edge(line) {
            // A box's foot above the question is somebody else's box.
            framing = if is_top(line) {
                Framing::Boxed
            } else if is_rule(line) {
                Framing::Ruled
            } else {
                Framing::Bare
            };
            break;
        }
        if blank(line) {
            continue;
        }
        if detail.len() < DETAIL_LIMIT {
            detail.push(line.trim().to_string());
        }
    }

    // Crossing a dashed rule means the question is framed even when its outer
    // edge has gone off the top of the screen.
    if framing == Framing::Bare && dashed {
        framing = Framing::Ruled;
    }
    if framing == Framing::Bare {
        return (Vec::new(), framing);
    }
    detail.reverse();
    (detail, framing)
}

/// Whether what was found is the question being asked rather than the wreckage
/// of one already answered.
///
/// On a screen that scrolls it is what stands under the question that says so:
/// nothing else happens until a question is answered, so room is left for the
/// line or two of shortcuts under a box and for nothing else. A ruled question
/// may also have its own drawing under it, closed off by the rule. A
/// full-screen program has no wreckage to tell apart but keeps its composer at
/// the foot of everything, so what is asked of one instead is a box round the
/// question and the caret put away.
fn last_thing(inner: &[&str], foot: usize, framing: Framing, standing: &Standing) -> bool {
    if nothing_since(inner, foot, framing) {
        return true;
    }
    standing.alt && framing == Framing::Boxed && !standing.shown
}

/// Whether what is under a question is its own drawing and no later output.
fn nothing_since(inner: &[&str], foot: usize, framing: Framing) -> bool {
    let mut closed = false;
    let mut drawing = PANEL_LINES;
    let mut spare = HINT_LINES;
    for line in &inner[foot + 1..] {
        if blank(line) {
            continue;
        }
        // Another box below: whatever is down there is what the agent is doing.
        if is_top(line) || choice_of(line).is_some() {
            return false;
        }
        // A composer below it means the agent has resumed after an answer.
        if typed_at(line.trim()) {
            return false;
        }
        if is_edge(line) {
            closed = true;
            continue;
        }
        if closed {
            if spare == 0 {
                return false;
            }
            spare -= 1;
        } else {
            // Still inside the drawing, which only a framed question may have.
            if framing == Framing::Bare || drawing == 0 {
                return false;
            }
            drawing -= 1;
        }
    }
    true
}
