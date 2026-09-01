//! What the readings are held to, drawn the way the agents actually draw it.

mod doing;
mod frame;
mod keyed;
mod prompt;
mod screen;
mod typed;
mod walk;

use super::Screen;

/// A permission box the shape all three of them draw: what it is about, a blank
/// line, the question, and the numbered answers.
pub(crate) fn asking_box() -> String {
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

/// What a full-screen agent draws: a box over a screen it owns all of, with its
/// own composer at the foot, so nothing it draws is ever the last thing there.
pub(super) fn full_screen_box() -> String {
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

pub(super) fn screen_of(text: &str) -> Screen {
    let mut screen = Screen::new(24, 60);
    screen.feed(text);
    screen
}

/// The labels a reading found, in order.
pub(super) fn labels(reading: &super::Reading) -> Vec<&str> {
    reading
        .choices
        .iter()
        .map(|choice| choice.label.as_str())
        .collect()
}
