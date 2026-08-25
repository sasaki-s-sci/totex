//! What a swap costs the terminals, which is the whole reason for the layer.
//!
//! The claim the three layers are arranged around is that two of them can be
//! replaced without ending what is running in the window. For the pages that is
//! plain enough — the program is not touched at all. For the application layer
//! it is a claim about where things are kept: the shells belong to the program
//! and not to the layer, so a layer being replaced is a shell that never finds
//! out. This is that claim, run against a live shell.

use std::sync::Arc;

use tauri::test::{mock_builder, mock_context, noop_assets};

use crate::app_layer::Layers;
use crate::pty::PtyState;
use crate::pty::control::{pty_close, pty_write};
use crate::pty::spawn::pty_open;
use crate::pty::tests::{listening, wait_for};
use crate::update::Took;

use super::TempDir;
use super::layer::{built_layer, packed};

/// POSIX shell syntax, so it runs where that is what a shell speaks.
#[cfg(unix)]
#[test]
fn a_layer_replaced_under_a_running_shell_is_a_shell_that_never_finds_out() {
    let temp = TempDir::new("sessions");
    let layers = Arc::new(Layers::at(Some(temp.path().join("layer"))));
    let app = mock_builder()
        .manage(PtyState::default())
        .manage(Arc::clone(&layers))
        .build(mock_context(noop_assets()))
        .expect("an app with somewhere to run a shell");
    let handle = app.handle().clone();
    let heard = listening(&handle);
    let id = "kept-open".to_string();

    pty_open(
        handle.clone(),
        id.clone(),
        std::env::temp_dir().display().to_string(),
        24,
        80,
        None,
    )
    .expect("the shell starts");
    pty_write(
        handle.clone(),
        id.clone(),
        "echo before-the-swap\n".to_string(),
    )
    .expect("the shell takes input");
    assert!(
        wait_for(&heard, "before-the-swap").contains("before-the-swap"),
        "the shell was not answering to begin with"
    );

    // The swap. A whole layer downloaded, started, and put in front of the copy
    // the program carries -- see `Layers::put`, which is what a press ends in.
    assert_eq!(
        layers
            .put(totex_layer::VERSION, &packed(&built_layer()))
            .expect("a layer that is a layer"),
        Took::Taken
    );
    assert!(layers.beside());

    // And the same shell, still the same shell: still running, still holding
    // what it was in the middle of, still answering what is typed at it.
    pty_write(
        handle.clone(),
        id.clone(),
        "echo after-the-swap\n".to_string(),
    )
    .expect("the shell still takes input");
    assert!(
        wait_for(&heard, "after-the-swap").contains("after-the-swap"),
        "the shell stopped answering when the layer was replaced"
    );
    assert!(
        crate::pty::running(&handle)
            .iter()
            .any(|open| open.id == id),
        "the session is gone"
    );

    pty_close(handle, id);
}
