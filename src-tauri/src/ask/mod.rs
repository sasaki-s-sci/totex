//! What an agent running in a terminal is asking, read off the screen it drew
//! it on.
//!
//! The agents all stop and ask the same kind of question — may I run this, may
//! I write that, which of these did you mean, what shall I call it — and every
//! one of them draws it the same way: a box at the foot of the screen holding
//! what it is about, the question itself, and the way of answering it under
//! that. That box is the one thing in a session that is not output at all. It
//! is a turn: nothing else happens until somebody takes it, and until then the
//! window has no way of saying so except by drawing the terminal it happens to
//! be inside.
//!
//! So it is read here instead. There is no interface to ask — a terminal is a
//! stream of bytes for drawing with — which leaves the drawing itself as the
//! only place the question exists. The stream is followed into a screen, the
//! screen is looked at whenever it changes, and what is found on it is handed
//! to the window as a question with answers rather than as a picture of one.
//!
//! There are four ways a question offers to be taken and all four are read.
//! A numbered list is taken by its own numbers. A list with no numbers on it is
//! taken by walking the agent's own mark down to the line and pressing return.
//! A `[y/N]` at the end of a line is taken by the letter and a return. And a
//! question with no list under it at all is taken by writing something, which
//! is the only one of the four that is not a keystroke — see `Taking`, which is
//! what the window is told so that it can draw the difference.
//!
//! Two things follow from reading a drawing rather than an interface. The
//! screen below is deliberately partial — it is enough of a terminal to be
//! redrawn into, and no more — and the reading is a pattern rather than a
//! parse: it takes what is unmistakably a question being asked and leaves
//! everything else alone. That last part is the whole of what keeps the card
//! worth having. A shell sitting at its prompt is waiting to be typed at too,
//! and so is an agent with nothing to do; if being waited on were enough to put
//! a card on the graph there would be a card on every session all day, and the
//! shape would stop meaning that somebody's turn has stopped. What is looked
//! for is narrower than waiting: a question that has been put, with what it
//! wants back drawn under it. A prompt that is not that is a prompt the graph
//! says nothing about, which is exactly what the graph said before.

use std::hash::{DefaultHasher, Hash, Hasher};

use serde::Serialize;

pub mod watch;

/// One question, as it can be answered from anywhere the window draws it.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Ask {
    /// Which question this is, read off the question itself.
    ///
    /// What an answer is addressed to. A card on the graph is drawn from a
    /// reading that is already a moment old, and the one thing that must never
    /// happen is a press that was meant for "may I delete this" arriving at
    /// whatever the agent went on to ask next — so the answer carries this
    /// back with it, and is refused if it is no longer the question on the
    /// screen.
    ///
    /// Taken from what the question says rather than from a count of the ones
    /// before it. Two things follow. The same box read twice is the same
    /// question both times, so the whole reading can be dropped and taken again
    /// from a session's backlog without the card somebody is looking at
    /// becoming unanswerable — see `watch`. And what is promised is slightly
    /// stronger than a count ever promised: an answer only ever lands on a
    /// question that says exactly what the person was shown.
    pub seq: u64,
    /// What the question is about, in the order the box says it: the tool being
    /// asked for, the command, the file, whatever else was set above the
    /// question itself.
    pub detail: Vec<String>,
    /// The question, which is the line the answers underneath it are to.
    pub question: String,
    /// How this one is taken, which is the one thing about a question that
    /// cannot be worked out from what it says.
    pub taking: Taking,
    /// Whether several of the answers may be taken before the question is.
    ///
    /// A list that takes one answer is over the moment one is pressed; a list
    /// that takes several is not, and the window has to draw the difference —
    /// a row that is pressed to be taken, or a box that is pressed to be
    /// filled in with a return under the lot of them. Read off the drawing: an
    /// agent that lets several be taken draws a box beside every answer,
    /// because it has to show which of them are being held.
    pub picking: bool,
    /// Whether the answer the mark is standing on is one to be written at.
    ///
    /// The lists that carry a place to type on one of their own rows — the
    /// "and tell it what to do instead" every one of them offers. Nothing in
    /// the words says which row that is; the caret does. It stands on the row
    /// while that row is the one being written at, and nowhere in the list
    /// otherwise.
    pub writing: bool,
    /// The answers offered, or none at all when the answer is to be written.
    pub choices: Vec<Choice>,
}

/// What has to be typed at a session to take an answer.
///
/// Every question here is answered by typing at the agent, because that is the
/// only thing a terminal can be told; this is what the typing is. It belongs to
/// the question rather than to each of its answers — it is a fact about how the
/// agent drew the list, not about which line of it somebody picked — and it is
/// carried to the window because the window has to draw the difference: a
/// question with keys beside its answers is a row of keys, and a question with
/// no list under it is a place to write.
#[derive(Clone, Copy, Debug, Hash, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Taking {
    /// The key the agent printed beside the answer, typed on its own.
    ///
    /// What the numbered lists are for: the agent is watching for that one
    /// character and acts on it the moment it arrives, so nothing else has to
    /// be sent and nothing depends on where its own cursor is standing.
    Key,
    /// The key and a return, because a line is not read until there is one.
    Line,
    /// The agent's own mark, walked down to the answer with the arrow keys and
    /// taken with a return.
    ///
    /// The one kind whose answer is not the same two keystrokes whenever it is
    /// pressed: a list with no keys on it can only be answered from where the
    /// mark is standing, so how far to walk is counted at the moment of the
    /// press, off the reading the session holds then. See `watch`.
    Walk,
    /// Words: there is no list, and what is typed is whatever was written.
    Words,
}

/// One of the answers, as the agent itself offered it.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Choice {
    /// What an answer names this one by.
    ///
    /// The key the agent printed, wherever it printed one — that is what the
    /// keys are for, so an answer is a keystroke and not a walk down the list
    /// with the arrow keys, which would depend on where the agent's own cursor
    /// happens to be standing. A list drawn without keys has the place it
    /// stands in instead, and is walked to; the window knows which it is
    /// holding from `Taking`, and does not draw a key that could not be
    /// pressed.
    pub key: String,
    pub label: String,
    /// Where the agent's own cursor is, so the card can show it rather than
    /// invent a selection of its own.
    pub selected: bool,
    /// Whether the agent is holding this one as taken.
    ///
    /// Not the mark, and the whole reason both are carried: the mark is where
    /// the walk has got to, and this is what has been picked up on the way. A
    /// list that takes one answer has at most one of these and draws it as a
    /// tick after the answer; a list that takes several draws a box beside
    /// each and fills in the ones it is holding.
    pub picked: bool,
}

/// A question as it was read, before it has a name to be answered by.
#[derive(Clone, Debug, PartialEq)]
pub struct Reading {
    pub detail: Vec<String>,
    pub question: String,
    pub taking: Taking,
    pub picking: bool,
    pub writing: bool,
    pub choices: Vec<Choice>,
}

impl Reading {
    /// What an answer is addressed to: this question and no other.
    ///
    /// Everything the person was shown goes into it and nothing else does —
    /// not where the agent's own cursor is standing, because moving that leaves
    /// the question exactly as it was, and not when it was asked, because a
    /// reading taken a second time from the same bytes has to come out the
    /// same as the first. How it is taken goes in with the rest: a question
    /// offering a key to press and a question offering a place to write are not
    /// the same question, whatever they say.
    ///
    /// Cut to forty-eight bits because the window counts in doubles: a whole
    /// sixty-four would arrive there rounded, come back rounded, and match
    /// nothing.
    pub fn seq(&self) -> u64 {
        let mut hasher = DefaultHasher::new();
        self.detail.hash(&mut hasher);
        self.question.hash(&mut hasher);
        self.taking.hash(&mut hasher);
        // And whether it takes several answers, for the same reason as how it
        // is taken: a list to be picked from and a list to be answered are not
        // the same question. What is left out is everything that moves while
        // the question stands — the mark, what has been picked up, the row
        // being written at — because moving any of that is still the same
        // question being asked.
        self.picking.hash(&mut hasher);
        for choice in &self.choices {
            choice.key.hash(&mut hasher);
            choice.label.hash(&mut hasher);
        }
        hasher.finish() & ((1 << 48) - 1)
    }
}

impl Ask {
    /// The question a reading found, under the name an answer comes back with.
    pub fn of(reading: Reading) -> Self {
        Self {
            seq: reading.seq(),
            detail: reading.detail,
            question: reading.question,
            taking: reading.taking,
            picking: reading.picking,
            writing: reading.writing,
            choices: reading.choices,
        }
    }
}

/// How many lines above a question are kept as what it is about.
///
/// The box is not a document: what is in it is a tool and its argument, and
/// six lines is more than any of the three has ever put there. Whatever is
/// kept, the card decides how much of it there is room to draw.
const DETAIL_LIMIT: usize = 6;

/// How far above a question the top of its box is looked for.
///
/// Only what is inside the box is the question's; a box that is taller than
/// this is one whose top has scrolled off, and the lines above the question are
/// then as likely to be the conversation as anything to do with it.
const BOX_LIMIT: usize = 16;

/// How many lines an agent may set under a piece of its own drawing and still
/// be asking.
///
/// The shortcuts — `esc to cancel`, and its like. Two, because that is what
/// they all put there; a third line means something has been drawn since, and
/// something drawn since means the question has been answered. Counted from
/// the last line of drawing rather than from the answers, because an agent
/// that draws its question in more than one piece sets its shortcuts under the
/// last of them.
const HINT_LINES: usize = 2;

/// How much of a question's own drawing may stand under the answers before
/// any of it has been closed off.
///
/// The agents that set a pane beside the list — what an answer would come to,
/// a note to be written on it — put the foot of that pane and a line or two of
/// what is in it under the last answer, because the pane is taller than the
/// list. It is the question's own drawing rather than something drawn since,
/// which is the difference that matters. Only a question that is drawn in
/// something is allowed any of it: a numbered list standing in the open with a
/// line under it is a list somebody wrote, exactly as it was before.
const PANEL_LINES: usize = 2;

/// How much of its own drawing an agent may put across a list without the list
/// stopping being one.
///
/// A rule between two runs of answers, and the blank line on either side of
/// it. Both runs are the list — what is under the rule can be pressed at the
/// terminal exactly as what is over it can — and an agent that separates the
/// answers it thought of from the one it always offers has drawn a line, not
/// ended a list.
const BREAK_LINES: usize = 3;

/// The characters an agent marks its own selection with.
const MARKERS: [char; 6] = ['❯', '>', '▶', '›', '»', '●'];
/// What a shell ends its prompt with, and an agent the place it is typed at.
///
/// A line beginning with one of these is somewhere to type rather than
/// something being asked — which is worth knowing precisely because the two
/// look alike: an agent's own composer is a box with a mark and a caret in it,
/// and it stands there all day whether anybody is being asked anything or not.
const SIGILS: [char; 3] = ['$', '%', '#'];
/// The sides of a box, which are drawing rather than text.
const SIDES: [char; 4] = ['│', '┃', '║', '▌'];
/// What a box begins with, on the line above everything it holds.
const TOPS: [char; 5] = ['╭', '┌', '╔', '┏', '╒'];
/// And what it ends with, which is what says the question is the last thing in
/// it.
const BOTTOMS: [char; 5] = ['╰', '└', '╚', '┗', '╘'];
/// What a rule is drawn with, wherever one is drawn.
const RULES: [char; 4] = ['─', '═', '━', '-'];
/// And what a rule drawn inside a question is dashed with.
///
/// Drawing, exactly as a solid rule is — neither is ever an answer — and the
/// difference is what it is a line round. An agent that sets a diff or a pane
/// into the middle of what it is asking about draws the lines across that
/// dashed and the line over the whole question solid, so the dashes are inside
/// the question and the rule is its edge. What follows is that a walk up to
/// what a question is about crosses the dashes and stops at the rule: the
/// file, the command and the tool are on the far side of them.
const DASHES: [char; 6] = ['╌', '╍', '┄', '┅', '┈', '┉'];
/// What an agent draws beside an answer it is holding, and beside one it is
/// not.
///
/// A list that takes several answers has to show which of them are being held,
/// and they all show it the same way: a box or a circle beside every answer,
/// filled in on the ones taken. The box is also what says the list takes
/// several at all — a list that takes one has nothing to show until it is
/// over.
const TAKEN: [char; 4] = ['☑', '☒', '◉', '⦿'];
const UNTAKEN: [char; 3] = ['☐', '◯', '○'];
/// And the tick an agent sets after the one answer it is holding, for the
/// lists that hold one.
const TICKS: [char; 3] = ['✔', '✓', '√'];
/// What is being asked for when nothing should be drawn on a card.
///
/// A password is an elicitation like any other and the one thing this will not
/// carry. Not because it could not be typed at the session, but because a card
/// on a canvas is a thing left lying open in a window somebody may well be
/// sharing, and the terminal it was asked in is two feet away and asks for it
/// in the dark.
const SECRETS: [&str; 6] = [
    "password",
    "passphrase",
    "secret",
    "token",
    "api key",
    "credential",
];
/// And the short ones, which are only ever those words on their own.
const SECRET_WORDS: [&str; 4] = ["pin", "otp", "2fa", "mfa"];

/// The question being asked on a screen, if one is.
///
/// Four readings, tried in the order a question is most surely told by: the
/// lists first, because a list drawn under a question is the least mistakable
/// thing on a terminal, and the bare written answer last, because a line asking
/// to be typed at is the most easily confused with a line that is merely there.
/// The first one that finds something is the reading, and finding nothing at
/// all is the ordinary answer.
pub fn read(screen: &Screen) -> Option<Reading> {
    let lines = screen.lines();
    let inner: Vec<&str> = lines.iter().map(|line| undressed(line)).collect();
    let standing = screen.standing();

    keyed(&inner, &standing)
        .or_else(|| marked(&inner, &standing))
        .or_else(|| confirmed(&inner, &standing))
        .or_else(|| written(&inner, &standing))
}

/// A list the agent put keys beside, which is answered by typing one of them.
///
/// The shape looked for is a list counting from its own first key — one, or
/// zero, or `a` — at the foot of the box it is drawn in, with the question on
/// the line above it. All of it is required, and the last part is the one that
/// matters: a keyed list is also how an agent writes out three suggestions in
/// the middle of an answer, and the difference between that and a question is
/// that a question is the last thing on the screen — nothing has been drawn
/// under it, because nothing else is going to happen until it is answered.
fn keyed(inner: &[&str], standing: &Standing) -> Option<Reading> {
    // The last keyed list on the screen, taken from its foot upwards: an agent
    // that has asked twice has answered the first one, and what is left of it
    // above is history.
    let end = inner.iter().rposition(|line| choice_of(line).is_some())?;
    // Where the keys themselves stand, which is what tells the rest of an
    // answer too long for one line from the question above the list. An answer
    // runs on under its own words; nothing else in the box is indented that
    // far.
    let column = key_column(inner[end])?;
    let runs = |line: &str| !blank(line) && !is_edge(line) && indent(line) > column;

    // Upwards to the head of the list, over anything the agent drew across its
    // own list on the way — see `BREAK_LINES`.
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
        // The rest of an answer runs on directly under it and is never on the
        // far side of a break.
        if choice_of(inner[above - 1]).is_some() || (crossed == 0 && runs(inner[above - 1])) {
            start = above - 1;
            continue;
        }
        break;
    }
    // The last answer runs on the same way as the ones above it.
    let mut foot = end;
    while foot + 1 < inner.len() && runs(inner[foot + 1]) {
        foot += 1;
    }

    // In order, from the first key of its kind. A list that does not is a list
    // that was written rather than offered — a numbered fragment of somebody's
    // answer, or the tail of a longer list whose head has scrolled away.
    let mut choices: Vec<Choice> = Vec::new();
    let mut counted: Option<Key> = None;
    let mut picking = false;
    for line in &inner[start..=foot] {
        // The agent's own drawing, which is neither an answer nor the rest of
        // one.
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
                // A box beside any of them is a box beside all of them, and
                // says the list is one to pick from rather than to answer.
                picking |= marked.boxed;
                choices.push(Choice {
                    key: key.printed(),
                    label: marked.label,
                    selected: marked.selected,
                    picked: marked.picked,
                });
            }
            // The rest of the answer above it, which is one answer with the
            // line break taken out rather than two.
            None => match choices.last_mut() {
                Some(choice) => {
                    choice.label.push(' ');
                    choice.label.push_str(beside(line));
                }
                None => return None,
            },
        }
    }

    let (detail, question, framing) = asked_above(&inner[..start]);
    // One answer is a question when the box says it is one — an agent that
    // offers a single way on has still stopped and asked — and is nothing at
    // all when it is a line at the foot of somebody's answer that happens to
    // begin with a number.
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

/// A list with no keys on it, which is answered by walking the agent's own mark.
///
/// The shape is a run of lines whose words all begin at the same column, with
/// the mark on exactly one of them. That last part is what tells a list being
/// offered from a list being written: a bulleted paragraph marks every line it
/// has, and a list somebody is choosing from marks the one they are standing
/// on.
fn marked(inner: &[&str], standing: &Standing) -> Option<Reading> {
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
                    // Where it stands, because the agent gave it nothing else
                    // to be called by. Nothing is typed at the session to say
                    // it: the walk is counted from the mark when the press
                    // comes.
                    key: (choices.len() + 1).to_string(),
                    label: marked.label,
                    selected: marked.selected,
                    picked: marked.picked,
                });
            }
            None => match choices.last_mut() {
                Some(choice) => {
                    choice.label.push(' ');
                    choice.label.push_str(beside(line));
                }
                None => return None,
            },
        }
    }
    if choices.len() < 2 {
        return None;
    }
    // Exactly one, or there is nowhere to walk from.
    if choices.iter().filter(|choice| choice.selected).count() != 1 {
        return None;
    }
    // And the caret is not in it. What is being guarded against here is an
    // agent's own composer with two lines written into it: a mark on the first
    // of them, the second lined up under it, and nothing between that and a
    // list being offered. The caret is the difference. It sits in the composer,
    // because that is where the typing is going; a program drawing a list to be
    // walked has finished drawing and left the caret under the box or put it
    // away. Getting this wrong in the other direction would be a card that
    // walks a message somebody is half way through writing into being sent.
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
        // A list with the caret in it was turned down above: that is somebody's
        // half-written message, not a list to be walked.
        writing: false,
        choices,
    })
}

/// A question with the answers written into the end of it: `[y/N]`, and its
/// like.
///
/// The oldest way of asking anything at a terminal and still the commonest, and
/// the whole of it is on one line. What says it is live is the caret: it is
/// sitting at the end of that line waiting for the letter, and there is nothing
/// under it at all.
fn confirmed(inner: &[&str], standing: &Standing) -> Option<Reading> {
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
/// The hardest of the four to be sure of and the one held to the tightest
/// shape, because what it looks like is a line of text with a caret after it,
/// and so does every prompt of every shell and the composer of every agent
/// sitting there with nothing to do. Two things are taken. A line that opens
/// with the mark those question-and-answer libraries all open with — `? ` and
/// then the question — because nothing else prints that. And a line that ends
/// the way a question ends, in a colon or a question mark after a word, with
/// the caret standing after it and at least two words in front of it: `> ` is
/// not that, nor is `~/repo $`, nor is `In [1]:`.
///
/// What is deliberately not taken is an agent's own composer, which is a box
/// with a mark in it and a caret after the mark. It is left alone even though
/// an agent that has asked something and is waiting to be told is often exactly
/// that, because it is also what a session with nothing to do looks like, and a
/// card that stood on every idle session would be a card that meant nothing.
fn written(inner: &[&str], standing: &Standing) -> Option<Reading> {
    let line = at_the_caret(inner, standing)?;
    let text = line.trim();
    if secret(text) {
        return None;
    }

    let question = match text.strip_prefix('?') {
        // The mark those libraries all ask with, and then the question. What
        // follows a second mark is the answer they have written in as the
        // default, which is theirs to redraw and not the card's to repeat.
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
        // The whole question is a place to write. `writing` is about one row of
        // a list being one, which this has none of.
        writing: false,
        choices: Vec::new(),
    })
}

/// The line the caret is standing at the end of, with nothing drawn under it.
///
/// What both of the one-line readings are held to. A prompt is being asked only
/// while the place to answer it is where the caret is: an agent that has moved
/// on has taken the caret with it, and one that is drawing rather than asking
/// has put the caret away altogether.
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

/// Whether the answer the mark is standing on is one to be written at.
///
/// The lists that carry a place to type on one of their own rows — the "and
/// tell it what to do instead", the "or type something else" every one of them
/// offers. Nothing in the words says which row that is, and the row is not the
/// one the mark is on either: an agent walking a list keeps its own cursor on
/// whatever row it is standing on, whether or not there is anything to type
/// there.
///
/// Where along the row it stands is what says it. A cursor that is only being
/// kept up with the walk is put at the head of the row, out in front of the
/// key; a row that is being typed into has it in among the words, where the
/// next letter would go. So the question asked here is not whether the caret is
/// in the list but whether it is past the key — which is true of every agent
/// that offers such a row, and true whether or not the caret is being drawn.
/// Some hide it and go on moving it; what is hidden is still where the typing
/// would land.
fn written_at(standing: &Standing, rows: std::ops::RangeInclusive<usize>, key: usize) -> bool {
    rows.contains(&standing.row) && standing.col > key
}

/// What a question is drawn in, as far as the lines above it say.
///
/// Three answers rather than two, because the agents draw in three ways and the
/// middle one had nowhere to be said before. A box is a box. A rule and no
/// border is what an agent draws when it puts its whole answer on the screen
/// again every time rather than printing it — the question set between two
/// rules, with its own furniture under the second — and it is as much a thing
/// to be drawn in as a box is, even though there is nothing above the question
/// to be read as what it is about. And a question with neither is standing in
/// the open, which is the one that has to be held to being the last thing on
/// the screen.
#[derive(Clone, Copy, Debug, PartialEq)]
enum Framing {
    Boxed,
    Ruled,
    Bare,
}

/// What is above a list, in the order the box says it: the question on the
/// nearest line with anything on it, then whatever was set above that, and
/// what the whole of it is drawn in.
fn asked_above(above: &[&str]) -> (Vec<String>, String, Framing) {
    let mut at = above.len();
    while at > 0 && blank(above[at - 1]) {
        at -= 1;
    }
    // A list that opens the box has no question above it, and is still a
    // question — what it is asking is then said by the answers alone.
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

/// What is set above a question, in the order it says it, and what the whole of
/// it is drawn in.
///
/// Only ever what is inside the question's own drawing: the walk stops at the
/// edge it finds — the top of a box, the rule an unboxed question is set
/// under — and a question with neither within reach is left with no detail at
/// all. The lines above a question that is drawn in nothing are the
/// conversation, and the conversation is not what is being asked about.
///
/// What the walk does not stop at is a dashed line, because a dashed line is
/// one an agent drew inside what it is asking about — over a diff, under a
/// pane — and the tool and the file are on the far side of it. Nor does it
/// stop at having enough to keep: what is above a question decides what the
/// question is drawn in, so the walk goes on looking for the edge even after
/// the card has more than it can draw.
fn detail_above(above: &[&str], question: usize) -> (Vec<String>, Framing) {
    let floor = question.saturating_sub(BOX_LIMIT);
    let mut detail = Vec::new();
    let mut framing = Framing::Bare;
    let mut dashed = false;
    let mut walk = question;

    while walk > floor {
        walk -= 1;
        let line = above[walk];
        if is_dashed(line) {
            dashed = true;
            continue;
        }
        if is_edge(line) {
            // The foot of a box above the question is the box somebody else's
            // question was in, which is nothing this one is drawn in.
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

    // A walk that ran out of reach before it found the edge, having crossed a
    // dashed line to get there, was inside something the whole way: what is
    // over the question is a diff or a pane the agent drew round what it is
    // asking about, and a question that far down one of those has an edge —
    // it is simply further up than anything here is worth walking for.
    if framing == Framing::Bare && dashed {
        framing = Framing::Ruled;
    }
    if framing == Framing::Bare {
        return (Vec::new(), framing);
    }
    detail.reverse();
    (detail, framing)
}

/// Whether what was found is the question being asked, rather than the wreckage
/// of one that has been answered.
///
/// On an ordinary screen it is what is under it that says so. A question is the
/// last thing drawn: nothing else is going to happen until it is answered,
/// which is what a question is. An agent that has been answered goes on
/// writing, and the box it was answered in stays up the screen for as long as
/// the scrollback holds it — so what tells the live question from that one is
/// not the box, it is what is under it. Room is left for the line or two of
/// shortcuts an agent sets below its box, and for nothing else — a line or two
/// in all, however many pieces the question was drawn in, because an agent
/// that has been answered is an agent with something to say.
///
/// A full-screen program is held to the same thing first. It draws the whole
/// screen every frame, so there is no wreckage to tell apart, and the ones that
/// take the composer down while they are asking put nothing under the question
/// either — which is the ordinary shape and reads as the ordinary shape.
///
/// What is left is the program that keeps its composer at the foot of the
/// screen under everything, where nothing it draws is ever the last thing.
/// Only that one is asked for something else: that the question be in a box of
/// its own and that the caret have been taken away — a program that wants a
/// keypress hides the caret, and a program showing you where to type is not
/// stopped on a question. It is the narrower test and it is second, because it
/// is the one that would also take an answered box still standing on a screen
/// its program goes on writing under.
///
/// Between the two is the agent that draws the whole of its output over again
/// on the screen that scrolls — no box round the question, a rule over it and
/// a rule under it, and under that its own shortcuts and whatever else it
/// keeps down there. What is under such a question is its own drawing, and it
/// is read that way: a line drawn across closes off everything above it and
/// hands back the line or two of shortcuts that may follow, because an agent
/// that draws its question in more than one piece sets its shortcuts under the
/// last piece rather than the first. What is not forgiven is what was never
/// drawing — a paragraph, another box, another list — and a question standing
/// in the open is held to what it was held to before, which is nothing under
/// it at all.
fn last_thing(inner: &[&str], foot: usize, framing: Framing, standing: &Standing) -> bool {
    if nothing_since(inner, foot, framing) {
        return true;
    }
    standing.alt && framing == Framing::Boxed && !standing.shown
}

/// Whether what is under a question is the question's own drawing and no more.
fn nothing_since(inner: &[&str], foot: usize, framing: Framing) -> bool {
    let mut closed = false;
    let mut drawing = PANEL_LINES;
    let mut spare = HINT_LINES;
    for line in &inner[foot + 1..] {
        if blank(line) {
            continue;
        }
        // Another box below this one: whatever is being drawn down there is
        // what the agent is doing now, and this is not it.
        if is_top(line) || choice_of(line).is_some() {
            return false;
        }
        // And a place to type below it: the agent has its composer back, which
        // it only has when it is not waiting on an answer. The question under
        // one of those is the one that has just been answered.
        if typed_at(line.trim()) {
            return false;
        }
        // A line of drawing: the foot of the box the question is in, the foot
        // of a pane set beside it, the rule under a question that was never
        // boxed at all.
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
            // Still inside the drawing — what a pane beside the list says on
            // the rows below the last answer — which only a question that is
            // drawn in something may have any of.
            if framing == Framing::Bare || drawing == 0 {
                return false;
            }
            drawing -= 1;
        }
    }
    true
}

/// What an agent printed beside an answer to have it answered by.
#[derive(Clone, Copy, Debug, PartialEq)]
enum Key {
    /// A number, which is what nearly all of them print.
    Count(u32),
    /// A letter, for the ones that offer letters instead.
    Letter(char),
}

impl Key {
    /// Whether a list may open with this one.
    ///
    /// The first number or the first letter, and nothing else. A list that
    /// begins anywhere else is the tail of one whose head has scrolled away, or
    /// a fragment of somebody's answer that happens to begin with a number.
    fn opens(self) -> bool {
        matches!(self, Key::Count(0 | 1) | Key::Letter('a' | 'A'))
    }

    /// The one that comes next, which is the only thing the list may say next.
    fn after(self) -> Option<Key> {
        Some(match self {
            Key::Count(number) => Key::Count(number.checked_add(1)?),
            Key::Letter(letter) => Key::Letter(char::from_u32(letter as u32 + 1)?),
        })
    }

    /// What is typed to take it, which is what the agent itself printed.
    fn printed(self) -> String {
        match self {
            Key::Count(number) => number.to_string(),
            Key::Letter(letter) => letter.to_string(),
        }
    }
}

/// What one line of a list says about the answer on it, beyond which one it is.
struct Marked {
    label: String,
    /// Where the agent's own mark stands.
    selected: bool,
    /// Whether the agent is holding this one as taken.
    picked: bool,
    /// Whether a box was drawn beside it, which is what says the list takes
    /// several answers rather than one.
    boxed: bool,
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

/// The box an agent drew beside an answer, if it drew one: whether it is
/// filled in, and what is left of the line after it.
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

/// The tick an agent set after the answer it is holding, taken off it.
fn tick_after(label: &str) -> (bool, &str) {
    let text = label.trim_end();
    match text.strip_suffix(TICKS.as_slice()) {
        // With a space in front of it, so that an answer ending in a tick of
        // its own is left as it was written.
        Some(rest) if rest.ends_with(' ') => (true, rest.trim_end()),
        _ => (false, text),
    }
}

/// What is left of an answer when the pane drawn beside it is taken off.
///
/// An agent that sets a pane of its own to the right of the list writes both
/// on the same row, and the row is what is read — so an answer would come away
/// with the side of that pane, and whatever the pane says on that line, stuck
/// to the end of it. A pane is drawing rather than words, and where the
/// drawing begins is where the answer ended.
fn beside(label: &str) -> &str {
    let drawn = |letter: char| {
        SIDES.contains(&letter) || TOPS.contains(&letter) || BOTTOMS.contains(&letter)
    };
    match label.char_indices().find(|(_, letter)| drawn(*letter)) {
        Some((at, _)) => label[..at].trim(),
        None => label.trim(),
    }
}

/// One line of a keyed list, if that is what it is: which key, and what the
/// line says about the answer beside it.
fn choice_of(line: &str) -> Option<(Key, Marked)> {
    let (key, selected, rest) = keyed_line(line)?;
    Some((key, answer_on(rest.trim(), selected)?))
}

/// Where in a line its key stands, for a line that has one.
///
/// The first letter or digit on it: what may come before a key is a mark and
/// the spaces around it, and neither of those is either.
fn key_column(line: &str) -> Option<usize> {
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
        // One letter and no more: `a)` is a key and `as)` is a word with a
        // bracket after it.
        let letter = rest.chars().next()?;
        if !letter.is_ascii_alphabetic() {
            return None;
        }
        (Key::Letter(letter), &rest[letter.len_utf8()..])
    } else {
        // Two digits at the outside: these lists are three long, and a wider
        // number is a line of a document that happens to begin with one.
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
    // The space is part of the pattern: `1.5` is a number and `1. Yes` is an
    // answer.
    if !rest.starts_with(' ') {
        return None;
    }

    Some((key, selected, rest))
}

/// The column a marked line's words start at, for a line the agent has put its
/// own mark on.
fn marked_at(line: &str) -> Option<usize> {
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
    // A space between the mark and the words. `> quoted` is a mark and
    // `>redirected` is not.
    if gap == 0 || words.is_empty() {
        return None;
    }
    Some(indent(line) + 1 + gap)
}

/// One line of an unkeyed list, if it is one of a run standing at a column.
fn item_at(line: &str, column: usize) -> Option<Marked> {
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

/// The two answers written into the end of a line, if that is what is there.
///
/// Held to exactly the two. A `[y,n,a,q,d]` is a question as well, and every
/// letter in it means something the line never says — so it is left in the
/// terminal, where whoever presses `?` will be told what they all are. What is
/// taken is the shape whose answers are their own explanation.
fn yes_or_no(line: &str) -> Option<Vec<Choice>> {
    let text = line.trim_end();
    // The last bracketed group on the line, with nothing after it but the
    // punctuation a question ends with: what is offered is offered at the end.
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

    // Which one a bare return takes, which is said by printing that one in
    // capitals. Marked the way the agent's own cursor is marked elsewhere:
    // as where the agent is standing, not as a recommendation of the card's.
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
                // The two words the line did not print. Everything else on a
                // card is the agent's own, and these are ours because a
                // bracketed letter is not something to read.
                label: if said.starts_with('y') { "Yes" } else { "No" }.to_string(),
                selected: capitals == 1 && printed.starts_with(char::is_uppercase),
                // Two answers on one line: there is nothing to be holding, and
                // pressing either of them is the end of the question.
                picked: false,
            })
            .collect(),
    )
}

/// Whether what is being asked for is something not to be drawn on a canvas.
fn secret(text: &str) -> bool {
    let said = text.to_lowercase();
    if SECRETS.iter().any(|word| said.contains(word)) {
        return true;
    }
    said.split(|letter: char| !letter.is_alphanumeric())
        .any(|word| SECRET_WORDS.contains(&word))
}

/// Whether a line ends the way a question ends.
///
/// A colon or a question mark, with a word in front of it: `Which branch?` and
/// `Enter a name:` do, and `In [1]:` does not.
fn ends_asking(text: &str) -> bool {
    let mut letters = text.trim_end().chars().rev();
    if !matches!(letters.next(), Some(':') | Some('?')) {
        return false;
    }
    letters.next().is_some_and(char::is_alphanumeric)
}

/// Whether a line has somewhere to type on it.
///
/// A shell's prompt and an agent's composer are the same thing: a mark, and
/// whatever has been typed after it. Neither is being asked, and both are
/// regularly a line that ends in a colon — a shell prompt with a half-written
/// command on it, a composer with a half-written question in it — which is
/// exactly the shape a question wanting words has. What tells them apart is the
/// mark, wherever along the line it stands.
fn typed_at(text: &str) -> bool {
    let sigil = |letter: char| MARKERS.contains(&letter) || SIGILS.contains(&letter);
    if text.chars().next().is_some_and(sigil) {
        return true;
    }
    let mut letters = text.chars().peekable();
    while let Some(letter) = letters.next() {
        if sigil(letter) && letters.peek() == Some(&' ') {
            return true;
        }
    }
    false
}

/// How many words there are, which is what tells a question from a prompt.
fn words(text: &str) -> usize {
    text.split_whitespace().count()
}

/// A question with the place its answer is typed taken off the end of it.
fn before_field(text: &str) -> String {
    for (at, letter) in text.char_indices() {
        if at > 0 && MARKERS.contains(&letter) && text[..at].ends_with(' ') {
            return text[..at].trim_end().to_string();
        }
    }
    text.to_string()
}

/// A line with the box it is drawn in taken off it.
///
/// What is inside the box keeps its own indentation: an answer too long for one
/// line runs on under itself, and how far in a line begins is the only thing
/// that tells that from a new line of the box.
fn undressed(line: &str) -> &str {
    let text = line.trim_end();
    let opened = text.trim_start();
    let inside = match opened.chars().next() {
        Some(first) if SIDES.contains(&first) => opened[first.len_utf8()..].trim_end(),
        _ => text,
    };
    match inside.chars().next_back() {
        Some(last) if SIDES.contains(&last) => inside[..inside.len() - last.len_utf8()].trim_end(),
        _ => inside,
    }
}

/// How far in a line begins, in characters.
fn indent(line: &str) -> usize {
    line.chars().take_while(|letter| *letter == ' ').count()
}

fn blank(line: &str) -> bool {
    line.trim().is_empty()
}

fn is_top(line: &str) -> bool {
    line.trim_start()
        .chars()
        .next()
        .is_some_and(|first| TOPS.contains(&first))
}

fn is_bottom(line: &str) -> bool {
    line.trim_start()
        .chars()
        .next()
        .is_some_and(|first| BOTTOMS.contains(&first))
}

/// A rule: a line drawn the width of what it is under, and neither the top of
/// a box nor the foot of one.
///
/// What an agent draws instead of a box when it draws the whole of its output
/// over again rather than printing it — the question set between two of these,
/// with its own furniture under the second. A rule closes a question off the
/// way the foot of a box does, because it is the same thing said in one line
/// instead of three.
fn is_rule(line: &str) -> bool {
    is_edge(line) && !is_top(line) && !is_bottom(line)
}

/// A border or a rule: drawing rather than anything anybody wrote.
fn is_edge(line: &str) -> bool {
    let line = line.trim();
    if line.is_empty() {
        return false;
    }
    is_top(line)
        || is_bottom(line)
        || line
            .chars()
            .all(|letter| RULES.contains(&letter) || DASHES.contains(&letter) || letter == ' ')
}

/// A rule drawn dashed, which is a line inside a question rather than round it.
fn is_dashed(line: &str) -> bool {
    let line = line.trim();
    !line.is_empty()
        && line
            .chars()
            .all(|letter| DASHES.contains(&letter) || letter == ' ')
}

/// What a reading needs to know about a screen besides the words on it.
///
/// All of it is about the caret, which is the one thing on a terminal that says
/// what is going to happen next rather than what has happened. A question drawn
/// as a list is told by the drawing alone; a question that is a line with a
/// caret after it can only be told by the caret being there.
struct Standing {
    /// Which row the caret is standing on.
    row: usize,
    /// And how far along that row.
    ///
    /// What tells a caret that is being typed at from one that is merely
    /// parked. A program drawing a list puts its cursor on the row it is
    /// standing on whether or not there is anything to type there, and puts it
    /// at the head of that row; a row that is being written at has it in among
    /// the words, where the next letter would go.
    col: usize,
    /// Whether nothing is drawn between it and the end of that row.
    clear: bool,
    /// Whether the caret is being drawn at all.
    shown: bool,
    /// Whether this is the screen a full-screen program draws on.
    alt: bool,
}

/// Where the escape sequence being read has got to.
enum State {
    Ground,
    Escape,
    /// `ESC [` and whatever has arrived of it since.
    Csi,
    /// `ESC ]`, which runs until something ends it rather than to a fixed
    /// length.
    Osc,
    /// A sequence whose one remaining character is of no interest here.
    Skip,
}

/// As much of a terminal as it takes to be redrawn into.
///
/// Not an emulator: nothing here is drawn, so a screen is a grid of characters
/// and a cursor, and everything about colour, style, mouse reporting and the
/// hundred other things a terminal answers for is read and dropped. What is
/// kept is the part a question is made of — where the cursor is, what is at
/// each place, and what erasing and scrolling do to it — because an agent
/// drawing its prompt box moves the cursor up over what it said last and writes
/// the box on top of it, and text taken from the stream as it arrives would be
/// the box and the wreckage of everything it was drawn over.
///
/// There is no scrollback. What has gone off the top is not what anybody is
/// being asked.
pub struct Screen {
    rows: usize,
    cols: usize,
    /// Row-major, `rows * cols` of them. The second half of a wide character is
    /// held as a nul, which reads as nothing and is skipped on the way out.
    cells: Vec<char>,
    row: usize,
    col: usize,
    /// The rows scrolling happens between, which is all of them until something
    /// says otherwise.
    top: usize,
    bottom: usize,
    saved: (usize, usize),
    /// Standing past the last column, with the next character due on the next
    /// row.
    ///
    /// A real state in a terminal rather than a rounding of one: a line exactly
    /// as wide as the screen must not push the next line down, so the cursor
    /// waits at the end of the row it filled and only moves when something else
    /// is written. Anything that moves the cursor deliberately puts it down.
    wrapping: bool,
    /// Whether the caret is being drawn.
    ///
    /// Kept because it is the one thing a program says about what it wants
    /// next. A program waiting to be typed at shows the caret at the place the
    /// typing goes; a program drawing a screen for you to press a key at takes
    /// it away first, so that it is not left blinking in the middle of the
    /// drawing. Both are read — see `Standing`.
    shown: bool,
    /// Whether this is the screen a full-screen program draws on.
    alt: bool,
    state: State,
    /// What has arrived so far of a sequence that is still coming. Output is
    /// handed over in runs of whatever the process happened to have written, so
    /// a sequence is regularly split across two of them.
    held: String,
}

impl Screen {
    fn new(rows: u16, cols: u16) -> Self {
        let rows = (rows as usize).max(1);
        let cols = (cols as usize).max(1);
        Self {
            rows,
            cols,
            cells: vec![' '; rows * cols],
            row: 0,
            col: 0,
            top: 0,
            bottom: rows - 1,
            saved: (0, 0),
            wrapping: false,
            shown: true,
            alt: false,
            state: State::Ground,
            held: String::new(),
        }
    }

    /// A new size, and a blank screen at it.
    ///
    /// Nothing drawn is carried over. Everything on a terminal that has just
    /// been resized is about to be drawn again by whatever is running in it —
    /// that is what a resize is for — and reflowing a screen nobody will ever
    /// look at is work done to be immediately overwritten.
    ///
    /// Which screen is in use and whether the caret is shown are carried, and
    /// have to be: nothing redraws them, because they were never drawn. A
    /// full-screen program that was resized is still full-screen afterwards.
    fn resize(&mut self, rows: u16, cols: u16) {
        if rows as usize == self.rows && cols as usize == self.cols {
            return;
        }
        let (shown, alt) = (self.shown, self.alt);
        *self = Self::new(rows, cols);
        self.shown = shown;
        self.alt = alt;
    }

    /// Where the caret is standing, and what that says about the screen.
    fn standing(&self) -> Standing {
        let from = self.row * self.cols;
        // Nothing between the caret and the end of the row, which is what says
        // it is standing after what is written there rather than somewhere back
        // inside it. The side of a box is not something written: a caret in a
        // box has the box's own right-hand side out beyond it.
        let clear = self.cells[from + self.col..from + self.cols]
            .iter()
            .all(|cell| matches!(cell, ' ' | '\0') || SIDES.contains(cell));

        Standing {
            row: self.row,
            col: self.col,
            clear,
            shown: self.shown,
            alt: self.alt,
        }
    }

    /// Every row, with the trailing blanks taken off.
    fn lines(&self) -> Vec<String> {
        (0..self.rows)
            .map(|row| {
                let from = row * self.cols;
                let line: String = self.cells[from..from + self.cols]
                    .iter()
                    .filter(|cell| **cell != '\0')
                    .collect();
                line.trim_end().to_string()
            })
            .collect()
    }

    fn feed(&mut self, text: &str) {
        for letter in text.chars() {
            match self.state {
                State::Ground => self.ground(letter),
                State::Escape => self.escape(letter),
                State::Csi => self.csi(letter),
                State::Osc => self.osc(letter),
                State::Skip => self.state = State::Ground,
            }
        }
    }

    fn ground(&mut self, letter: char) {
        if letter != '\u{1b}' && ((letter as u32) < 0x20 || letter == '\u{7f}') {
            self.wrapping = false;
        }
        match letter {
            '\u{1b}' => {
                self.state = State::Escape;
                self.held.clear();
            }
            '\n' => self.newline(),
            '\r' => self.col = 0,
            '\u{8}' => self.col = self.col.saturating_sub(1),
            '\t' => self.col = (self.col / 8 + 1) * 8,
            letter if (letter as u32) < 0x20 || letter == '\u{7f}' => {}
            letter => self.put(letter),
        }
    }

    fn escape(&mut self, letter: char) {
        self.state = State::Ground;
        self.wrapping = false;
        match letter {
            '[' => {
                self.state = State::Csi;
                self.held.clear();
            }
            ']' => {
                self.state = State::Osc;
                self.held.clear();
            }
            // A character set is chosen with one more character, which says
            // nothing about where anything is.
            '(' | ')' | '*' | '+' | '%' | '#' => self.state = State::Skip,
            // Up one, taking the screen with it when there is nowhere to go.
            'M' => {
                if self.row == self.top {
                    self.shift_down(self.top, self.bottom, 1);
                } else {
                    self.row = self.row.saturating_sub(1);
                }
            }
            '7' => self.saved = (self.row, self.col),
            '8' => self.restore(),
            // Everything back to how a terminal starts, the caret included.
            'c' => {
                self.shown = true;
                self.alt = false;
                self.reset();
            }
            _ => {}
        }
    }

    fn csi(&mut self, letter: char) {
        // Everything up to the letter that ends it is the parameters.
        if !('\u{40}'..='\u{7e}').contains(&letter) {
            self.held.push(letter);
            return;
        }
        self.state = State::Ground;
        self.wrapping = false;

        // A private sequence is a mode being set, and the only ones that matter
        // here are the ones that swap screens and the one that puts the caret
        // away.
        let held = std::mem::take(&mut self.held);
        let private = held.starts_with(['?', '<', '=', '>']);
        let numbers: Vec<usize> = held
            .trim_start_matches(['?', '<', '=', '>'])
            .split(';')
            .map(|part| part.trim().parse().unwrap_or(0))
            .collect();
        let first = numbers.first().copied().unwrap_or(0);
        let count = first.max(1);

        if private {
            if matches!(letter, 'h' | 'l') {
                match first {
                    // Moving between the main screen and the one a full-screen
                    // program draws on. Neither carries anything over, which is
                    // the whole of what has to be true here.
                    47 | 1047 | 1049 => {
                        self.alt = letter == 'h';
                        self.reset();
                    }
                    25 => self.shown = letter == 'h',
                    _ => {}
                }
            }
            return;
        }

        match letter {
            'A' => self.row = self.row.saturating_sub(count),
            'B' => self.row = (self.row + count).min(self.rows - 1),
            'C' => self.col = (self.col + count).min(self.cols - 1),
            'D' => self.col = self.col.saturating_sub(count),
            'E' => {
                self.row = (self.row + count).min(self.rows - 1);
                self.col = 0;
            }
            'F' => {
                self.row = self.row.saturating_sub(count);
                self.col = 0;
            }
            'G' | '`' => self.col = (count - 1).min(self.cols - 1),
            'd' => self.row = (count - 1).min(self.rows - 1),
            'H' | 'f' => {
                let down = numbers.first().copied().unwrap_or(1).max(1);
                let along = numbers.get(1).copied().unwrap_or(1).max(1);
                self.row = (down - 1).min(self.rows - 1);
                self.col = (along - 1).min(self.cols - 1);
            }
            'J' => self.erase_screen(first),
            'K' => self.erase_line(first),
            'L' => self.shift_down(self.row, self.bottom, count),
            'M' => self.shift_up(self.row, self.bottom, count),
            'S' => self.shift_up(self.top, self.bottom, count),
            'T' => self.shift_down(self.top, self.bottom, count),
            'P' => self.delete_cells(count),
            '@' => self.insert_cells(count),
            'X' => self.blank_cells(count),
            'r' => {
                let top = numbers.first().copied().unwrap_or(1).max(1) - 1;
                let bottom = numbers
                    .get(1)
                    .copied()
                    .filter(|value| *value > 0)
                    .unwrap_or(self.rows)
                    - 1;
                self.top = top.min(self.rows - 1);
                self.bottom = bottom.min(self.rows - 1).max(self.top);
                self.row = self.top;
                self.col = 0;
            }
            's' => self.saved = (self.row, self.col),
            'u' => self.restore(),
            _ => {}
        }
    }

    fn osc(&mut self, letter: char) {
        // Ended by a bell, or by the escape that begins the two-character
        // ending. Either way there is nothing in it for a screen.
        if letter == '\u{7}' || letter == '\u{1b}' {
            self.state = State::Ground;
        }
    }

    fn reset(&mut self) {
        self.cells.fill(' ');
        self.row = 0;
        self.col = 0;
        self.top = 0;
        self.bottom = self.rows - 1;
    }

    fn restore(&mut self) {
        let (row, col) = self.saved;
        self.row = row.min(self.rows - 1);
        self.col = col.min(self.cols - 1);
    }

    fn put(&mut self, letter: char) {
        let width = if wide(letter) { 2 } else { 1 };
        if self.wrapping || self.col + width > self.cols {
            self.col = 0;
            self.newline();
            self.wrapping = false;
        }
        let at = self.row * self.cols + self.col;
        self.cells[at] = letter;
        if width == 2 && self.col + 1 < self.cols {
            self.cells[at + 1] = '\0';
        }
        self.col += width;
        if self.col >= self.cols {
            self.col = self.cols - 1;
            self.wrapping = true;
        }
    }

    fn newline(&mut self) {
        if self.row >= self.bottom {
            self.shift_up(self.top, self.bottom, 1);
        } else {
            self.row += 1;
        }
    }

    fn erase_screen(&mut self, mode: usize) {
        let at = self.row * self.cols + self.col;
        match mode {
            0 => self.cells[at..].fill(' '),
            1 => self.cells[..=at].fill(' '),
            _ => self.cells.fill(' '),
        }
    }

    fn erase_line(&mut self, mode: usize) {
        let start = self.row * self.cols;
        let at = start + self.col;
        match mode {
            0 => self.cells[at..start + self.cols].fill(' '),
            1 => self.cells[start..=at].fill(' '),
            _ => self.cells[start..start + self.cols].fill(' '),
        }
    }

    fn blank_cells(&mut self, count: usize) {
        let start = self.row * self.cols + self.col;
        let end = (start + count).min(self.row * self.cols + self.cols);
        self.cells[start..end].fill(' ');
    }

    fn delete_cells(&mut self, count: usize) {
        let line = self.row * self.cols;
        let at = line + self.col;
        let end = line + self.cols;
        let count = count.min(end - at);
        self.cells.copy_within(at + count..end, at);
        self.cells[end - count..end].fill(' ');
    }

    fn insert_cells(&mut self, count: usize) {
        let line = self.row * self.cols;
        let at = line + self.col;
        let end = line + self.cols;
        let count = count.min(end - at);
        self.cells.copy_within(at..end - count, at + count);
        self.cells[at..at + count].fill(' ');
    }

    /// Rolls the rows between `first` and `last` up, blanking what comes in at
    /// the bottom.
    fn shift_up(&mut self, first: usize, last: usize, count: usize) {
        if first > last {
            return;
        }
        let count = count.min(last - first + 1);
        let from = (first + count) * self.cols;
        let to = (last + 1) * self.cols;
        self.cells.copy_within(from..to, first * self.cols);
        self.cells[to - count * self.cols..to].fill(' ');
    }

    /// And down, blanking what comes in at the top.
    fn shift_down(&mut self, first: usize, last: usize, count: usize) {
        if first > last {
            return;
        }
        let count = count.min(last - first + 1);
        let from = first * self.cols;
        let to = (last + 1 - count) * self.cols;
        self.cells
            .copy_within(from..to, (first + count) * self.cols);
        self.cells[from..from + count * self.cols].fill(' ');
    }
}

/// Whether a character takes two columns rather than one.
///
/// The ranges rather than the tables: what this is for is keeping a box drawn
/// around Japanese text square, and the characters that are actually wide in
/// anything an agent prints are all in the blocks below. A character this is
/// wrong about costs one column on one line of one reading.
fn wide(letter: char) -> bool {
    matches!(
        letter as u32,
        0x1100..=0x115F
            | 0x2E80..=0x303E
            | 0x3041..=0x33FF
            | 0x3400..=0x4DBF
            | 0x4E00..=0x9FFF
            | 0xA000..=0xA4CF
            | 0xA960..=0xA97F
            | 0xAC00..=0xD7A3
            | 0xF900..=0xFAFF
            | 0xFE10..=0xFE19
            | 0xFE30..=0xFE6F
            | 0xFF00..=0xFF60
            | 0xFFE0..=0xFFE6
            | 0x1F300..=0x1F64F
            | 0x1F680..=0x1F6FF
            | 0x1F900..=0x1F9FF
            | 0x20000..=0x3FFFD
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A permission box the shape all three of them draw: what it is about, a
    /// blank line, the question, and the numbered answers.
    pub(super) fn asking_box() -> String {
        [
            "\u{1b}[2J\u{1b}[H",
            "╭──────────────────────────────────────────────╮\r\n",
            "│ Bash command                                 │\r\n",
            "│                                              │\r\n",
            "│   rm -rf build/                              │\r\n",
            "│   Remove the build directory                 │\r\n",
            "│                                              │\r\n",
            "│ Do you want to proceed?                      │\r\n",
            "│ ❯ 1. Yes                                     │\r\n",
            "│   2. Yes, and don't ask again                │\r\n",
            "│   3. No, and tell Claude what to do instead  │\r\n",
            "│                                              │\r\n",
            "╰──────────────────────────────────────────────╯\r\n",
        ]
        .concat()
    }

    fn screen_of(text: &str) -> Screen {
        let mut screen = Screen::new(24, 60);
        screen.feed(text);
        screen
    }

    #[test]
    fn a_prompt_box_is_read_as_a_question_with_answers() {
        let found = read(&screen_of(&asking_box())).expect("the box is a question");

        assert_eq!(found.question, "Do you want to proceed?");
        assert_eq!(
            found.detail,
            vec![
                "Bash command".to_string(),
                "rm -rf build/".to_string(),
                "Remove the build directory".to_string(),
            ]
        );
        assert_eq!(
            found
                .choices
                .iter()
                .map(|choice| (choice.key.as_str(), choice.selected))
                .collect::<Vec<_>>(),
            vec![("1", true), ("2", false), ("3", false)]
        );
        assert_eq!(found.choices[1].label, "Yes, and don't ask again");
    }

    /// The one thing that tells a question from a list somebody wrote: what is
    /// under it. An agent that has answered goes on drawing, and the numbered
    /// list left up the screen is not being asked any more.
    #[test]
    fn a_numbered_list_with_the_conversation_under_it_is_not_a_question() {
        let mut text = asking_box();
        text.push_str("\r\n⏺ Removed the build directory.\r\n");
        text.push_str("╭──────────────────────────────────────────────╮\r\n");
        text.push_str("│ > Try \"fix the failing test\"                 │\r\n");
        text.push_str("╰──────────────────────────────────────────────╯\r\n");

        assert!(read(&screen_of(&text)).is_none());
    }

    /// A list that does not count from one was written rather than offered.
    #[test]
    fn a_list_that_does_not_count_from_one_is_not_a_question() {
        let text = [
            "Which of these did you mean?\r\n",
            "  2. the second one\r\n",
            "  3. the third one\r\n",
        ]
        .concat();

        assert!(read(&screen_of(&text)).is_none());
    }

    /// A question with nothing but its answers is still a question; what it
    /// cannot be is a question with nothing to answer.
    #[test]
    fn one_answer_is_not_a_list() {
        let text = "Carry on?\r\n❯ 1. Yes\r\n";
        assert!(read(&screen_of(text)).is_none());
    }

    /// The whole reason the screen is followed rather than the stream: an agent
    /// redraws its box by going back up over what it drew last, and the reading
    /// has to be of what is there now.
    #[test]
    fn a_box_drawn_over_the_last_one_is_read_as_the_one_on_top() {
        let mut screen = screen_of(&asking_box());
        // Up over the box and drawn again, the way a selection moving down the
        // list is drawn: cursor up twelve, then the lines from there.
        screen.feed("\u{1b}[12A\u{1b}[J");
        screen.feed(
            &[
                "╭──────────────────────────────────────────────╮\r\n",
                "│ Bash command                                 │\r\n",
                "│                                              │\r\n",
                "│   rm -rf build/                              │\r\n",
                "│   Remove the build directory                 │\r\n",
                "│                                              │\r\n",
                "│ Do you want to proceed?                      │\r\n",
                "│   1. Yes                                     │\r\n",
                "│ ❯ 2. Yes, and don't ask again                │\r\n",
                "│   3. No, and tell Claude what to do instead  │\r\n",
                "│                                              │\r\n",
                "╰──────────────────────────────────────────────╯\r\n",
            ]
            .concat(),
        );

        let found = read(&screen).expect("the box is still a question");
        assert_eq!(found.choices.len(), 3, "the old box was drawn over");
        assert!(found.choices[1].selected, "the selection moved");
        assert!(!found.choices[0].selected);
    }

    /// An answer too long for the box runs on under itself, and is one answer.
    /// Drawn in the colours an agent actually draws it in, which a screen has
    /// to read straight through.
    #[test]
    fn an_answer_that_runs_on_is_still_one_answer() {
        let text = [
            "\u{256d}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{256e}\r\n",
            "\u{2502} \u{1b}[1mBash command\u{1b}[0m  \u{2502}\r\n",
            "\u{2502}                \u{2502}\r\n",
            "\u{2502}   rm -rf build/\u{2502}\r\n",
            "\u{2502}                \u{2502}\r\n",
            "\u{2502} Proceed?       \u{2502}\r\n",
            "\u{2502} \u{1b}[36m\u{276f} 1. Yes\u{1b}[0m      \u{2502}\r\n",
            "\u{2502}   2. Yes, and  \u{2502}\r\n",
            "\u{2502}      not again \u{2502}\r\n",
            "\u{2502}   3. No        \u{2502}\r\n",
            "\u{2570}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{256f}\r\n",
        ]
        .concat();

        let found = read(&screen_of(&text)).expect("the box is a question");
        assert_eq!(
            found.choices.len(),
            3,
            "the run-on line is not an answer of its own"
        );
        assert_eq!(found.choices[1].label, "Yes, and not again");
        assert!(
            found.choices[0].selected,
            "the colour is not part of the answer"
        );
        assert_eq!(
            found.detail,
            vec!["Bash command".to_string(), "rm -rf build/".to_string()]
        );
    }

    /// A box round Japanese text is only square if the wide characters in it
    /// take the two columns they are drawn in.
    #[test]
    fn wide_characters_take_two_columns() {
        let text = [
            "╭────────────────────────────╮\r\n",
            "│ 実行してよいですか?         │\r\n",
            "│ ❯ 1. はい                   │\r\n",
            "│   2. いいえ                 │\r\n",
            "╰────────────────────────────╯\r\n",
        ]
        .concat();

        let found = read(&screen_of(&text)).expect("a question in Japanese");
        assert_eq!(found.question, "実行してよいですか?");
        assert_eq!(found.choices[0].label, "はい");
        assert_eq!(found.choices[1].label, "いいえ");
    }

    /// What a full-screen agent draws, which is a box over a screen it owns all
    /// of: Codex and its like put their own composer at the foot of it, so
    /// nothing a question is drawn in is ever the last thing there.
    fn full_screen_box() -> String {
        [
            "\u{1b}[?1049h\u{1b}[?25l\u{1b}[2J\u{1b}[H",
            "┌ Shell Command ─────────────────────────────┐\r\n",
            "│ cargo test --all                           │\r\n",
            "│                                            │\r\n",
            "│ Allow this command to run?                 │\r\n",
            "│ ❯ 1. Yes, run it                           │\r\n",
            "│   2. Yes, and don't ask again              │\r\n",
            "│   3. No, and tell it what to do instead    │\r\n",
            "└────────────────────────────────────────────┘\r\n",
            "\r\n",
            "▌ Ask for something                          \r\n",
            "  ctrl+c to quit  ·  ? for shortcuts         \r\n",
            "  /model to switch model                     \r\n",
        ]
        .concat()
    }

    /// A question in a program that owns the whole screen.
    ///
    /// The rule that a question is the last thing drawn is a rule about a
    /// screen that scrolls, where the box left behind by an answered question
    /// stays up it. A program drawing the whole screen every frame has no such
    /// wreckage — and has its own composer under everything, so nothing it
    /// draws is ever last. What is asked of it instead is that the question be
    /// in a box and that the caret be put away.
    #[test]
    fn a_box_a_full_screen_program_drew_is_read_under_its_own_composer() {
        let found = read(&screen_of(&full_screen_box())).expect("the box is a question");

        assert_eq!(found.question, "Allow this command to run?");
        assert_eq!(found.detail, vec!["cargo test --all".to_string()]);
        assert_eq!(found.taking, Taking::Key);
        assert_eq!(found.choices.len(), 3);
        assert!(found.choices[0].selected);

        // The very same drawing on the screen that scrolls is three lines of
        // something drawn since, which is a question that has been answered.
        let scrolling = full_screen_box().replace("\u{1b}[?1049h", "");
        assert!(read(&screen_of(&scrolling)).is_none());
    }

    /// A list with no keys beside it, which is answered by walking the mark.
    ///
    /// What the agents built on a full-screen library draw: the answers are
    /// lines, the one you are standing on has the mark, and there is nothing to
    /// press but the arrows and return.
    #[test]
    fn a_list_with_no_keys_is_read_as_one_to_walk() {
        let text = [
            "\u{1b}[?1049h\u{1b}[?25l\u{1b}[2J\u{1b}[H",
            "╭────────────────────────────────╮\r\n",
            "│ rm -rf build/                  │\r\n",
            "│                                │\r\n",
            "│ Run this command?              │\r\n",
            "│   Allow once                   │\r\n",
            "│ ❯ Allow always                 │\r\n",
            "│   Deny                         │\r\n",
            "╰────────────────────────────────╯\r\n",
            "  esc to cancel                  \r\n",
        ]
        .concat();

        let found = read(&screen_of(&text)).expect("the box is a question");
        assert_eq!(found.taking, Taking::Walk);
        assert_eq!(found.question, "Run this command?");
        assert_eq!(found.detail, vec!["rm -rf build/".to_string()]);
        assert_eq!(
            found
                .choices
                .iter()
                .map(|choice| (choice.key.as_str(), choice.label.as_str(), choice.selected))
                .collect::<Vec<_>>(),
            vec![
                ("1", "Allow once", false),
                ("2", "Allow always", true),
                ("3", "Deny", false),
            ]
        );
    }

    /// The same shape a question-and-answer library draws it in, on a screen
    /// that scrolls: the question above, the mark on the line you are on.
    #[test]
    fn a_list_walked_on_an_ordinary_screen_is_a_question_too() {
        let text = [
            "? Which template? (Use arrow keys)\r\n",
            "❯ TypeScript\r\n",
            "  JavaScript\r\n",
        ]
        .concat();

        let found = read(&screen_of(&text)).expect("a list to walk");
        assert_eq!(found.taking, Taking::Walk);
        assert_eq!(found.question, "? Which template? (Use arrow keys)");
        assert_eq!(found.choices.len(), 2);
        assert!(found.choices[0].selected);
    }

    /// A message half written is not a list to be walked.
    ///
    /// Two lines typed into an agent's own composer are a mark on the first and
    /// the second lined up under it, which is exactly what a list with the mark
    /// on its first line looks like. What tells them apart is the caret, which
    /// is in the composer because that is where the typing is going — and the
    /// cost of getting it wrong is not a card too many: it is a card that sends
    /// somebody's half-written message by walking it.
    #[test]
    fn a_message_being_written_is_not_a_list_to_walk() {
        let composing = [
            "╭──────────────────────────────────────╮\r\n",
            "│ > the first thing I want             │\r\n",
            "│   and the second                     │",
        ]
        .concat();
        assert!(read(&screen_of(&composing)).is_none());

        // The same drawing with the caret away from it is a list again: that is
        // what a program that has finished drawing one leaves behind.
        let away = composing.clone() + "\u{1b}[?25l";
        assert!(read(&screen_of(&away)).is_some());
    }

    /// The one thing that tells a list being offered from a list being written:
    /// a paragraph of bullets marks every line, and a list being chosen from
    /// marks the one the agent is standing on.
    #[test]
    fn a_bulleted_paragraph_is_not_a_list_to_walk() {
        let text = [
            "Here is what I found:\r\n",
            "● the test was never run\r\n",
            "● the fixture is stale\r\n",
        ]
        .concat();

        assert!(read(&screen_of(&text)).is_none());
    }

    /// The oldest way of asking anything at a terminal, and still the
    /// commonest. The one printed in capitals is the one a bare return takes.
    #[test]
    fn a_line_offering_yes_or_no_is_a_question() {
        let found = read(&screen_of("Delete the branch old-work? [y/N] ")).expect("a question");

        assert_eq!(found.taking, Taking::Line);
        assert_eq!(found.question, "Delete the branch old-work? [y/N]");
        assert_eq!(
            found
                .choices
                .iter()
                .map(|choice| (choice.key.as_str(), choice.label.as_str(), choice.selected))
                .collect::<Vec<_>>(),
            vec![("y", "Yes", false), ("n", "No", true)]
        );

        // The letters that mean something the line never says are left where
        // they are explained.
        assert!(read(&screen_of("Stage this hunk [y,n,q,a,d,e,?]? ")).is_none());
    }

    /// A question with nothing under it, which is answered by writing.
    #[test]
    fn a_line_asking_to_be_written_at_is_a_question() {
        let found = read(&screen_of("Enter a name for the branch: ")).expect("a question");

        assert_eq!(found.taking, Taking::Words);
        assert_eq!(found.question, "Enter a name for the branch:");
        assert!(found.choices.is_empty());

        // And the mark those libraries all ask with, with the answer they have
        // written in for you left where it is.
        let asked = read(&screen_of("? What is your project named? › my-app")).expect("a question");
        assert_eq!(asked.taking, Taking::Words);
        assert_eq!(asked.question, "What is your project named?");
    }

    /// An agent with nothing to do is not asking anything.
    ///
    /// The whole difficulty of reading a written answer, in one test: a
    /// composer is a box with a mark and a caret in it, which is what a
    /// question wanting words looks like — and it stands there all day. The
    /// shape is left alone, at the cost of the questions an agent asks inside
    /// its own composer, which are the terminal's to answer.
    #[test]
    fn a_composer_with_nothing_in_it_is_not_a_question() {
        let idle = [
            "╭──────────────────────────────────────────╮\r\n",
            "│ > Try \"fix the failing test\"             │",
        ]
        .concat();
        assert!(read(&screen_of(&idle)).is_none());

        // Nor is a shell sitting at its own prompt, whatever the prompt says,
        // and nor is a command half typed at one that happens to end the way a
        // question ends.
        assert!(read(&screen_of("~/repo/totex on main $ ")).is_none());
        assert!(read(&screen_of("bash-5.2$ printf 'Enter a name: ")).is_none());
        // Nor is anything that stopped asking and went on writing.
        assert!(read(&screen_of("Enter a name: alpha\r\nDone.\r\n")).is_none());
        // Nor a question whose caret has been put away, which is a question
        // being drawn rather than asked.
        assert!(read(&screen_of("\u{1b}[?25lEnter a name: ")).is_none());
    }

    /// The one elicitation that is never drawn on a card.
    #[test]
    fn a_password_is_left_in_the_terminal() {
        assert!(read(&screen_of("Enter the deploy password: ")).is_none());
        assert!(read(&screen_of("[sudo] password for a: ")).is_none());
        assert!(read(&screen_of("Enter passphrase for key '/home/a/.ssh/id': ")).is_none());
    }

    /// An agent that offers one way on has still stopped and asked, when the
    /// box says that is what it is doing.
    #[test]
    fn one_answer_in_a_box_is_a_question() {
        let text = [
            "╭──────────────────────────────╮\r\n",
            "│ The plan is ready            │\r\n",
            "│                              │\r\n",
            "│ Shall I start?               │\r\n",
            "│ ❯ 1. Yes, go ahead           │\r\n",
            "╰──────────────────────────────╯\r\n",
        ]
        .concat();

        let found = read(&screen_of(&text)).expect("a question with one way on");
        assert_eq!(found.choices.len(), 1);
        assert_eq!(found.question, "Shall I start?");
    }

    /// The lists that count in letters, and the ones that count from nothing.
    #[test]
    fn a_list_may_count_in_letters_or_from_zero() {
        let letters = ["Which one?\r\n", "❯ a) keep it\r\n", "  b) drop it\r\n"].concat();
        let found = read(&screen_of(&letters)).expect("a lettered list");
        assert_eq!(found.taking, Taking::Key);
        assert_eq!(found.choices[1].key, "b");

        let zero = ["Which one?\r\n", "❯ 0. keep it\r\n", "  1. drop it\r\n"].concat();
        let found = read(&screen_of(&zero)).expect("a list counting from zero");
        assert_eq!(found.choices[0].key, "0");

        // And a list that begins in the middle of itself is still no list.
        let middle = ["Which one?\r\n", "❯ c) keep it\r\n", "  d) drop it\r\n"].concat();
        assert!(read(&screen_of(&middle)).is_none());
    }

    /// A question drawn between two rules instead of in a box.
    ///
    /// What an agent that puts the whole of its output on the screen again
    /// every time draws: a rule, the question, the answers, and under them the
    /// rest of its own drawing — a line to chat on, another rule, the
    /// shortcuts. Nothing about it is a box, and the answers are not the last
    /// thing on the screen, which is the shape that was being turned down
    /// before this. It matters because that is what the questions with several
    /// parts are drawn in: only the last screen of one, the one asking whether
    /// to send, has nothing under its answers — so the only card that ever
    /// stood was the one at the end.
    #[test]
    fn a_question_between_two_rules_is_a_question() {
        let rule = "\u{2500}".repeat(52);
        let text = [
            "\r\n",
            &format!("{rule}\r\n"),
            "\u{2190}  Q1  \u{2714} Submit  \u{2192}\r\n",
            "Which approach do you want?\r\n",
            "\r\n",
            "\u{276f} 1. Rewrite the reader\r\n",
            "  2. Patch the check\r\n",
            "  3. Other\r\n",
            "\r\n",
            &format!("{rule}\r\n"),
            "  4. Chat about this\r\n",
            "\r\n",
            "  enter select \u{b7} tab switch questions \u{b7} escape cancel\r\n",
        ]
        .concat();

        let found = read(&screen_of(&text)).expect("a question between two rules");
        assert_eq!(found.question, "Which approach do you want?");
        assert_eq!(found.taking, Taking::Key);
        // The answer under the rule is one of the answers: it is pressed at the
        // terminal exactly as the three above it are, and the rule between them
        // is a line drawn, not a list ended.
        assert_eq!(
            found
                .choices
                .iter()
                .map(|choice| choice.label.as_str())
                .collect::<Vec<_>>(),
            vec![
                "Rewrite the reader",
                "Patch the check",
                "Other",
                "Chat about this",
            ]
        );
        assert!(found.choices[0].selected);
        // And what stands between the rule and the question is what the
        // question is about, exactly as the head of a box is: the rule is the
        // edge of the drawing, so the line under it is inside it.
        assert_eq!(found.detail, vec!["←  Q1  ✔ Submit  →".to_string()]);
    }

    /// The same question with a pane of its own beside the answers.
    ///
    /// The answers are down the left and what an answer would come to is drawn
    /// in a box to the right of them, on the same rows — so an answer read off
    /// a row comes away with the side of that box stuck to it, and what stands
    /// under the last answer is the foot of that box and whatever the agent
    /// wrote below it.
    #[test]
    fn a_pane_beside_the_answers_is_not_part_of_them() {
        let rule = "\u{2500}".repeat(52);
        let text = [
            "\r\n",
            &format!("{rule}\r\n"),
            "\u{2190}  Q1  \u{2714} Submit  \u{2192}\r\n",
            "Which approach do you want?\r\n",
            "\r\n",
            "\u{276f} 1. Rewrite the reader   \u{256d}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{256e}\r\n",
            "  2. Patch the check      \u{2502} none \u{2502}\r\n",
            "  3. Other                \u{2570}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{256f}\r\n",
            "\r\n",
            "                          Notes: press n\r\n",
            "\r\n",
            &format!("{rule}\r\n"),
            "  Chat about this\r\n",
            "\r\n",
            "  enter select \u{b7} escape cancel\r\n",
        ]
        .concat();

        let found = read(&screen_of(&text)).expect("a question with a pane beside it");
        assert_eq!(found.question, "Which approach do you want?");
        assert_eq!(
            found
                .choices
                .iter()
                .map(|choice| choice.label.as_str())
                .collect::<Vec<_>>(),
            vec!["Rewrite the reader", "Patch the check", "Other"],
        );
    }

    /// What a full-screen agent draws on the screen it owns, with the composer
    /// taken down while it waits.
    ///
    /// Read off Claude Code, which is the shape of nearly every question this
    /// window is ever shown: the alternate screen, no box anywhere, a rule over
    /// the question, the answers with what each of them comes to set under it,
    /// another rule across the list, and under the lot of it one line of
    /// shortcuts. The caret is put away and left standing on the row the agent
    /// is on, which is the drawing this reading has to tell from a composer
    /// waiting to be typed at.
    ///
    /// `on` is which answer the mark is against, and `caret` where the cursor
    /// was left, in rows and columns from the top left.
    fn ruled_question(on: usize, caret: (usize, usize)) -> String {
        let rule = "\u{2500}".repeat(58);
        let answers = [
            ("Rewrite the reader", "Start from the screen again"),
            ("Patch the check", "Leave the shape alone"),
            ("Hold it as it is", "Nothing changes today"),
        ];
        let mut drawn = String::from("\u{1b}[?1049h\u{1b}[?25l\u{1b}[2J\u{1b}[H");
        drawn.push_str("\u{25cf} Right, here we go.\r\n");
        drawn.push_str(&format!("{rule}\r\n"));
        drawn.push_str(" \u{2610} Approach\r\n\r\n");
        drawn.push_str("Which approach should we take for the reader?\r\n\r\n");
        for (at, (answer, under)) in answers.iter().enumerate() {
            let mark = if at == on { '\u{276f}' } else { ' ' };
            drawn.push_str(&format!("{mark} {}. {answer}\r\n", at + 1));
            drawn.push_str(&format!("     {under}\r\n"));
        }
        // The row that is a place to type rather than a thing to press, drawn
        // as one more answer with what it is for written in it.
        let mark = if on == 3 { '\u{276f}' } else { ' ' };
        drawn.push_str(&format!("{mark} 4. Type something.\r\n"));
        drawn.push_str(&format!("{rule}\r\n"));
        let mark = if on == 4 { '\u{276f}' } else { ' ' };
        drawn.push_str(&format!("{mark} 5. Chat about this\r\n\r\n"));
        drawn.push_str(
            "Enter to select \u{b7} \u{2191}/\u{2193} to navigate \u{b7} Esc to cancel\r\n",
        );
        let (row, col) = caret;
        drawn.push_str(&format!("\u{1b}[{};{}H", row + 1, col + 1));
        drawn
    }

    #[test]
    fn a_question_a_full_screen_agent_drew_in_place_of_its_composer_is_a_question() {
        let found = read(&screen_of(&ruled_question(0, (6, 0)))).expect("the rules are a question");

        assert_eq!(
            found.question,
            "Which approach should we take for the reader?"
        );
        assert_eq!(found.taking, Taking::Key);
        // Every row of the list is an answer, the place to type and the way out
        // of the question included: each of them is pressed at the terminal by
        // the key the agent printed beside it.
        assert_eq!(
            found
                .choices
                .iter()
                .map(|choice| (choice.key.as_str(), choice.label.as_str()))
                .collect::<Vec<_>>(),
            vec![
                ("1", "Rewrite the reader Start from the screen again"),
                ("2", "Patch the check Leave the shape alone"),
                ("3", "Hold it as it is Nothing changes today"),
                ("4", "Type something."),
                ("5", "Chat about this"),
            ]
        );
        assert!(found.choices[0].selected);
        // What the question is about is the line between the rule and the
        // question, and the transcript above the rule is not.
        assert_eq!(found.detail, vec!["☐ Approach".to_string()]);
        // The caret is standing on the answer the mark is on, at the head of
        // it, because that is where a program keeps a cursor it is not typing
        // with. Nothing is being written at.
        assert!(!found.writing);
    }

    /// The one row of such a list that is a place to type, told by where the
    /// caret is standing along it.
    #[test]
    fn the_caret_in_among_the_words_is_a_row_being_written_at() {
        // Walked down to the row that takes words, where the caret goes to the
        // front of what would be typed rather than to the front of the row.
        let found = read(&screen_of(&ruled_question(3, (12, 5)))).expect("still a question");
        assert!(found.writing);
        assert!(found.choices[3].selected);

        // And the same walk onto the answer under the rule, which is a thing to
        // press: the caret goes back to the head of the row.
        let found = read(&screen_of(&ruled_question(4, (14, 0)))).expect("still a question");
        assert!(!found.writing);
        assert!(found.choices[4].selected);
    }

    /// A permission prompt from the same agent: the tool and the file over a
    /// dashed rule, what it would come to under it, and the question below
    /// that.
    #[test]
    fn a_diff_between_dashed_rules_is_what_the_question_is_about() {
        let rule = "\u{2500}".repeat(58);
        let dashes = "\u{254c}".repeat(58);
        let text = [
            "\u{1b}[?1049h\u{1b}[?25l\u{1b}[2J\u{1b}[H",
            "\u{25cf} Write(notes.txt)\r\n\r\n",
            &format!("{rule}\r\n"),
            " Create file\r\n",
            " notes.txt\r\n",
            &format!("{dashes}\r\n"),
            "  1 one\r\n",
            "  2 two\r\n",
            "  3 three\r\n",
            &format!("{dashes}\r\n"),
            " Do you want to create notes.txt?\r\n",
            " \u{276f} 1. Yes\r\n",
            "   2. Yes, and switch to accept edits for this session\r\n",
            "   3. No\r\n",
            "\r\n",
            " Esc to cancel \u{b7} Tab to amend\r\n",
        ]
        .concat();

        let found = read(&screen_of(&text)).expect("the prompt is a question");
        assert_eq!(found.question, "Do you want to create notes.txt?");
        assert_eq!(found.choices.len(), 3);
        // The dashes are drawing inside the question rather than the edge of
        // it, so what is above them is still what the question is about.
        assert_eq!(
            found.detail,
            vec![
                "Create file".to_string(),
                "notes.txt".to_string(),
                "1 one".to_string(),
                "2 two".to_string(),
                "3 three".to_string(),
            ]
        );

        // The same prompt over a diff longer than the walk up to the rule is
        // worth taking: the dashed line above the question says the question is
        // drawn in something, wherever the top of it has got to.
        let long = text.replace(
            "  2 two\r\n",
            &(1..14)
                .map(|line| format!("  {line} more\r\n"))
                .collect::<String>(),
        );
        let found = read(&screen_of(&long)).expect("still a question");
        assert_eq!(found.question, "Do you want to create notes.txt?");
        assert_eq!(found.choices.len(), 3);

        // Answered, and the agent goes on writing under it with its composer
        // back: the same drawing is then the wreckage of a question rather than
        // one being asked, and the composer under it is what says so.
        let mut screen = screen_of(&text);
        screen.feed("\u{25cf} Wrote notes.txt\r\n\r\n");
        screen.feed(&format!("{rule}\r\n\u{276f} \r\n{rule}\r\n"));
        screen.feed("  \u{23f8} manual mode on \u{b7} ? for shortcuts\r\n");
        assert!(read(&screen).is_none());
    }

    /// A list that takes several answers, which says so by drawing a box beside
    /// each of them.
    #[test]
    fn a_list_with_boxes_beside_it_is_one_to_pick_from() {
        let text = [
            "\u{256d}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{256e}\r\n",
            "\u{2502} Which of these?          \u{2502}\r\n",
            "\u{2502} \u{276f} 1. \u{2612} the first one   \u{2502}\r\n",
            "\u{2502}   2. \u{2610} the second one  \u{2502}\r\n",
            "\u{2502}   3. \u{2612} the third one   \u{2502}\r\n",
            "\u{2570}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{256f}\r\n",
        ]
        .concat();

        let found = read(&screen_of(&text)).expect("a list to pick from");
        assert!(found.picking);
        assert_eq!(found.choices[0].label, "the first one");
        assert_eq!(
            found
                .choices
                .iter()
                .map(|choice| choice.picked)
                .collect::<Vec<_>>(),
            vec![true, false, true]
        );

        // The same thing in the characters a terminal has always had.
        let plain = text.replace('\u{2612}', "[x]").replace('\u{2610}', "[ ]");
        let found = read(&screen_of(&plain)).expect("a list to pick from");
        assert!(found.picking);
        assert_eq!(found.choices[1].label, "the second one");
        assert!(!found.choices[1].picked);
    }

    /// A list that holds one answer marks it with a tick after the words, and
    /// is not a list to pick from.
    #[test]
    fn a_tick_after_an_answer_is_the_one_being_held() {
        let text = [
            "\u{256d}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{256e}\r\n",
            "\u{2502} Which one?               \u{2502}\r\n",
            "\u{2502} \u{276f} 1. keep it \u{2714}         \u{2502}\r\n",
            "\u{2502}   2. drop it             \u{2502}\r\n",
            "\u{2570}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{256f}\r\n",
        ]
        .concat();

        let found = read(&screen_of(&text)).expect("a question");
        assert!(
            !found.picking,
            "one answer held is not several to pick from"
        );
        assert_eq!(found.choices[0].label, "keep it");
        assert!(found.choices[0].picked);
        assert!(!found.choices[1].picked);
    }

    /// The answer with the caret standing in it is the one to be written at.
    ///
    /// Every agent offers one — "and tell it what to do instead" — and nothing
    /// in the words says which answer it is. The caret does: it stands on that
    /// row while that row is the one being typed into, and nowhere in the list
    /// otherwise.
    #[test]
    fn the_answer_the_caret_stands_in_is_one_to_write_at() {
        let text = [
            "\u{256d}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{256e}\r\n",
            "\u{2502} Do you want to proceed?          \u{2502}\r\n",
            "\u{2502}   1. Yes                         \u{2502}\r\n",
            "\u{2502}   2. Yes, and don't ask again    \u{2502}\r\n",
            "\u{2502} \u{276f} 3. No, and tell it instead    \u{2502}\r\n",
            "\u{2570}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{256f}\r\n",
        ]
        .concat();

        let standing = read(&screen_of(&text)).expect("a question");
        assert!(!standing.writing, "the caret is under the box");

        // The caret put back into the third answer, which is what an agent does
        // with the one of them that is a place to type.
        let mut screen = screen_of(&text);
        screen.feed("\u{1b}[5;32H");
        let found = read(&screen).expect("a question");
        assert!(found.writing);
        assert!(found.choices[2].selected);
    }

    /// Erasing, scrolling and the cursor being sent about: what a screen is for.
    #[test]
    fn the_screen_follows_what_it_is_told_to_do() {
        let mut screen = Screen::new(3, 10);
        screen.feed("one\r\ntwo\r\nthree\r\nfour");
        assert_eq!(screen.lines(), vec!["two", "three", "four"], "it scrolled");

        // Back to the top and over the first row.
        screen.feed("\u{1b}[1;1Hnine\u{1b}[K");
        assert_eq!(screen.lines(), vec!["nine", "three", "four"]);

        // A line wider than the screen carries on onto the next one.
        let mut narrow = Screen::new(2, 4);
        narrow.feed("abcdef");
        assert_eq!(narrow.lines(), vec!["abcd", "ef"]);
    }

    /// Output arrives in runs of whatever the process happened to write, and a
    /// sequence split across two of them is still one sequence.
    #[test]
    fn a_sequence_split_between_two_runs_still_arrives() {
        let mut screen = Screen::new(3, 10);
        screen.feed("one\r\ntwo");
        screen.feed("\u{1b}[1");
        screen.feed(";1Hten");
        assert_eq!(screen.lines(), vec!["ten", "two", ""]);
    }
}
