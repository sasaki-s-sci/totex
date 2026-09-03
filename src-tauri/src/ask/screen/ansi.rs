//! The escape sequences a screen follows, and the ones it reads and drops.

use super::{Screen, State};

impl Screen {
    pub(super) fn ground(&mut self, letter: char) {
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

    pub(super) fn escape(&mut self, letter: char) {
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
                self.watched = false;
                self.reset();
            }
            _ => {}
        }
    }

    pub(super) fn csi(&mut self, letter: char) {
        // Everything up to the letter that ends it is the parameters.
        if !('\u{40}'..='\u{7e}').contains(&letter) {
            self.held.push(letter);
            return;
        }
        self.state = State::Ground;
        self.wrapping = false;

        let held = std::mem::take(&mut self.held);
        let private = held.starts_with(['?', '<', '=', '>']);
        let numbers: Vec<usize> = held
            .trim_start_matches(['?', '<', '=', '>'])
            .split(';')
            .map(|part| part.trim().parse().unwrap_or(0))
            .collect();
        let first = numbers.first().copied().unwrap_or(0);

        if private {
            self.mode(letter, first);
            return;
        }
        self.moved(letter, &numbers, first.max(1));
    }

    /// A private sequence is a mode being set, and the only ones that matter
    /// here swap screens, put the caret away, or say that what is drawing wants
    /// to be told when the window is looked at.
    fn mode(&mut self, letter: char, first: usize) {
        if !matches!(letter, 'h' | 'l') {
            return;
        }
        match first {
            // Neither screen carries anything over to the other, which is the
            // whole of what has to be true here.
            47 | 1047 | 1049 => {
                self.alt = letter == 'h';
                self.reset();
            }
            25 => self.shown = letter == 'h',
            // Being told when the window is looked at. A shell has no use for
            // it and never asks; something drawing a screen asks as it starts
            // and unasks as it goes, which is what makes it the other half of
            // `Standing::taken` — see there for why the alternate screen alone
            // is no longer enough to say a program has taken the terminal.
            1004 => self.watched = letter == 'h',
            _ => {}
        }
    }

    fn moved(&mut self, letter: char, numbers: &[usize], count: usize) {
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
            'J' => self.erase_screen(numbers.first().copied().unwrap_or(0)),
            'K' => self.erase_line(numbers.first().copied().unwrap_or(0)),
            'L' => self.shift_down(self.row, self.bottom, count),
            'M' => self.shift_up(self.row, self.bottom, count),
            'S' => self.shift_up(self.top, self.bottom, count),
            'T' => self.shift_down(self.top, self.bottom, count),
            'P' => self.delete_cells(count),
            '@' => self.insert_cells(count),
            'X' => self.blank_cells(count),
            'r' => self.scroll_region(numbers),
            's' => self.saved = (self.row, self.col),
            'u' => self.restore(),
            _ => {}
        }
    }

    fn scroll_region(&mut self, numbers: &[usize]) {
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

    /// Ended by a bell or by the escape that begins the two-character ending;
    /// either way there is nothing in it for a screen.
    pub(super) fn osc(&mut self, letter: char) {
        if letter == '\u{7}' || letter == '\u{1b}' {
            self.state = State::Ground;
        }
    }
}
