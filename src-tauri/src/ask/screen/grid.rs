//! What writing, erasing and scrolling do to the cells of a screen.

use super::Screen;

impl Screen {
    pub(super) fn reset(&mut self) {
        self.cells.fill(' ');
        self.row = 0;
        self.col = 0;
        self.top = 0;
        self.bottom = self.rows - 1;
    }

    pub(super) fn restore(&mut self) {
        let (row, col) = self.saved;
        self.row = row.min(self.rows - 1);
        self.col = col.min(self.cols - 1);
    }

    pub(super) fn put(&mut self, letter: char) {
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

    pub(super) fn newline(&mut self) {
        if self.row >= self.bottom {
            self.shift_up(self.top, self.bottom, 1);
        } else {
            self.row += 1;
        }
    }

    pub(super) fn erase_screen(&mut self, mode: usize) {
        let at = self.row * self.cols + self.col;
        match mode {
            0 => self.cells[at..].fill(' '),
            1 => self.cells[..=at].fill(' '),
            _ => self.cells.fill(' '),
        }
    }

    pub(super) fn erase_line(&mut self, mode: usize) {
        let start = self.row * self.cols;
        let at = start + self.col;
        match mode {
            0 => self.cells[at..start + self.cols].fill(' '),
            1 => self.cells[start..=at].fill(' '),
            _ => self.cells[start..start + self.cols].fill(' '),
        }
    }

    pub(super) fn blank_cells(&mut self, count: usize) {
        let start = self.row * self.cols + self.col;
        let end = (start + count).min(self.row * self.cols + self.cols);
        self.cells[start..end].fill(' ');
    }

    pub(super) fn delete_cells(&mut self, count: usize) {
        let line = self.row * self.cols;
        let at = line + self.col;
        let end = line + self.cols;
        let count = count.min(end - at);
        self.cells.copy_within(at + count..end, at);
        self.cells[end - count..end].fill(' ');
    }

    pub(super) fn insert_cells(&mut self, count: usize) {
        let line = self.row * self.cols;
        let at = line + self.col;
        let end = line + self.cols;
        let count = count.min(end - at);
        self.cells.copy_within(at..end - count, at + count);
        self.cells[at..at + count].fill(' ');
    }

    /// Rolls the rows between `first` and `last` up, blanking what comes in at
    /// the bottom.
    pub(super) fn shift_up(&mut self, first: usize, last: usize, count: usize) {
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
    pub(super) fn shift_down(&mut self, first: usize, last: usize, count: usize) {
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

/// Whether a character takes two columns rather than one. The ranges rather
/// than the tables: this keeps a box drawn around Japanese text square, and a
/// character it is wrong about costs one column on one line of one reading.
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
