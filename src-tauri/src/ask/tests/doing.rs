//! What a session is taken to be doing, drawn the way the shells and the agents
//! actually draw it.

use super::super::watch::Watcher;
use super::super::{Doing, doing};
use super::{full_screen_box, inline_agent, screen_of};

/// A shell standing at its prompt with nothing typed at it: the one state where
/// the window is waiting for the person rather than the other way round.
#[test]
fn a_prompt_is_a_session_waiting() {
    let screen = screen_of("a@box:~/repo$ ");
    assert_eq!(doing(&screen, None), Doing::Idle);
}

/// And a prompt with a command half typed into it is still a prompt: nothing is
/// running until it has been sent.
#[test]
fn a_command_not_yet_sent_is_still_waiting() {
    let screen = screen_of("a@box:~/repo$ cargo build --all");
    assert_eq!(doing(&screen, Some("cargo build --all")), Doing::Idle);
}

/// PowerShell ends its prompt the same way an agent opens its composer, which
/// is the whole reason this reading is about the caret rather than the glyph.
#[test]
fn a_windows_prompt_is_a_session_waiting() {
    let screen = screen_of("PS C:\\Users\\a\\repo> ");
    assert_eq!(doing(&screen, None), Doing::Idle);
}

/// A command that has been sent and is printing: the caret has left the prompt
/// and stands where the next line of output goes.
#[test]
fn a_command_printing_is_a_session_running() {
    let screen = screen_of("a@box:~/repo$ cargo build\r\n   Compiling totex v0.1.0\r\n");
    assert_eq!(doing(&screen, Some("cargo build")), Doing::Running);
}

/// A command that has said nothing at all yet is running too — the prompt it
/// was typed at scrolled up the moment the return was pressed.
#[test]
fn a_command_that_has_said_nothing_is_running() {
    let screen = screen_of("a@box:~/repo$ sleep 30\r\n");
    assert_eq!(doing(&screen, Some("sleep 30")), Doing::Running);
}

/// An agent is the session itself rather than a command being waited on, so it
/// says so for the whole of its run — asking, working, or sitting at an empty
/// composer, which is what this screen is.
#[test]
fn an_agent_on_its_own_screen_is_an_agent() {
    let screen = screen_of(&full_screen_box());
    assert_eq!(doing(&screen, Some("claude")), Doing::Agent);
}

/// And an agent that never asked for a screen of its own is one just the same.
///
/// Which is now every one of them: Claude Code 2.1 and Codex 0.153 both draw
/// down the ordinary screen so that what they said stays in the scrollback, and
/// a reading that wanted the alternate screen said `a shell at its prompt`
/// about both of them for the whole of a session. What they take instead is
/// being told when the window is looked at — see `Standing::taken`.
#[test]
fn an_agent_that_never_took_a_screen_is_an_agent() {
    let screen = screen_of(&inline_agent("⏸ manual mode on · ? for shortcuts"));
    assert_eq!(doing(&screen, Some("claude")), Doing::Agent);
}

/// The one thing that tells the two halves of a session apart: an agent at work
/// draws the way out of the work, and an agent waiting to be answered does not.
#[test]
fn an_agent_offering_a_way_out_is_working() {
    for hint in [
        // Claude Code, on its bottom line, where `? for shortcuts` otherwise is.
        "⏸ manual mode on · esc to interrupt",
        // Codex, on the line above its composer, which is not drawn at all the
        // rest of the time.
        "• Working (2s • esc to interrupt)",
    ] {
        let screen = screen_of(&inline_agent(hint));
        assert_eq!(doing(&screen, Some("codex")), Doing::Working, "{hint}");
    }
}

/// A question standing is the agent waiting for somebody, however loudly the
/// screen offers a key to get out of it. Which is why the reading is the words
/// an agent uses for stopping work and not the shape of a hint: this line is
/// the same shape and says the opposite thing.
#[test]
fn an_agent_that_has_stopped_to_ask_is_not_working() {
    let screen = screen_of(&inline_agent("Esc to cancel · Tab to amend"));
    assert_eq!(doing(&screen, Some("claude")), Doing::Agent);
}

/// And handing the terminal back ends it, the same way giving the alternate
/// screen back does: what says the agent has gone is the terminal saying so.
#[test]
fn an_agent_that_handed_the_terminal_back_has_stopped() {
    let screen = screen_of(
        &[
            &inline_agent("⏸ manual mode on · esc to interrupt"),
            "\u{1b}[?1004l\r\na@box:~/repo$ ",
        ]
        .concat(),
    );
    assert_eq!(doing(&screen, Some("claude")), Doing::Idle);
}

/// The same screen, run by something that is not an agent. A full-screen
/// program is a command like any other, and the two are told apart by the one
/// thing that says which program is up.
#[test]
fn another_full_screen_program_is_only_running() {
    let screen = screen_of(&full_screen_box());
    assert_ne!(doing(&screen, Some("vim src/main.rs")), Doing::Agent);
}

/// And the moment the agent hands that screen back, it has stopped being one —
/// which is what keeps the mark from standing on a shell somebody quit an agent
/// in an hour ago.
#[test]
fn an_agent_that_gave_its_screen_back_has_stopped() {
    let screen = screen_of(&[&full_screen_box(), "\u{1b}[?1049l", "a@box:~/repo$ "].concat());
    assert_eq!(doing(&screen, Some("claude")), Doing::Idle);
}

/// The name is the program's, not the path it was reached by nor the ending
/// Windows hangs on it.
#[test]
fn an_agent_is_known_by_its_name_wherever_it_was_run_from() {
    let screen = screen_of(&full_screen_box());
    for said in [
        "claude --resume",
        "/usr/local/bin/claude",
        "C:\\Users\\a\\bin\\claude.exe",
        "npx claude",
        "ANTHROPIC_BASE_URL=http://localhost:8080 claude",
    ] {
        assert_eq!(doing(&screen, Some(said)), Doing::Agent, "{said}");
    }
}

/// A command that redraws one line as it goes leaves the caret at the end of
/// that line, and what is written there is a measurement rather than a prompt:
/// `45%` is not a shell waiting to be typed at, and a reading that took it
/// would stop the mark on exactly the commands the mark is there for.
#[test]
fn a_command_saying_how_far_it_has_got_is_still_running() {
    for line in [
        "sending incremental file list ... 45% 1.2MB/s",
        "Installing packages 100% 0:00:12",
    ] {
        let screen = screen_of(&format!("a@box:~/repo$ rsync -P\r\n{line}"));
        assert_eq!(doing(&screen, Some("rsync -P")), Doing::Running, "{line}");
    }
}

/// A launcher with switches of its own still leaves the agent's name as the
/// first word that is a program.
#[test]
fn a_launcher_with_switches_still_names_the_agent() {
    let screen = screen_of(&full_screen_box());
    for said in [
        "npx --yes claude",
        "sudo -E claude",
        "env -i claude --resume",
    ] {
        assert_eq!(doing(&screen, Some(said)), Doing::Agent, "{said}");
    }
}

/// A session nobody has typed anything into cannot be running an agent, whatever
/// is on its screen.
#[test]
fn a_session_never_typed_at_is_not_an_agent() {
    let screen = screen_of(&full_screen_box());
    assert_ne!(doing(&screen, None), Doing::Agent);
}

/// Feeds a run of output to a watcher the way a session does, and says what the
/// window would have been told about it.
fn told(watcher: &mut Watcher, at: &mut usize, text: &str) -> Option<Doing> {
    watcher.keep(*at, text);
    *at += text.len();
    watcher.turned()
}

/// What crosses to the window is the moments a session turned, and not one run
/// of output more: a build printing a thousand lines is one telling.
#[test]
fn a_session_says_what_it_turned_to_and_says_it_once() {
    let mut watcher = Watcher::new(24, 60);
    let mut at = 0;

    // The prompt arrives, which is the shell saying it is ready to be typed at.
    assert_eq!(
        told(&mut watcher, &mut at, "a@box:~/repo$ "),
        Some(Doing::Idle)
    );
    // Typing at it changes nothing: nothing is running until it is sent.
    assert_eq!(told(&mut watcher, &mut at, "cargo build"), None);
    assert_eq!(
        told(&mut watcher, &mut at, "\r\n   Compiling totex\r\n"),
        Some(Doing::Running)
    );
    // And every line after it says the same thing, so none of them is said.
    assert_eq!(told(&mut watcher, &mut at, "   Compiling serde\r\n"), None);
    assert_eq!(
        told(&mut watcher, &mut at, "a@box:~/repo$ "),
        Some(Doing::Idle)
    );
}

/// The whole road for an agent, run at a shell the way somebody runs one.
///
/// What this is holding down is that the line which started the agent survives
/// the agent: the reading beside it takes the lowest line anybody could have
/// typed on, and an agent redraws a screenful of those. The two readings are
/// asserted side by side, because that difference is the whole reason there are
/// two of them.
#[test]
fn an_agent_started_at_a_shell_says_so_for_as_long_as_it_is_up() {
    let mut watcher = Watcher::new(24, 60);
    let mut at = 0;

    assert_eq!(
        told(&mut watcher, &mut at, "a@box:~/repo$ "),
        Some(Doing::Idle)
    );
    assert_eq!(told(&mut watcher, &mut at, "claude"), None);
    // The return: the shell has it, and nothing is drawn yet.
    assert_eq!(told(&mut watcher, &mut at, "\r\n"), Some(Doing::Running));
    // And the agent's first frame, on a screen of its own.
    assert_eq!(
        told(&mut watcher, &mut at, &full_screen_box()),
        Some(Doing::Agent)
    );
    // Permission choices must not replace the last user command.
    assert_eq!(watcher.typed(), Some("claude"));

    // Quitting hands the screen back, and the session is a shell again.
    assert_eq!(
        told(&mut watcher, &mut at, "\u{1b}[?1049l\r\na@box:~/repo$ "),
        Some(Doing::Idle)
    );
}

/// And the same road for an agent that draws down the ordinary screen, which is
/// the one the two agents measured actually take.
///
/// What is being held down here is that `started` survives an agent that never
/// asks for a screen of its own. That reading is kept off the ordinary screen —
/// it is the line somebody typed at a shell — and an agent drawing a composer
/// on that screen writes over it every frame, so what keeps `codex` standing is
/// the terminal having been taken rather than which screen is in use.
#[test]
fn an_agent_drawing_down_the_ordinary_screen_says_so_too() {
    let mut watcher = Watcher::new(24, 60);
    let mut at = 0;

    assert_eq!(
        told(&mut watcher, &mut at, "a@box:~/repo$ "),
        Some(Doing::Idle)
    );
    assert_eq!(told(&mut watcher, &mut at, "codex"), None);
    assert_eq!(told(&mut watcher, &mut at, "\r\n"), Some(Doing::Running));

    // The agent comes up and stands at its composer, which is a session waiting
    // to be answered rather than one being waited on.
    assert_eq!(
        told(&mut watcher, &mut at, &inline_agent("? for shortcuts")),
        Some(Doing::Agent)
    );
    // A turn is handed over, and the agent says how to take it back.
    assert_eq!(
        told(
            &mut watcher,
            &mut at,
            &inline_agent("• Working (2s • esc to interrupt)")
        ),
        Some(Doing::Working)
    );
    // The answer lands and the offer goes with it.
    assert_eq!(
        told(&mut watcher, &mut at, &inline_agent("? for shortcuts")),
        Some(Doing::Agent)
    );
    // And quitting hands the terminal back, which is a shell again.
    assert_eq!(
        told(&mut watcher, &mut at, "\u{1b}[?1004l\r\na@box:~/repo$ "),
        Some(Doing::Idle)
    );
}

#[test]
fn coalesced_agent_start_keeps_identity_and_working_state() {
    for agent in ["codex", "claude", "opencode"] {
        let mut watcher = Watcher::new(24, 60);
        let text = format!("a@box:~$ {agent}\r\n{}", inline_agent("esc to interrupt"));
        watcher.keep(0, &text);
        assert_eq!(watcher.doing(), Doing::Working, "{agent}");
        assert_eq!(watcher.typed(), Some("explain this repository"));
    }
}

#[test]
fn combined_private_modes_enable_agent_detection() {
    let screen = screen_of("\x1b[?25;1004h\r\nesc interrupt");
    assert_eq!(doing(&screen, Some("opencode")), Doing::Working);
}

#[test]
fn agents_launched_from_a_wrapped_shell_prompt_keep_their_identity() {
    for agent in ["claude", "codex", "opencode"] {
        for width in [38, 39, 40, 45] {
            for chunked in [false, true] {
                let mut watcher = Watcher::new(24, width);
                let prompt = format!("user@host:/{}$ ", "d".repeat(26));
                let text = format!("{prompt}{agent}\r\n{}", inline_agent("? for shortcuts"));
                if chunked {
                    for (at, letter) in text.char_indices() {
                        watcher.keep(at, &letter.to_string());
                    }
                } else {
                    watcher.keep(0, &text);
                }
                assert_eq!(watcher.doing(), Doing::Agent, "{agent}, {width}, {chunked}");
                let busy = inline_agent("esc to interrupt");
                watcher.keep(text.len(), &busy);
                assert_eq!(watcher.doing(), Doing::Working);
                watcher.keep(text.len() + busy.len(), "\x1b[?1004l\r\nuser@host:~$ ");
                assert_eq!(watcher.doing(), Doing::Idle);
            }
        }
    }
}
