//! A live shell: where it runs, what it keeps, and what it refuses.

use std::time::{Duration, Instant};

use super::{listening, sessions, wait_answering};
use totex_host::wsl;

/// POSIX shell syntax, so it runs where that is what a shell speaks.
#[cfg(unix)]
#[test]
fn a_shell_runs_in_the_directory_it_was_opened_in() {
    let sessions = sessions();
    let id = "session";
    let rx = listening(&sessions);

    let dir = std::env::temp_dir();
    let canonical = dir.canonicalize().unwrap_or(dir.clone());
    // A terminal echoes what is typed, so the marker has to be something only
    // the *answer* can contain — the expanded path, not the command.
    let expected = format!("totex-probe-{}", canonical.display());

    sessions
        .open(id, &dir.display().to_string(), 24, 80, None)
        .expect("the shell starts");

    // Printing the working directory proves it reached the shell, and the reply
    // coming back at all proves the output is streaming.
    sessions
        .write(id, "echo totex-probe-$(pwd)\n")
        .expect("the shell takes input");

    let seen = super::wait_for(&rx, &expected);
    sessions.close(id);

    assert!(
        seen.contains(&expected),
        "the shell did not answer from {}: {seen:?}",
        canonical.display()
    );
}

/// The same thing for a folder that is not on this machine: a shell inside the
/// distribution, standing in the Linux directory the share names — not a Windows
/// shell looking at it over the wire. Skipped where there is no WSL to reach.
#[test]
fn a_session_in_a_distribution_is_that_distribution_s_shell() {
    let Some(distro) = wsl::distros().into_iter().next() else {
        return;
    };
    let sessions = sessions();
    let id = "inside";
    let rx = listening(&sessions);

    sessions
        .open(id, &wsl::unc(&distro, "/etc"), 24, 200, None)
        .expect("the shell starts");

    sessions
        .write(id, "echo totex-at-$(pwd)\n")
        .expect("the shell takes input");
    let seen = wait_answering(&sessions, id, &rx, "totex-at-/etc");
    sessions.close(id);

    assert!(
        seen.contains("totex-at-/etc"),
        "the shell did not answer from inside the distribution: {seen:?}"
    );
}

/// The whole point of the backlog: nothing is listening, and what the shell
/// said is still there when a terminal finally asks.
#[cfg(unix)]
#[test]
fn a_shell_nobody_is_listening_to_keeps_what_it_said() {
    let sessions = sessions();
    let id = "unattended";

    sessions
        .open(
            id,
            &std::env::temp_dir().display().to_string(),
            24,
            80,
            None,
        )
        .expect("the shell starts");
    sessions
        .write(id, "echo totex-kept\n")
        .expect("the shell takes input");

    // Asked for the way a terminal built after the fact asks for it, rather than
    // listened for: no follower was ever registered above.
    let deadline = Instant::now() + Duration::from_secs(10);
    let mut held = String::new();
    while Instant::now() < deadline {
        held = sessions
            .attach(id)
            .expect("a running session has a backlog")
            .text;
        if held.contains("totex-kept") {
            break;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    sessions.close(id);

    assert!(
        held.contains("totex-kept"),
        "nothing was kept for a terminal that was not there: {held:?}"
    );
}

#[test]
fn attaching_to_a_session_that_is_not_running_says_so() {
    let sessions = sessions();
    assert!(sessions.attach("nobody").is_none());
}

#[test]
fn writing_to_a_session_that_is_not_running_is_an_error() {
    let sessions = sessions();
    assert!(sessions.write("nobody", "hi").is_err());
    // Resizing one is not: it races a shell that just exited.
    assert!(sessions.resize("nobody", 10, 10).is_ok());
}

/// A session that ends on its own is one the followers are told has ended,
/// after it is gone — so a follower that asks what is running finds what is
/// actually left.
#[cfg(unix)]
#[test]
fn a_shell_that_exits_is_told_of_after_it_is_gone() {
    use std::sync::mpsc;

    let sessions = sessions();
    let id = "leaving";
    let (tx, rx) = mpsc::channel();
    let looking = std::sync::Arc::clone(&sessions);
    sessions.follow(std::sync::Arc::new(move |who, event| {
        if let super::Event::Ended = event {
            let _ = tx.send((who.to_string(), looking.count()));
        }
    }));

    sessions
        .open(
            id,
            &std::env::temp_dir().display().to_string(),
            24,
            80,
            None,
        )
        .expect("the shell starts");
    sessions.write(id, "exit\n").expect("the shell takes input");

    let (who, left) = rx
        .recv_timeout(Duration::from_secs(10))
        .expect("the ending was told");
    assert_eq!(who, id);
    assert_eq!(
        left, 0,
        "the session was still there when its ending was told"
    );
}
