//! The poll that stands in for the change notifications Windows never gets, and
//! the list of distributions it runs in.

use super::super::shell::parse_list;
use super::super::{exec, watch};
use super::reachable;

/// Writing a file has to come back as that file.
#[test]
fn says_what_was_written_since_the_last_look() {
    let Some(distro) = reachable() else {
        return;
    };
    let dir = "/tmp/totex-watch-test";
    exec(&distro, None, &[], &["rm", "-rf", dir]).expect("a shell");
    exec(&distro, None, &[], &["mkdir", "-p", dir]).expect("a shell");

    let (tx, rx) = std::sync::mpsc::channel();
    let poll = watch(&distro, false, &[dir.to_string()], move |moved| {
        let _ = tx.send(moved);
    })
    .expect("a poll");

    // After the first look, so the write is something that happened since.
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(15);
    let mut seen: Vec<String> = Vec::new();
    while std::time::Instant::now() < deadline {
        exec(&distro, None, &[], &["touch", &format!("{dir}/written")]).expect("a shell");
        if let Ok(moved) = rx.recv_timeout(std::time::Duration::from_millis(1_500)) {
            seen = moved;
            if seen.iter().any(|path| path.ends_with("/written")) {
                break;
            }
        }
    }
    drop(poll);

    assert!(
        seen.iter().any(|path| path.ends_with("/written")),
        "the write never came back: {seen:?}"
    );
}

#[test]
fn names_every_distribution_the_list_holds() {
    let utf16: Vec<u8> = "Ubuntu\r\nDebian\r\n"
        .encode_utf16()
        .flat_map(u16::to_le_bytes)
        .collect();
    assert_eq!(parse_list(&utf16), vec!["Ubuntu", "Debian"]);
    assert_eq!(parse_list(b"Ubuntu\nDebian\n"), vec!["Ubuntu", "Debian"]);
}
