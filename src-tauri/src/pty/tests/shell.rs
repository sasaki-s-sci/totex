//! A live shell: where it runs, what it keeps, and what it refuses.

use std::time::{Duration, Instant};

use super::super::control::{pty_attach, pty_close, pty_resize, pty_write};
use super::super::spawn::pty_open;
use super::{listening, mock_app, wait_answering};
use crate::wsl;

/// POSIX shell syntax, so it runs where that is what a shell speaks.
#[cfg(unix)]
#[test]
fn a_shell_runs_in_the_directory_it_was_opened_in() {
    let app = mock_app();
    let handle = app.handle().clone();
    let id = "session".to_string();
    let rx = listening(&handle);

    let dir = std::env::temp_dir();
    let canonical = dir.canonicalize().unwrap_or(dir.clone());
    // A terminal echoes what is typed, so the marker has to be something only
    // the *answer* can contain — the expanded path, not the command.
    let expected = format!("totex-probe-{}", canonical.display());

    pty_open(
        handle.clone(),
        id.clone(),
        dir.display().to_string(),
        24,
        80,
        None,
    )
    .expect("the shell starts");

    // Printing the working directory proves it reached the shell, and the reply
    // coming back at all proves the output is streaming.
    pty_write(
        handle.clone(),
        id.clone(),
        "echo totex-probe-$(pwd)\n".to_string(),
    )
    .expect("the shell takes input");

    let seen = super::wait_for(&rx, &expected);
    pty_close(handle.clone(), id.clone());

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
    let app = mock_app();
    let handle = app.handle().clone();
    let id = "inside".to_string();
    let rx = listening(&handle);

    pty_open(
        handle.clone(),
        id.clone(),
        wsl::unc(&distro, "/etc"),
        24,
        200,
        None,
    )
    .expect("the shell starts");

    pty_write(
        handle.clone(),
        id.clone(),
        "echo totex-at-$(pwd)\n".to_string(),
    )
    .expect("the shell takes input");
    let seen = wait_answering(&handle, &id, &rx, "totex-at-/etc");
    pty_close(handle.clone(), id.clone());

    assert!(
        seen.contains("totex-at-/etc"),
        "the shell did not answer from inside the distribution: {seen:?}"
    );
}

/// The whole point of the backlog: nothing is listening for the event, and what
/// the shell said is still there when a terminal finally asks.
#[cfg(unix)]
#[test]
fn a_shell_nobody_is_listening_to_keeps_what_it_said() {
    let app = mock_app();
    let handle = app.handle().clone();
    let id = "unattended".to_string();

    pty_open(
        handle.clone(),
        id.clone(),
        std::env::temp_dir().display().to_string(),
        24,
        80,
        None,
    )
    .expect("the shell starts");
    pty_write(handle.clone(), id.clone(), "echo totex-kept\n".to_string())
        .expect("the shell takes input");

    // Asked for the way a terminal built after the fact asks for it, rather than
    // listened for: no handler was ever registered above.
    let deadline = Instant::now() + Duration::from_secs(10);
    let mut held = String::new();
    while Instant::now() < deadline {
        held = pty_attach(handle.clone(), id.clone())
            .expect("a running session has a backlog")
            .text;
        if held.contains("totex-kept") {
            break;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    pty_close(handle.clone(), id.clone());

    assert!(
        held.contains("totex-kept"),
        "nothing was kept for a terminal that was not there: {held:?}"
    );
}

#[test]
fn attaching_to_a_session_that_is_not_running_says_so() {
    let app = mock_app();
    assert!(pty_attach(app.handle().clone(), "nobody".into()).is_none());
}

#[test]
fn writing_to_a_session_that_is_not_running_is_an_error() {
    let app = mock_app();
    let handle = app.handle().clone();
    assert!(pty_write(handle.clone(), "nobody".into(), "hi".into()).is_err());
    // Resizing one is not: it races a shell that just exited.
    assert!(pty_resize(handle, "nobody".into(), 10, 10).is_ok());
}
