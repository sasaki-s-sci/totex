//! Switching the door off and on again, which no running agent may notice.

use serde_json::json;

use super::{addressed, keep, post, reported, session};

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
    let keep = keep();
    let id = "kept";
    let cwd = std::env::temp_dir().display().to_string();
    let before = session(&keep, id);

    keep.door.unserve();
    keep.door.serve().expect("the server stands again");

    let after = addressed(&keep.door, id, &cwd).expect("the session still has one");
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
        reported(&keep.door, id).map(|said| said.doing),
        Some("still here".to_string())
    );

    keep.sessions.close(id);
    keep.door.unserve();
}
