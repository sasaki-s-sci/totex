//! What an agent running in a terminal is asking, read off the screen it drew
//! it on.
//!
//! The agents all stop and ask the same kind of question — may I run this, may
//! I write that, which of these did you mean — and every one of them draws it
//! the same way: a box at the foot of the screen holding what it is about, the
//! question itself, and a numbered list to answer it with. That box is the one
//! thing in a session that is not output at all. It is a turn: nothing else
//! happens until somebody takes it, and until then the window has no way of
//! saying so except by drawing the terminal it happens to be inside.
//!
//! So it is read here instead. There is no interface to ask — a terminal is a
//! stream of bytes for drawing with — which leaves the drawing itself as the
//! only place the question exists. The stream is followed into a screen, the
//! screen is looked at whenever it changes, and what is found on it is handed
//! to the window as a question with answers rather than as a picture of one.
//!
//! Two things follow from reading a drawing rather than an interface. The
//! screen below is deliberately partial — it is enough of a terminal to be
//! redrawn into, and no more — and the reading is a pattern rather than a
//! parse: it takes what is unmistakably a question being asked and leaves
//! everything else alone. A prompt it does not recognise is a prompt the graph
//! says nothing about, which is exactly what the graph said before.

use serde::Serialize;

/// One question, as it can be answered from anywhere the window draws it.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Ask {
    /// Which question this is, counted up through the life of one session.
    ///
    /// What an answer is addressed to. A card on the graph is drawn from a
    /// reading that is already a moment old, and the one thing that must never
    /// happen is a press that was meant for "may I delete this" arriving at
    /// whatever the agent went on to ask next — so the answer carries the
    /// number of the question it was drawn for, and is refused if that is no
    /// longer the question on the screen.
    pub seq: u64,
    /// What the question is about, in the order the box says it: the tool being
    /// asked for, the command, the file, whatever else was set above the
    /// question itself.
    pub detail: Vec<String>,
    /// The question, which is the line the numbered list answers.
    pub question: String,
    pub choices: Vec<Choice>,
}

/// One of the numbered answers, as the agent itself offered it.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Choice {
    /// What is typed to take it, which is the number the agent printed.
    ///
    /// Every one of these lists is answered by its own numbers — that is what
    /// the numbers are for — so an answer is a keystroke and not a walk down
    /// the list with the arrow keys, which would depend on where the agent's
    /// own cursor happens to be standing.
    pub key: String,
    pub label: String,
    /// Where the agent's own cursor is, so the card can show it rather than
    /// invent a selection of its own.
    pub selected: bool,
}

/// A question as it was read, before it is given a number.
#[derive(Clone, Debug, PartialEq)]
pub struct Reading {
    pub detail: Vec<String>,
    pub question: String,
    pub choices: Vec<Choice>,
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

/// How many lines an agent may set under its box and still be asking.
///
/// The shortcuts — `esc to cancel`, and its like. Two, because that is what the
/// three of them put there; a third line under a box is something that has been
/// drawn since, and something drawn since means the question has been answered.
const HINT_LINES: usize = 2;

/// The characters an agent marks its own selection with.
const MARKERS: [char; 6] = ['❯', '>', '▶', '›', '»', '●'];
/// The sides of a box, which are drawing rather than text.
const SIDES: [char; 4] = ['│', '┃', '║', '▌'];
/// What a box begins with, on the line above everything it holds.
const TOPS: [char; 5] = ['╭', '┌', '╔', '┏', '╒'];
/// And what it ends with, which is what says the question is the last thing in
/// it.
const BOTTOMS: [char; 5] = ['╰', '└', '╚', '┗', '╘'];
/// What a rule is drawn with, wherever one is drawn.
const RULES: [char; 6] = ['─', '═', '━', '┄', '┈', '-'];

/// The question being asked on a screen, if one is.
///
/// The shape looked for is a numbered list counting from one, at the foot of
/// the box it is drawn in, with the question on the line above it. All three
/// parts are required, and the last of them is the one that matters: a numbered
/// list is also how an agent writes out three suggestions in the middle of an
/// answer, and the difference between that and a question is that a question is
/// the last thing on the screen — nothing has been drawn under it, because
/// nothing else is going to happen until it is answered.
pub fn read(lines: &[String]) -> Option<Reading> {
    let inner: Vec<&str> = lines.iter().map(|line| undressed(line)).collect();

    // The last numbered list on the screen, taken from its foot upwards: an
    // agent that has asked twice has answered the first one, and what is left
    // of it above is history.
    let end = inner.iter().rposition(|line| choice_of(line).is_some())?;
    // Where the numbers themselves stand, which is what tells the rest of an
    // answer too long for one line from the question above the list. An answer
    // runs on under its own words; nothing else in the box is indented that
    // far.
    let column = number_column(inner[end])?;
    let runs = |line: &str| !blank(line) && !is_edge(line) && indent(line) > column;

    let mut start = end;
    while start > 0 && (choice_of(inner[start - 1]).is_some() || runs(inner[start - 1])) {
        start -= 1;
    }
    // The last answer runs on the same way as the ones above it.
    let mut foot = end;
    while foot + 1 < inner.len() && runs(inner[foot + 1]) {
        foot += 1;
    }

    // Counting from one, in order. A list that does not is a list that was
    // written rather than offered — a numbered fragment of somebody's answer,
    // or the tail of a longer list whose head has scrolled away.
    let mut choices: Vec<Choice> = Vec::new();
    for line in &inner[start..=foot] {
        match choice_of(line) {
            Some((number, label, selected)) => {
                if number as usize != choices.len() + 1 {
                    return None;
                }
                choices.push(Choice {
                    key: number.to_string(),
                    label,
                    selected,
                });
            }
            // The rest of the answer above it, which is one answer with the
            // line break taken out rather than two.
            None => match choices.last_mut() {
                Some(choice) => {
                    choice.label.push(' ');
                    choice.label.push_str(line.trim());
                }
                None => return None,
            },
        }
    }
    if choices.len() < 2 {
        return None;
    }

    // What is under it, which is the whole of what says this is being asked
    // rather than remembered.
    //
    // A question is the last thing on the screen: nothing else is going to be
    // drawn until it is answered, which is what a question is. An agent that
    // has been answered goes on writing, and the box it was answered in stays
    // up the screen for as long as the scrollback holds it — so what tells the
    // live question from that one is not the box, it is what is under it. Room
    // is left for the line or two of shortcuts an agent sets below its box, and
    // for nothing else.
    let mut closed = false;
    let mut spare = HINT_LINES;
    for line in &inner[foot + 1..] {
        if blank(line) {
            continue;
        }
        // Another box below this one: whatever is being drawn down there is
        // what the agent is doing now, and this is not it.
        if is_top(line) || choice_of(line).is_some() {
            return None;
        }
        if is_bottom(line) && !closed {
            closed = true;
            continue;
        }
        if !closed || spare == 0 {
            return None;
        }
        spare -= 1;
    }

    // The question: the nearest line above the list with anything on it. A
    // list that opens the box has none, and is still a question — what it is
    // asking is then said by the answers alone.
    let above = &inner[..start];
    let mut at = above.len();
    while at > 0 && blank(above[at - 1]) {
        at -= 1;
    }
    let question = match at.checked_sub(1) {
        Some(line) if !is_edge(above[line]) => {
            at = line;
            above[line].trim().to_string()
        }
        _ => String::new(),
    };

    Some(Reading {
        detail: detail_above(above, at),
        question,
        choices,
    })
}

/// What the box says above its question, in the order it says it.
///
/// Only ever what is inside the box: the walk stops at the top border, and a
/// question with no border above it within reach is left with no detail at all.
/// The lines above an unboxed prompt are the conversation, and the conversation
/// is not what is being asked about.
fn detail_above(above: &[&str], question: usize) -> Vec<String> {
    let floor = question.saturating_sub(BOX_LIMIT);
    let mut detail = Vec::new();
    let mut framed = false;
    let mut walk = question;

    while walk > floor {
        walk -= 1;
        let line = above[walk];
        if is_edge(line) {
            framed = is_top(line);
            break;
        }
        if blank(line) {
            continue;
        }
        detail.push(line.trim().to_string());
        if detail.len() >= DETAIL_LIMIT {
            // Whether the box goes on above this is no longer worth walking
            // for: what is kept is already more than the card can draw.
            framed = true;
            break;
        }
    }

    if !framed {
        return Vec::new();
    }
    detail.reverse();
    detail
}

/// One line of a numbered list, if that is what it is: which number, what it
/// says, and whether the agent's own cursor is on it.
fn choice_of(line: &str) -> Option<(u32, String, bool)> {
    let (number, selected, rest) = numbered(line)?;
    let label = rest.trim();
    if label.is_empty() {
        return None;
    }
    Some((number, label.to_string(), selected))
}

/// Where in a line its number stands, for a line that has one.
fn number_column(line: &str) -> Option<usize> {
    numbered(line)?;
    line.chars().position(|letter| letter.is_ascii_digit())
}

/// The number at the head of a line, what marked it, and what follows it.
fn numbered(line: &str) -> Option<(u32, bool, &str)> {
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
    // Two at the outside: these lists are three long, and a wider number is a
    // line of a document that happens to begin with one.
    if digits.is_empty() || digits.len() > 2 {
        return None;
    }

    let mut after = rest[digits.len()..].chars();
    if !matches!(after.next(), Some('.') | Some(')')) {
        return None;
    }
    let rest = after.as_str();
    // The space is part of the pattern: `1.5` is a number and `1. Yes` is an
    // answer.
    if !rest.starts_with(' ') {
        return None;
    }

    Some((digits.parse().ok()?, selected, rest))
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
            .all(|letter| RULES.contains(&letter) || letter == ' ')
}

/// A session's screen, and the question it has on it.
///
/// One of these per running session, fed everything the session says whether or
/// not a terminal is being drawn for it — a question is asked of the person and
/// not of the panel, and a session nobody has opened is exactly the one whose
/// question the graph has to carry.
pub struct Watcher {
    screen: Screen,
    asking: Option<Ask>,
    /// How many questions this session has asked, which is what numbers them.
    asked: u64,
}

impl Watcher {
    pub fn new(rows: u16, cols: u16) -> Self {
        Self {
            screen: Screen::new(rows, cols),
            asking: None,
            asked: 0,
        }
    }

    /// Follows a run of output, and says what is being asked when that changed.
    ///
    /// `None` for output that left the question as it was, which is nearly all
    /// of it: an agent writing a paragraph is a hundred of these, and the graph
    /// should hear about none of them.
    pub fn keep(&mut self, data: &str) -> Option<Option<Ask>> {
        self.screen.feed(data);
        self.settle(read(&self.screen.lines()))
    }

    pub fn resize(&mut self, rows: u16, cols: u16) {
        self.screen.resize(rows, cols);
    }

    pub fn asking(&self) -> Option<&Ask> {
        self.asking.as_ref()
    }

    /// Puts the question away once it has been answered.
    ///
    /// The agent will redraw the screen without it a moment later and the
    /// reading would clear itself, but a moment is exactly how long a card that
    /// has been pressed must not stay on the graph. False when it is no longer
    /// the question being asked, which is what refuses an answer meant for
    /// something else.
    pub fn answered(&mut self, seq: u64) -> bool {
        if self.asking.as_ref().is_some_and(|ask| ask.seq == seq) {
            self.asking = None;
            return true;
        }
        false
    }

    /// The reading against what was already being asked.
    fn settle(&mut self, reading: Option<Reading>) -> Option<Option<Ask>> {
        let Some(reading) = reading else {
            return self.asking.take().map(|_| None);
        };

        // The same question with the agent's own cursor on another line is the
        // same question. Numbering it afresh would refuse the answer somebody
        // is in the middle of giving, for no better reason than that they moved
        // the selection in the terminal while the card was up.
        let seq = match &self.asking {
            Some(held)
                if held.detail == reading.detail
                    && held.question == reading.question
                    && held.choices.len() == reading.choices.len()
                    && held
                        .choices
                        .iter()
                        .zip(&reading.choices)
                        .all(|(held, found)| {
                            held.key == found.key && held.label == found.label
                        }) =>
            {
                held.seq
            }
            _ => {
                self.asked += 1;
                self.asked
            }
        };

        let ask = Ask {
            seq,
            detail: reading.detail,
            question: reading.question,
            choices: reading.choices,
        };
        if self.asking.as_ref() == Some(&ask) {
            return None;
        }
        self.asking = Some(ask.clone());
        Some(Some(ask))
    }
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
struct Screen {
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
            state: State::Ground,
            held: String::new(),
        }
    }

    /// A new size, and a blank screen at it.
    ///
    /// Nothing is carried over. Everything on a terminal that has just been
    /// resized is about to be drawn again by whatever is running in it — that
    /// is what a resize is for — and reflowing a screen nobody will ever look
    /// at is work done to be immediately overwritten.
    fn resize(&mut self, rows: u16, cols: u16) {
        if rows as usize == self.rows && cols as usize == self.cols {
            return;
        }
        *self = Self::new(rows, cols);
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
            'c' => self.reset(),
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

        // A private sequence — `?25l` and the like — is a mode being set, and
        // the only ones that matter here are the two that swap screens.
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
            // Moving between the main screen and the one a full-screen program
            // draws on. Neither carries anything over, which is the whole of
            // what has to be true here.
            if matches!(letter, 'h' | 'l') && matches!(first, 47 | 1047 | 1049) {
                self.reset();
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
    fn asking_box() -> String {
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
        let found = read(&screen_of(&asking_box()).lines()).expect("the box is a question");

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

        assert!(read(&screen_of(&text).lines()).is_none());
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

        assert!(read(&screen_of(&text).lines()).is_none());
    }

    /// A question with nothing but its answers is still a question; what it
    /// cannot be is a question with nothing to answer.
    #[test]
    fn one_answer_is_not_a_list() {
        let text = "Carry on?\r\n❯ 1. Yes\r\n";
        assert!(read(&screen_of(text).lines()).is_none());
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

        let found = read(&screen.lines()).expect("the box is still a question");
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

        let found = read(&screen_of(&text).lines()).expect("the box is a question");
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

        let found = read(&screen_of(&text).lines()).expect("a question in Japanese");
        assert_eq!(found.question, "実行してよいですか?");
        assert_eq!(found.choices[0].label, "はい");
        assert_eq!(found.choices[1].label, "いいえ");
    }

    #[test]
    fn a_question_asked_twice_is_two_questions_and_a_redraw_is_one() {
        let mut watcher = Watcher::new(24, 60);

        let first = watcher
            .keep(&asking_box())
            .expect("the question is news")
            .expect("and it is being asked");
        assert_eq!(first.seq, 1);

        // The very same screen again: nothing to say.
        assert!(watcher.keep("").is_none());

        // Answered, and the agent draws on. The card goes away.
        watcher.screen.feed("\u{1b}[2J\u{1b}[H");
        watcher.screen.feed("⏺ Removed the build directory.\r\n");
        assert_eq!(watcher.keep(""), Some(None));
        assert!(watcher.asking().is_none());

        // And the next question is a different question.
        let second = watcher
            .keep(&asking_box())
            .expect("asked again")
            .expect("and being asked");
        assert_eq!(second.seq, 2, "an answer must not reach the wrong question");
    }

    #[test]
    fn a_selection_moving_leaves_the_question_the_one_it_was() {
        let mut watcher = Watcher::new(24, 60);
        let first = watcher.keep(&asking_box()).unwrap().unwrap();

        watcher.screen.feed("\u{1b}[2J\u{1b}[H");
        let moved = watcher
            .keep(&asking_box().replace("│ ❯ 1. Yes", "│   1. Yes"))
            .expect("the cursor moved")
            .expect("and it is still being asked");

        assert_eq!(moved.seq, first.seq, "the answer is still the same answer");
        assert!(!moved.choices[0].selected);
    }

    #[test]
    fn an_answer_to_a_question_that_has_moved_on_is_refused() {
        let mut watcher = Watcher::new(24, 60);
        let ask = watcher.keep(&asking_box()).unwrap().unwrap();

        assert!(!watcher.answered(ask.seq + 1), "not the question on screen");
        assert!(watcher.answered(ask.seq));
        assert!(watcher.asking().is_none(), "and it is put away at once");
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
