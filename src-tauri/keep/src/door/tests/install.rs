//! The lines the agents are set up with.

use super::super::*;

/// The registration reaches the agent as an address and not as a quoted one.
///
/// The line is handed to a shell to be run, and the two shells it is run
/// through do not read the same quotes: a POSIX shell takes the single ones off
/// and leaves the variable for the agent to expand, and `cmd` has none — it
/// would hand the agent the quotes as part of the address, which is a
/// registration that can only ever fail to connect.
#[test]
fn the_registration_is_quoted_the_way_the_shell_running_it_reads() {
    let posix = install::line(Agent::Claude, install::POSIX, DOOR);
    assert!(
        posix.ends_with(&format!("'${{{ADDRESS_VAR}}}'")),
        "a POSIX shell was handed {posix}"
    );

    let windows = install::line(Agent::Claude, install::CMD, DOOR);
    assert!(
        windows.ends_with(&format!("\"${{{ADDRESS_VAR}}}\"")),
        "cmd was handed {windows}"
    );
}

/// A press that has been made before is a press that still works.
///
/// The agent refuses to add a name it already has, so the name is taken away
/// first — held to the add by whichever punctuation the shell about to run the
/// line reads as "and then", which is not the same character in both.
#[test]
fn the_setup_can_be_pressed_a_second_time() {
    let posix = install::line(Agent::Claude, install::POSIX, DOOR);
    assert!(
        posix.starts_with("claude mcp remove --scope user totex ;"),
        "a POSIX shell was handed {posix}"
    );

    let windows = install::line(Agent::Claude, install::CMD, DOOR);
    assert!(
        windows.starts_with("claude mcp remove --scope user totex &"),
        "cmd was handed {windows}"
    );
}

/// The agent that cannot expand an address is given the one door, and the name
/// of the variable its session's token is waiting in.
///
/// Nothing in the line is left for a shell or an agent to work out: an address
/// written into that agent's settings is handed to a URL parser exactly as it
/// was typed, so a `$` anywhere in this one is a registration that could only
/// fail.
#[test]
fn the_agent_that_reads_no_address_is_registered_against_the_door() {
    let line = install::line(Agent::Codex, install::POSIX, DOOR);
    assert!(
        line.contains(&format!("--url http://{LOOPBACK}:{DOOR}{DOOR_PATH}")),
        "the door was not named: {line}"
    );
    assert!(
        line.contains(&format!("--bearer-token-env-var {TOKEN_VAR}")),
        "the session was not named: {line}"
    );
    assert!(!line.contains('$'), "something is left to expand: {line}");
}

/// Every agent the page offers has a line to offer with it.
#[test]
fn the_page_is_given_a_line_for_each_agent() {
    let setups = install::setups(DOOR);
    let named: Vec<Agent> = setups.iter().map(|setup| setup.agent).collect();
    assert_eq!(named, vec![Agent::Claude, Agent::Codex]);
    assert!(setups.iter().all(|setup| !setup.line.is_empty()));
}
