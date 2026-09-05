//! As much of a terminal as it takes to be redrawn into.
//!
//! Not an emulator: nothing here is drawn, so colour, style and mouse reporting
//! are read and dropped. What is kept is the part a question is made of — where
//! the cursor is, what is at each place, and what erasing and scrolling do to it
//! — because an agent drawing its prompt box moves the cursor up over what it
//! said last, and text taken from the stream as it arrives would be the box and
//! the wreckage of everything it was drawn over. There is no scrollback: what
//! has gone off the top is not what anybody is being asked.

mod ansi;
mod grid;

use super::glyph::SIDES;

/// What a reading needs to know about a screen besides the words on it, all of
/// it about the caret — the one thing on a terminal that says what is going to
/// happen next rather than what has happened.
pub struct Standing {
    /// Which row the caret is standing on.
    pub row: usize,
    /// How far along that row, distinguishing a parked cursor at the head of a
    /// choice from one standing in the text field of that choice.
    pub col: usize,
    /// Whether nothing is drawn between it and the end of that row.
    pub clear: bool,
    /// Whether the caret is being drawn at all.
    pub shown: bool,
    /// Whether this is the screen a full-screen program draws on.
    pub alt: bool,
    /// Whether something that draws has taken the terminal over, by either of
    /// the two ways there are of doing it.
    ///
    /// The alternate screen is the older one and the one that reads as a fact:
    /// a program on it has a screen of its own and hands it back on the way
    /// out. The newer agents do not take it — they draw down the ordinary
    /// screen so that what they said stays in the scrollback — and what they
    /// turn on instead is being told when the window is looked at, which a
    /// shell has no use for and which they turn off again as they go. Either
    /// one says the same thing: what is on this terminal is being drawn rather
    /// than printed.
    pub taken: bool,
}

/// Where the escape sequence being read has got to.
enum State {
    Ground,
    Escape,
    /// `ESC [` and whatever has arrived of it since.
    Csi,
    /// `ESC ]`, which runs until something ends it rather than to a length.
    Osc,
    /// A sequence whose one remaining character is of no interest here.
    Skip,
}

pub struct Screen {
    rows: usize,
    cols: usize,
    /// Row-major, `rows * cols` of them. The second half of a wide character is
    /// held as a nul, which reads as nothing and is skipped on the way out.
    cells: Vec<char>,
    /// Whether each row continues the preceding row through automatic wrapping.
    continued: Vec<bool>,
    row: usize,
    col: usize,
    /// The rows scrolling happens between, which is all of them by default.
    top: usize,
    bottom: usize,
    saved: (usize, usize),
    /// Standing past the last column with the next character due on the next
    /// row: a line exactly as wide as the screen must not push the next one
    /// down, so the cursor waits at the end of the row it filled.
    wrapping: bool,
    /// Whether the caret is being drawn, which is the one thing a program says
    /// about what it wants next.
    shown: bool,
    /// Whether this is the screen a full-screen program draws on.
    alt: bool,
    /// Whether something asked to be told when the window is looked at, which
    /// is the other half of `Standing::taken`.
    watched: bool,
    state: State,
    /// What has arrived so far of a sequence still coming: output is handed
    /// over in runs of whatever the process happened to have written.
    held: String,
}

impl Screen {
    pub fn new(rows: u16, cols: u16) -> Self {
        let rows = (rows as usize).max(1);
        let cols = (cols as usize).max(1);
        Self {
            rows,
            cols,
            cells: vec![' '; rows * cols],
            continued: vec![false; rows],
            row: 0,
            col: 0,
            top: 0,
            bottom: rows - 1,
            saved: (0, 0),
            wrapping: false,
            shown: true,
            alt: false,
            watched: false,
            state: State::Ground,
            held: String::new(),
        }
    }

    /// A new size, and a blank screen at it. Nothing drawn is carried over —
    /// whatever is running is about to redraw, which is what a resize is for —
    /// but which screen is in use, whether the caret is shown and whether
    /// anything asked to be told about the window are, because nothing redraws
    /// those.
    pub fn resize(&mut self, rows: u16, cols: u16) {
        if rows as usize == self.rows && cols as usize == self.cols {
            return;
        }
        let (shown, alt, watched) = (self.shown, self.alt, self.watched);
        *self = Self::new(rows, cols);
        self.shown = shown;
        self.alt = alt;
        self.watched = watched;
    }

    /// Where the caret is standing, and what that says about the screen.
    pub fn standing(&self) -> Standing {
        let from = self.row * self.cols;
        // Nothing between the caret and the end of the row, which says it is
        // standing after what is written there. A box's own right-hand side is
        // drawing rather than something written.
        let clear = self.cells[from + self.col..from + self.cols]
            .iter()
            .all(|cell| matches!(cell, ' ' | '\0') || SIDES.contains(cell));

        Standing {
            row: self.row,
            col: self.col,
            clear,
            shown: self.shown,
            alt: self.alt,
            taken: self.alt || self.watched,
        }
    }

    /// Every row, with the trailing blanks taken off.
    pub fn lines(&self) -> Vec<String> {
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

    /// The logical line before the caret, including automatic wraps but never
    /// explicit newlines. Shell prompts and commands can span several rows.
    pub fn before_caret(&self) -> String {
        let mut first = self.row;
        while first > 0 && self.continued[first] {
            first -= 1;
        }
        let end = self.row * self.cols + self.col + usize::from(self.wrapping);
        self.cells[first * self.cols..end]
            .iter()
            .filter(|cell| **cell != '\0')
            .collect()
    }

    pub fn feed(&mut self, text: &str) {
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
}
