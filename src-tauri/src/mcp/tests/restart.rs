//! Switching the door off and on again, which no running agent may notice.

use serde_json::json;

use super::super::*;
use super::{addressed, mock_app, post, reported, session};
use crate::pty;

/// The switch is a switch, and not a way of cutting off every agent that is
/// already running.
///
/// A terminal is handed its address as it starts and never again, so an address
/// has to go on meaning the same thing for as long as the terminal does. Off
/// and on again is the whole of the test: the same door, in the same wall, with
/// the same name on it.
#[cfg(unix)]
#[test]
fn switching_the_server_off_and_on_leaves_the_addresses_where_they_were() {
    let app = mock_app();
    let handle = app.handle().clone();
    let id = "kept".to_string();
    let cwd = std::env::temp_dir().display().to_string();
    let before = session(&handle, &id);

    unserve(&handle);
    serve(&handle).expect("the server stands again");

    let after = addressed(&handle, &id, &cwd).expect("the session still has one");
    assert_eq!(
        before, after,
        "a terminal was left holding the wrong address"
    );

    let (status, called) = post(
        &before,
        &json!({"jsonrpc":"2.0","id":1,"method":"tools/call","params":{
            "name":"report","arguments":{"doing":"still here"},
        }}),
    );
    assert_eq!(status, "HTTP/1.1 200 OK");
    assert!(called["result"]["isError"].is_null());
    assert_eq!(
        reported(&handle, &id).map(|said| said.doing),
        Some("still here".to_string())
    );

    pty::control::pty_close(handle.clone(), id);
    unserve(&handle);
}
