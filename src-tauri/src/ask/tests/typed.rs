//! What the last thing typed at a session is read from, drawn the way the
//! shells and the agents actually draw it.
//!
//! The agent shapes below are the ones a real Claude Code was captured drawing
//! — a composer between two rules, the turn echoed back above it, and the
//! bullets it sets against everything it has done since.

use super::super::typed;
use super::super::watch::Watcher;
use super::screen_of;

/// The rule an agent draws its composer between, at the width of these screens.
fn rule() -> String {
    "\u{2500}".repeat(60)
}

/// A shell standing at its prompt with a command typed at it, which is the
/// whole of the ordinary case: the caret is at the end of what was typed, and
/// what is in front of the prompt's own sigil is the shell's business.
#[test]
fn a_command_typed_at_a_prompt_is_what_was_typed() {
    let screen = screen_of("a@box:~/repo$ cargo build --all");
    assert_eq!(typed(&screen).as_deref(), Some("cargo build --all"));
}

/// A prompt with nothing typed at it says nothing about what was typed before
/// it, which is what leaves the last reading standing.
#[test]
fn a_prompt_with_nothing_at_it_is_nothing() {
    assert_eq!(typed(&screen_of("a@box:~/repo$ ")), None);
}

/// The first place to type on the line rather than the last: a command may well
/// have a `>` in it, and the redirection is part of what was typed.
#[test]
fn a_redirection_is_part_of_the_command() {
    let screen = screen_of("a@box:~/repo$ cargo build > build.log");
    assert_eq!(typed(&screen).as_deref(), Some("cargo build > build.log"));
}

/// An agent's composer with something half typed into it. The caret stands at
/// the end of the words and the agent has hidden it, which is exactly the state
/// this reading is for.
#[test]
fn what_is_half_typed_into_a_composer_is_what_was_typed() {
    let text = [
        "\u{1b}[2J\u{1b}[H",
        &format!("{}\r\n", rule()),
        "\u{276f} List this fold",
    ]
    .concat();

    let screen = screen_of(&text);
    assert_eq!(typed(&screen).as_deref(), Some("List this fold"));
}

/// The caret is counted in columns, so a turn typed in Japanese is cut where
/// the caret really stands rather than that many characters along.
#[test]
fn a_turn_typed_in_japanese_is_read_whole() {
    let screen = screen_of("\u{276f} これを直して");
    assert_eq!(typed(&screen).as_deref(), Some("これを直して"));
}

/// The turn as the agent echoes it back, once it has been sent: the composer is
/// empty again, the agent is working, and what it was asked to do is standing
/// in its own transcript above.
#[test]
fn a_turn_the_agent_echoed_is_what_was_typed() {
    let text = [
        "\u{1b}[2J\u{1b}[H",
        "\u{276f} List this folder with ls -la\r\n",
        "\r\n",
        "\u{25cf} I will look at the folder.\r\n",
        "\r\n",
        "  Listing 1 directory\u{2026} (ctrl+o to expand)\r\n",
        "  \u{23bf}  $ ls -la\r\n",
        "\r\n",
        &format!("{}\r\n", rule()),
        "\u{276f}\r\n",
        &format!("{}\r\n", rule()),
        "  \u{23f8} manual mode on \u{b7} esc to interrupt\r\n",
    ]
    .concat();

    let screen = screen_of(&text);
    assert_eq!(
        typed(&screen).as_deref(),
        Some("List this folder with ls -la")
    );
}

/// And once that turn has scrolled off the top, nothing — not the bullet the
/// agent sets against what it has done, and not the command it ran under one.
/// Nothing is what leaves the watcher holding the turn it read while it was
/// still there.
#[test]
fn what_an_agent_says_it_has_done_is_not_what_was_typed() {
    let text = [
        "\u{1b}[2J\u{1b}[H",
        "\u{25cf} I will look at the folder.\r\n",
        "\r\n",
        "  Listed 1 directory (ctrl+o to expand)\r\n",
        "\r\n",
        "\u{25cf} Listing 1 directory\u{2026} (ctrl+o to expand)\r\n",
        "  \u{23bf}  $ ls -la\r\n",
        "\r\n",
        "\u{2735} Befuddling\u{2026} (8s \u{b7} \u{2193} 1.9k tokens)\r\n",
        "\r\n",
        &format!("{}\r\n", rule()),
        "\u{276f}\r\n",
        &format!("{}\r\n", rule()),
    ]
    .concat();

    assert_eq!(typed(&screen_of(&text)), None);
}

/// The same rule the cards are held to: a line that names a secret is not drawn
/// on a canvas somebody may well be sharing.
#[test]
fn a_command_naming_a_secret_is_not_drawn() {
    let screen = screen_of("a@box:~$ mysql -u root --password=hunter2");
    assert_eq!(typed(&screen), None);
}

/// What the whole of it is for: the turn is read while it is still drawn and
/// kept afterwards, so a session that has been working for an hour still says
/// what it was asked to do.
#[test]
fn a_turn_is_kept_after_it_has_scrolled_away() {
    let mut watcher = Watcher::new(10, 60);
    let asked = ["\u{1b}[2J\u{1b}[H", "\u{276f} rewrite the reader"].concat();
    watcher.keep(0, &asked);
    assert_eq!(watcher.typed(), Some("rewrite the reader"));

    // Ten screenfuls of an agent working, which is what takes the turn off the
    // top of the screen.
    let working = "\r\n\u{25cf} I will look at the folder.\r\n".repeat(20);
    watcher.keep(asked.len(), &working);
    // The same bytes on a screen that kept nothing: there is nothing left to
    // read, which is what makes the answer above a thing that was remembered.
    assert_eq!(typed(&screen_of(&[asked, working].concat())), None);
    assert_eq!(watcher.typed(), Some("rewrite the reader"));
}

/// A line an agent is in the middle of drawing, with the caret parked half way
/// along it: `$ ls` is a place to type with something after it by every test
/// there is, and it is not where anybody is typing — the composer under it is.
#[test]
fn a_line_an_agent_is_still_drawing_is_not_where_anybody_is_typing() {
    let text = [
        "\u{1b}[2J\u{1b}[H",
        "\u{25cf} Listing 1 directory\u{2026} (ctrl+o to expand)\r\n",
        "  \u{23bf}  $ ls -la\r\n",
        &format!("{}\r\n", rule()),
        "\u{276f}\r\n",
        &format!("{}\r\n", rule()),
        "  \u{23f8} manual mode on \u{b7} esc to interrupt\r\n",
        // Back up over its own transcript to write that line again, and stop
        // half way along it — which is where the caret is left standing.
        "\u{1b}[2;1H  \u{23bf}  $ ls",
    ]
    .concat();

    assert_eq!(typed(&screen_of(&text)), None);
}
