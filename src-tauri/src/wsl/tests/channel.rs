//! The protocol a held-open shell speaks, and the commands that go down it.

use super::super::channel::parse_header;
use super::super::shell::line;
use super::super::{encode, exec, script};
use super::reachable;

#[test]
fn an_argument_survives_the_shell_unchanged() {
    let rendered = line(Some("/tmp"), &[("LC_ALL", "C")], &["git", "log", "it's"]);
    assert_eq!(rendered, "cd '/tmp' && LC_ALL='C' 'git' 'log' 'it'\\''s'");
}

#[test]
fn encodes_the_way_base64_reads_it_back() {
    assert_eq!(encode(b""), "");
    assert_eq!(encode(b"f"), "Zg==");
    assert_eq!(encode(b"fo"), "Zm8=");
    assert_eq!(encode(b"foo"), "Zm9v");
    assert_eq!(encode(b"foob"), "Zm9vYg==");
    assert!(!encode("echo 'it\\'s'".as_bytes()).contains('\n'));
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

#[test]
fn runs_a_command_inside_the_distribution() {
    let Some(distro) = reachable() else {
        return;
    };
    let output = exec(&distro, Some("/etc"), &[], &["pwd"]).expect("a shell");
    assert!(output.ok(), "{:?}", output.stderr);
    assert_eq!(output.text().trim(), "/etc");
}

#[test]
fn hands_back_what_a_command_failed_with() {
    let Some(distro) = reachable() else {
        return;
    };
    let output = exec(&distro, None, &[], &["sh", "-c", "echo no >&2; exit 3"]).expect("a shell");
    assert_eq!(output.code, 3);
    assert_eq!(String::from_utf8_lossy(&output.stderr).trim(), "no");
}

/// The reason the answers are framed by length: a file is bytes, and every byte
/// a delimiter could be is one a file is allowed to hold.
#[test]
fn carries_bytes_a_line_could_not() {
    let Some(distro) = reachable() else {
        return;
    };
    let output = exec(
        &distro,
        None,
        &[],
        &["sh", "-c", "printf 'a\\nb'; printf '\\000'; printf 'c'"],
    )
    .expect("a shell");
    assert_eq!(output.stdout, b"a\nb\0c");
}

/// The whole point of holding the shell open: the second command must not pay
/// for `wsl.exe` again.
#[test]
fn the_shell_is_still_there_for_the_next_command() {
    let Some(distro) = reachable() else {
        return;
    };
    for _ in 0..3 {
        let output = exec(&distro, None, &[], &["true"]).expect("a shell");
        assert!(output.ok());
    }
    let started = std::time::Instant::now();
    exec(&distro, None, &[], &["true"]).expect("a shell");
    assert!(
        started.elapsed() < std::time::Duration::from_millis(250),
        "a held-open shell took {:?}",
        started.elapsed()
    );
}

#[test]
fn a_script_reads_its_arguments_as_arguments() {
    let Some(distro) = reachable() else {
        return;
    };
    let output = script(&distro, None, "printf '%s|' \"$@\"", &["it's", "a b"]).expect("a shell");
    assert_eq!(output.text(), "it's|a b|");
}
