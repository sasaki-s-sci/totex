//! The protocol a held-open shell speaks, and the commands that go down it.

use super::super::channel::parse_header;
use super::super::{Reach, exec, line, quote, script};
use super::reachable;

#[test]
fn an_argument_survives_the_shell_unchanged() {
    assert_eq!(quote("it's"), "'it'\\''s'");
    assert_eq!(quote("$HOME `x` \\"), "'$HOME `x` \\'");
    let rendered = line(Some("/tmp"), &[("LC_ALL", "C")], &["git", "log", "it's"]);
    assert_eq!(rendered, "cd '/tmp' && LC_ALL='C' 'git' 'log' 'it'\\''s'");
}

#[test]
fn reads_the_frame_the_runner_writes() {
    assert_eq!(parse_header("R 0 12 0\n").expect("a header"), (0, 12, 0));
    assert_eq!(
        parse_header("R 128 0 40\n").expect("a header"),
        (128, 0, 40)
    );
    assert!(parse_header("hello\n").is_err());
}

/// The pool is keyed by the way there as well as the name: a distribution and
/// an ssh alias called the same are two machines.
#[test]
fn a_reach_is_keyed_by_its_kind() {
    assert_eq!(Reach::Wsl("box".to_string()).key(), "wsl:box");
    assert_eq!(Reach::Ssh("box".to_string()).key(), "ssh:box");
    assert_ne!(
        Reach::Wsl("box".to_string()).key(),
        Reach::Ssh("box".to_string()).key()
    );
}

#[test]
fn runs_a_command_on_the_far_machine() {
    for reach in reachable() {
        let output = exec(&reach, Some("/etc"), &[], &["pwd"]).expect("a shell");
        assert!(output.ok(), "{reach:?}: {:?}", output.stderr);
        assert_eq!(output.text().trim(), "/etc");
        let output = exec(
            &reach,
            None,
            &[("TOTEX_SAID", "it's")],
            &["sh", "-c", "printf %s \"$TOTEX_SAID\""],
        )
        .expect("a shell");
        assert_eq!(output.text(), "it's", "the environment arrives as given");
    }
}

#[test]
fn hands_back_what_a_command_failed_with() {
    for reach in reachable() {
        let output =
            exec(&reach, None, &[], &["sh", "-c", "echo no >&2; exit 3"]).expect("a shell");
        assert_eq!(output.code, 3, "{reach:?}");
        assert_eq!(String::from_utf8_lossy(&output.stderr).trim(), "no");
    }
}

/// The reason the answers are framed by length: a file is bytes, and every byte
/// a delimiter could be is one a file is allowed to hold.
#[test]
fn carries_bytes_a_line_could_not() {
    for reach in reachable() {
        let output = exec(
            &reach,
            None,
            &[],
            &["sh", "-c", "printf 'a\\nb'; printf '\\000'; printf 'c'"],
        )
        .expect("a shell");
        assert_eq!(output.stdout, b"a\nb\0c", "{reach:?}");
    }
}

/// The whole point of holding the shell open: the second command must not pay
/// for the bridge again.
#[test]
fn the_shell_is_still_there_for_the_next_command() {
    for reach in reachable() {
        for _ in 0..3 {
            let output = exec(&reach, None, &[], &["true"]).expect("a shell");
            assert!(output.ok());
        }
        let started = std::time::Instant::now();
        exec(&reach, None, &[], &["true"]).expect("a shell");
        assert!(
            started.elapsed() < std::time::Duration::from_millis(250),
            "{reach:?}: a held-open shell took {:?}",
            started.elapsed()
        );
    }
}

#[test]
fn a_script_reads_its_arguments_as_arguments() {
    for reach in reachable() {
        let output =
            script(&reach, None, "printf '%s|' \"$@\"", &["it's", "a b"]).expect("a shell");
        assert_eq!(output.text(), "it's|a b|", "{reach:?}");
    }
}

/// A machine that cannot be reached is said to be that, by kind, rather than
/// left as a shell that answered nothing. Only the ssh side can be tried on
/// CI: a host `ssh` has never heard of is refused without a network.
#[test]
#[cfg(unix)]
fn an_unreachable_host_is_named_as_one() {
    crate::host::tests::fake_ssh();
    // The fake answers this one host the way `ssh` answers a machine it cannot
    // connect to: it exits before the runner has said anything.
    let reach = Reach::Ssh("unreachable".to_string());
    assert_eq!(
        exec(&reach, None, &[], &["true"]).err(),
        Some("ssh-unreachable".to_string())
    );
}
