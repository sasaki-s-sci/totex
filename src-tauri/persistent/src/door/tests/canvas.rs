use super::{held, post, session};
use serde_json::json;

#[test]
fn file_paths_follow_the_terminal_host() {
    use crate::door::canvas::file_path;
    let cwd = r"\\wsl.localhost\Ubuntu\home\a\repo";
    assert_eq!(
        file_path(cwd, "/tmp/shot.png"),
        r"\\wsl.localhost\Ubuntu\tmp\shot.png"
    );
    assert_eq!(
        file_path(cwd, "shot.png"),
        r"\\wsl.localhost\Ubuntu\home\a\repo\shot.png"
    );
    assert_eq!(file_path(cwd, r"C:\shots\shot.png"), r"C:\shots\shot.png");
    assert_eq!(
        file_path("ssh://build/home/a", "/tmp/shot.png"),
        "ssh://build/tmp/shot.png"
    );
    assert_eq!(
        file_path("/home/a", "ssh://build/tmp/shot.png"),
        "ssh://build/tmp/shot.png"
    );
    assert_eq!(
        file_path(cwd, "clips/demo.mp4"),
        r"\\wsl.localhost\Ubuntu\home\a\repo\clips\demo.mp4"
    );
    assert_eq!(
        file_path("ssh://build/home/a", "clips/demo.ogg"),
        "ssh://build/home/a/clips/demo.ogg"
    );
}

#[test]
fn media_options_are_optional_and_strict() {
    use crate::door::canvas::Pane;
    for input in [
        json!({"id":"file","kind":"file","path":"notes.md"}),
        json!({"id":"video","kind":"video","src":"demo.mp4"}),
        json!({"id":"audio","kind":"audio","src":"demo.ogg"}),
    ] {
        let pane: Pane = serde_json::from_value(input).unwrap();
        let shown = serde_json::to_value(pane).unwrap();
        assert!(shown.get("view").is_none());
        assert!(shown.get("playback").is_none());
    }
    let pane: Pane = serde_json::from_value(json!({
        "id":"video", "kind":"video", "src":"demo.mp4", "playback":{"playing":false}
    }))
    .unwrap();
    assert_eq!(
        serde_json::to_value(pane).unwrap()["playback"],
        json!({"playing":false})
    );
    for input in [
        json!({"id":"file","kind":"file","path":"notes.md","view":"html"}),
        json!({"id":"video","kind":"video","src":"demo.mp4","view":"text"}),
        json!({"id":"video","kind":"video","src":"demo.mp4","playback":{"loop":true}}),
        json!({"id":"audio","kind":"audio","src":"demo.ogg","playback":{"playing":"yes"}}),
        json!({"id":"file","kind":"file","path":"notes.md","playback":{"position":"10"}}),
    ] {
        assert!(
            serde_json::from_value::<Pane>(input.clone()).is_err(),
            "{input}"
        );
    }
}

#[cfg(unix)]
#[test]
fn media_and_file_views_round_trip_through_http_mcp() {
    let held = held();
    let (folder, address) = session(&held, "canvas-media");
    let request = |arguments| {
        json!({
            "jsonrpc":"2.0", "id":1, "method":"tools/call", "params":{
                "name":"canvas", "arguments":arguments
            }
        })
    };
    let (_, listed) = post(
        &address,
        &json!({"jsonrpc":"2.0","id":2,"method":"tools/list"}),
    );
    let properties =
        &listed["result"]["tools"][0]["inputSchema"]["properties"]["panes"]["items"]["properties"];
    assert!(
        properties["kind"]["enum"]
            .as_array()
            .unwrap()
            .contains(&json!("video"))
    );
    assert!(
        properties["kind"]["enum"]
            .as_array()
            .unwrap()
            .contains(&json!("audio"))
    );
    assert_eq!(properties["view"]["enum"], json!(["text", "preview"]));
    assert_eq!(properties["playback"]["additionalProperties"], false);
    let (_, answer) = post(
        &address,
        &request(json!({"revision":0,"panes":[
            {"id":"video","kind":"video","src":"clips/demo.mp4","playback":{"start":1.5,"end":4.0,"position":4.0,"playing":true}},
            {"id":"audio","kind":"audio","src":"https://example.org/voice.ogg","playback":{"position":8.25,"playing":false}},
            {"id":"document","kind":"file","path":"notes.md","view":"preview"},
            {"id":"source","kind":"file","path":"index.html","view":"text"},
            {"id":"recording","kind":"file","path":"clip.wav","playback":{"end":2.0}}
        ]})),
    );
    assert!(answer["result"]["isError"].is_null(), "{answer}");
    let shown = answer["result"]["structuredContent"].clone();
    assert_eq!(shown["revision"], 1);
    assert_eq!(
        shown["panes"][0]["src"],
        format!("{}/clips/demo.mp4", folder.path().display())
    );
    assert_eq!(
        shown["panes"][0]["playback"],
        json!({"start":1.5,"end":4.0,"position":4.0,"playing":true})
    );
    assert_eq!(shown["panes"][1]["src"], "https://example.org/voice.ogg");
    assert_eq!(shown["panes"][2]["view"], "preview");
    assert!(shown["panes"][2].get("playback").is_none());
    assert_eq!(shown["panes"][3]["view"], "text");
    assert_eq!(shown["panes"][4]["playback"], json!({"end":2.0}));
    let (_, read) = post(&address, &request(json!({})));
    assert_eq!(read["result"]["structuredContent"], shown);

    for playback in [
        json!({"start":-1}),
        json!({"end":0}),
        json!({"start":2,"end":2}),
        json!({"start":3,"end":2}),
        json!({"position":-1}),
        json!({"start":2,"position":1}),
        json!({"end":2,"position":3}),
        json!({"speed":2}),
    ] {
        let (_, denied) = post(
            &address,
            &request(json!({"revision":1,"panes":[{
                "id":"video","kind":"video","src":"demo.mp4","playback":playback
            }]})),
        );
        assert_eq!(denied["result"]["isError"], true, "{denied}");
        assert_eq!(
            serde_json::to_value(held.door.canvas("canvas-media")).unwrap(),
            shown
        );
    }
    for pane in [
        json!({"id":"video","kind":"video","src":"http://ipc.localhost/movie.mp4"}),
        json!({"id":"audio","kind":"audio","src":"https://user:password@example.org/audio.ogg"}),
        json!({"id":"audio","kind":"audio","src":"file:///tmp/audio.ogg"}),
        json!({"id":"source","kind":"file","path":"index.html","view":"raw"}),
    ] {
        let (_, denied) = post(&address, &request(json!({"revision":1,"panes":[pane]})));
        assert_eq!(denied["result"]["isError"], true, "{denied}");
        assert_eq!(
            serde_json::to_value(held.door.canvas("canvas-media")).unwrap(),
            shown
        );
    }
    held.sessions.close("canvas-media");
    held.door.unserve();
}

#[cfg(unix)]
#[test]
fn native_media_writes_validate_nonfinite_times_before_replacing_evidence() {
    use crate::door::canvas::{Content, Playback, Write};
    let held = held();
    let (folder, _) = session(&held, "canvas-native-media");
    let write: Write = serde_json::from_value(json!({
        "id":"canvas-native-media", "revision":0, "panes":[
            {"id":"file","kind":"file","path":"clip.mp4","view":"preview","playback":{"start":2,"position":2,"playing":false}},
            {"id":"audio","kind":"audio","src":"voice.ogg"},
            {"id":"remote","kind":"video","src":"ssh://build/tmp/demo.webm"}
        ]
    })).unwrap();
    let kept = held
        .door
        .draw(&write.id, write.panes, write.revision)
        .unwrap();
    let shown = serde_json::to_value(&kept).unwrap();
    assert_eq!(
        shown["panes"][0]["path"],
        format!("{}/clip.mp4", folder.path().display())
    );
    assert_eq!(
        shown["panes"][1]["src"],
        format!("{}/voice.ogg", folder.path().display())
    );
    assert_eq!(shown["panes"][2]["src"], "ssh://build/tmp/demo.webm");
    for value in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY, -1.0] {
        for field in ["start", "end", "position"] {
            let mut playback = Playback::default();
            match field {
                "start" => playback.start = Some(value),
                "end" => playback.end = Some(value),
                _ => playback.position = Some(value),
            }
            for content in [
                Content::Video {
                    src: "demo.mp4".into(),
                    playback: Some(playback.clone()),
                },
                Content::Audio {
                    src: "demo.ogg".into(),
                    playback: Some(playback.clone()),
                },
                Content::File {
                    path: "clip.mp4".into(),
                    view: None,
                    playback: Some(playback.clone()),
                },
            ] {
                let mut next = kept.panes.clone();
                next[0].content = content;
                assert!(
                    held.door.draw(&kept.id, next, Some(kept.revision)).is_err(),
                    "{field}: {value}"
                );
                assert_eq!(held.door.canvas(&kept.id).revision, kept.revision);
                assert_eq!(held.door.canvas(&kept.id).panes, kept.panes);
            }
        }
    }
    held.sessions.close(&kept.id);
    held.door.unserve();
}

#[cfg(unix)]
#[test]
fn evidence_is_addressed_to_its_terminal_and_survives_a_window_read() {
    let held = held();
    let (folder, first) = session(&held, "canvas-first");
    let (_other, second) = session(&held, "canvas-second");
    let call = |panes| {
        json!({"jsonrpc":"2.0","id":1,"method":"tools/call","params":{
            "name":"canvas", "arguments":{"panes":panes}
        }})
    };
    let (_, answer) = post(
        &first,
        &call(json!([
            {"id":"app","kind":"iframe","url":"http://localhost:3000"},
            {"id":"shot","kind":"image","src":"screen.png"},
            {"id":"code","kind":"code","text":"const answer = 42;"}
        ])),
    );
    assert!(answer["result"]["isError"].is_null(), "{answer}");
    let shown = &answer["result"]["structuredContent"];
    assert_eq!(shown["id"], "canvas-first");
    assert_eq!(
        shown["panes"][1]["src"],
        format!("{}/screen.png", folder.path().display())
    );
    assert_eq!(held.door.canvases().len(), 1);
    let (_, read) = post(
        &second,
        &json!({"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"canvas","arguments":{}}}),
    );
    assert_eq!(read["result"]["structuredContent"]["panes"], json!([]));

    let stale = held.door.draw("canvas-first", vec![], Some(0));
    assert!(
        stale.is_err(),
        "a stale editor must not erase the agent's new evidence"
    );
    assert_eq!(held.door.canvas("canvas-first").panes.len(), 3);

    for panes in [
        json!([{"id":"bad","kind":"iframe","url":"javascript:alert(1)"}]),
        json!([{"id":"bad","kind":"iframe","url":"http://ipc.localhost"}]),
        json!([{"id":"same","kind":"empty"},{"id":"same","kind":"empty"}]),
        json!([{"id":"missing","kind":"file"}]),
    ] {
        let (_, denied) = post(&first, &call(panes));
        assert_eq!(denied["result"]["isError"], true, "{denied}");
        assert_eq!(held.door.canvas("canvas-first").panes.len(), 3);
    }
    held.sessions.close("canvas-first");
    assert!(held.door.canvases().is_empty());
    assert!(held.door.draw("canvas-first", vec![], None).is_err());
    held.sessions.close("canvas-second");
    held.door.unserve();
}
