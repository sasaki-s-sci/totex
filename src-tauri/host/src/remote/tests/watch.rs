//! The poll that stands in for the change notifications a far machine never
//! sends.

use super::super::{exec, watch};
use super::reachable;

/// Writing a file has to come back as that file.
#[test]
fn says_what_was_written_since_the_last_look() {
    for reach in reachable() {
        let dir = match &reach {
            // The fake ssh host is this machine, whose writable temp dir is
            // wherever a sandboxed run says it is; a distribution has `/tmp`.
            super::super::Reach::Ssh(_) => {
                format!(
                    "{}/totex-watch-test",
                    std::env::temp_dir().to_string_lossy()
                )
            }
            super::super::Reach::Wsl(_) => "/tmp/totex-watch-test".to_string(),
        };
        exec(&reach, None, &[], &["rm", "-rf", &dir]).expect("a shell");
        exec(&reach, None, &[], &["mkdir", "-p", &dir]).expect("a shell");

        let (tx, rx) = std::sync::mpsc::channel();
        let poll = watch(&reach, false, std::slice::from_ref(&dir), move |moved| {
            let _ = tx.send(moved);
        })
        .expect("a poll");

        // After the first look, so the write is something that happened since.
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(15);
        let mut seen: Vec<String> = Vec::new();
        while std::time::Instant::now() < deadline {
            exec(&reach, None, &[], &["touch", &format!("{dir}/written")]).expect("a shell");
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
            "{reach:?}: the write never came back: {seen:?}"
        );
    }
}
