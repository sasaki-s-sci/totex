//! The characters an agent draws a question with, and what a line made of them
//! says before anything on it has been read as words.

/// The characters an agent marks its own selection with.
pub const MARKERS: [char; 6] = ['❯', '>', '▶', '›', '»', '●'];
/// What a shell ends its prompt with: a line opening with one of these is
/// somewhere to type rather than something being asked.
pub const SIGILS: [char; 3] = ['$', '%', '#'];
/// The sides of a box, which are drawing rather than text.
pub const SIDES: [char; 4] = ['│', '┃', '║', '▌'];
/// What a box begins with, on the line above everything it holds.
const TOPS: [char; 5] = ['╭', '┌', '╔', '┏', '╒'];
/// And what it ends with, which says the question is the last thing in it.
const BOTTOMS: [char; 5] = ['╰', '└', '╚', '┗', '╘'];
/// What a rule is drawn with, wherever one is drawn.
const RULES: [char; 4] = ['─', '═', '━', '-'];
/// What a rule drawn inside a question is dashed with. Unlike a solid rule,
/// this divides the question's own drawing rather than ending it.
const DASHES: [char; 6] = ['╌', '╍', '┄', '┅', '┈', '┉'];
/// The box an agent fills in beside an answer it is holding, and leaves empty
/// beside one it is not. A box at all is what says the list takes several.
pub const TAKEN: [char; 4] = ['☑', '☒', '◉', '⦿'];
pub const UNTAKEN: [char; 3] = ['☐', '◯', '○'];
/// And the tick set after the one answer a single-answer list is holding.
pub const TICKS: [char; 3] = ['✔', '✓', '√'];
/// What is being asked for when nothing should be drawn on a card: a card is
/// left lying open in a window somebody may well be sharing.
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

/// A line with the box it is drawn in taken off it, keeping the indentation
/// inside the box: how far in a line begins is what tells an answer running on
/// under itself from a new line of the box.
pub fn undressed(line: &str) -> &str {
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

/// What is left of an answer when the pane an agent drew to the right of the
/// list — which shares the row and so comes away stuck to it — is taken off.
pub fn beside(label: &str) -> &str {
    let drawn = |letter: char| {
        SIDES.contains(&letter) || TOPS.contains(&letter) || BOTTOMS.contains(&letter)
    };
    match label.char_indices().find(|(_, letter)| drawn(*letter)) {
        Some((at, _)) => label[..at].trim(),
        None => label.trim(),
    }
}

/// How far in a line begins, in characters.
pub fn indent(line: &str) -> usize {
    line.chars().take_while(|letter| *letter == ' ').count()
}

pub fn blank(line: &str) -> bool {
    line.trim().is_empty()
}

pub fn is_top(line: &str) -> bool {
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

/// A line drawn the width of what it is under and neither the top of a box nor
/// its foot: what an agent draws instead of a box when it redraws its whole
/// output, and it closes a question off the same way a box's foot does.
pub fn is_rule(line: &str) -> bool {
    is_edge(line) && !is_top(line) && !is_bottom(line)
}

/// A border or a rule: drawing rather than anything anybody wrote.
pub fn is_edge(line: &str) -> bool {
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

/// A dashed rule inside a question rather than an edge around it.
pub fn is_dashed(line: &str) -> bool {
    let line = line.trim();
    !line.is_empty()
        && line
            .chars()
            .all(|letter| DASHES.contains(&letter) || letter == ' ')
}

/// Whether what is being asked for is something not to be drawn on a canvas.
pub fn secret(text: &str) -> bool {
    let said = text.to_lowercase();
    if SECRETS.iter().any(|word| said.contains(word)) {
        return true;
    }
    said.split(|letter: char| !letter.is_alphanumeric())
        .any(|word| SECRET_WORDS.contains(&word))
}

/// Whether a line ends the way a question ends: a colon or a question mark with
/// a word in front of it, so `Enter a name:` does and `In [1]:` does not.
pub fn ends_asking(text: &str) -> bool {
    let mut letters = text.trim_end().chars().rev();
    if !matches!(letters.next(), Some(':') | Some('?')) {
        return false;
    }
    letters.next().is_some_and(char::is_alphanumeric)
}

/// Whether a line has somewhere to type on it, which is what tells a shell's
/// prompt and an agent's composer from a question wanting words.
pub fn typed_at(text: &str) -> bool {
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
pub fn words(text: &str) -> usize {
    text.split_whitespace().count()
}

/// A question with the place its answer is typed taken off the end of it.
pub fn before_field(text: &str) -> String {
    for (at, letter) in text.char_indices() {
        if at > 0 && MARKERS.contains(&letter) && text[..at].ends_with(' ') {
            return text[..at].trim_end().to_string();
        }
    }
    text.to_string()
}
