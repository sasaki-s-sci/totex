//! What a card is allowed to be, whatever an agent sent.

use serde_json::json;

use super::super::*;
use super::{mock_app, reported};

/// What is kept is what a card can draw: one line, and a list that is a list.
#[test]
fn what_arrives_is_cut_to_what_is_shown() {
    let app = mock_app();
    let handle = app.handle().clone();

    let answer = rpc::answer(
        &handle,
        "nobody",
        json!({"jsonrpc":"2.0","id":1,"method":"tools/call","params":{
            "name":"report",
            "arguments":{
                "doing":"  reading   the layout\n  and moving it  ",
                "steps":[{"title":"one","done":true},{"title":"   ","done":false}],
            },
        }})
        .to_string()
        .as_bytes(),
    )
    .expect("a call is answered");
    assert!(answer["result"]["isError"].is_null());

    let said = reported(&handle, "nobody").expect("it was kept");
    assert_eq!(said.doing, "reading the layout and moving it");
    assert_eq!(said.steps.len(), 1, "a step with no title is not a step");

    // A message with no id is a client telling rather than asking, and there is
    // nothing to send back.
    assert!(
        rpc::answer(
            &handle,
            "nobody",
            br#"{"jsonrpc":"2.0","method":"notifications/initialized"}"#,
        )
        .is_none()
    );

    // The door is shut, and nothing is left standing that cannot be corrected.
    unserve(&handle);
    assert!(reported(&handle, "nobody").is_none());
}
