//! The command line `ssh` is handed, and the one a terminal runs at the far
//! end.

use super::super::{command, login_line, program};
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
    assert_eq!(words[6], "user@box");
    assert_eq!(words[8], "'sh' '-c' 'echo $HOME'");
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
