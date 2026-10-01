//! The command line `ssh` is handed, and the one a terminal runs at the far
//! end.

use super::super::{command, login_line, program, secrets};
use crate::remote::Reach;

/// What one `Command` would run, as the words it would run it with.
fn words(command: &std::process::Command) -> Vec<String> {
    std::iter::once(command.get_program())
        .chain(command.get_args())
        .map(|word| word.to_string_lossy().into_owned())
        .collect()
}

#[test]
fn every_word_is_quoted_for_the_far_shell_to_read_again() {
    let command = command("box", &["git", "-C", "/home/a/it's a repo", "status"]);
    let words = words(&command);
    assert_eq!(words[0], program());
    assert_eq!(
        &words[1..],
        [
            "-T",
            "-o",
            "BatchMode=yes",
            "-o",
            "ConnectTimeout=10",
            "-o",
            "StrictHostKeyChecking=accept-new",
            "box",
            "--",
            "'git' '-C' '/home/a/it'\\''s a repo' 'status'",
        ]
    );
}

/// The reach spells the same line, which is what the channel and the poll go
/// down.
#[test]
fn the_reach_hands_its_words_to_ssh() {
    let command = Reach::Ssh("user@box".to_string()).command(&["sh", "-c", "echo $HOME"]);
    let words = words(&command);
    assert_eq!(words[8], "user@box");
    assert_eq!(words[10], "'sh' '-c' 'echo $HOME'");
}

#[test]
fn the_program_is_whatever_the_environment_says() {
    // Read on every call rather than once: the tests point it at a fake, and
    // an empty setting is the same as none.
    let named = program();
    assert!(!named.is_empty());
    assert!(named == "ssh" || std::env::var("TOTEX_SSH").is_ok_and(|set| set == named));
}

#[test]
fn a_terminal_lands_in_the_folder_and_becomes_the_login_shell() {
    assert_eq!(
        login_line("/home/a/it's"),
        "cd '/home/a/it'\\''s' 2>/dev/null; exec \"$SHELL\" -l"
    );
}

/// A port in the host's spelling is handed over as `-p`, ahead of the
/// destination, which is the only place `ssh` reads one.
#[test]
fn a_port_in_the_host_goes_over_as_dash_p() {
    let words = words(&command("a@10.0.0.2:2222", &["true"]));
    let at = words.iter().position(|word| word == "-p").expect("a -p");
    assert_eq!(words[at + 1], "2222");
    assert_eq!(words[at + 2], "a@10.0.0.2");
    assert_eq!(words[at + 3], "--");
}

/// With nothing known for a machine `ssh` may not ask anything, and nothing
/// is put in its environment to answer with.
#[test]
fn with_no_password_known_nothing_may_ask() {
    let command = command("nothing-known-for-this-one", &["true"]);
    assert!(words(&command).contains(&"BatchMode=yes".to_string()));
    assert!(
        command
            .get_envs()
            .all(|(name, _)| name != "SSH_ASKPASS" && name != "TOTEX_ASKPASS_SECRET")
    );
}

/// With a password known, `ssh` may ask once, and only this program, which is
/// handed the password to answer with.
#[test]
fn with_a_password_known_this_program_is_the_one_asked() {
    let host = "someone@password-known-in-this-test";
    secrets::remember(host, "hunter2");
    let command = command(host, &["true"]);
    secrets::forget(host);

    let words = words(&command);
    assert!(words.contains(&"BatchMode=no".to_string()));
    assert!(words.contains(&"NumberOfPasswordPrompts=1".to_string()));
    assert!(!words.contains(&"BatchMode=yes".to_string()));

    let env = |wanted: &str| {
        command
            .get_envs()
            .find(|(name, _)| *name == wanted)
            .and_then(|(_, value)| value)
            .map(|value| value.to_string_lossy().into_owned())
    };
    let me = std::env::current_exe().expect("this test's own executable");
    assert_eq!(env("SSH_ASKPASS"), Some(me.to_string_lossy().into_owned()));
    assert_eq!(env("SSH_ASKPASS_REQUIRE").as_deref(), Some("force"));
    assert_eq!(env("TOTEX_ASKPASS").as_deref(), Some("1"));
    assert_eq!(env("TOTEX_ASKPASS_SECRET").as_deref(), Some("hunter2"));
}
