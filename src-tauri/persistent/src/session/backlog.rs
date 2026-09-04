//! What a session has said, kept for a terminal that is not there yet.

/// How much is kept. A screenful is a couple of kilobytes, so this is a few
/// hundred of them: what a shell left alone for an hour has to be able to show.
/// This is a window's scrollback, not a log of the session.
pub(super) const KEPT: usize = 256 * 1024;

/// How far past that it may grow before it is cut back. Cutting on every run
/// would copy the whole backlog per keystroke; cutting once the slack is used
/// up is one copy per screenful.
pub(super) const SLACK: usize = 64 * 1024;

#[derive(Default)]
pub(super) struct Backlog {
    /// The tail of the output — all of it, until there is too much.
    pub text: String,
    /// Everything the session has ever said, in bytes, of which `text` holds the
    /// last `text.len()`. This is what tells a terminal which of the runs
    /// arriving live are already inside the text it was just handed.
    pub said: usize,
}

impl Backlog {
    /// Keeps a run of output, and says where it falls in the whole of it.
    pub fn keep(&mut self, data: &str) -> usize {
        let at = self.said;
        self.said += data.len();
        self.text.push_str(data);
        if self.text.len() > KEPT + SLACK {
            let cut = self.cut();
            self.text.drain(..cut);
        }
        at
    }

    /// Where the kept text begins once it has outgrown its room: a whole
    /// character, and the start of a line wherever one is near enough. Replaying
    /// from the middle of an escape sequence draws it as the letters it is
    /// written with.
    fn cut(&self) -> usize {
        let mut at = self.text.len() - KEPT;
        while at < self.text.len() && !self.text.is_char_boundary(at) {
            at += 1;
        }
        match self.text[at..].find('\n') {
            Some(line) if line <= SLACK => at + line + 1,
            _ => at,
        }
    }
}
