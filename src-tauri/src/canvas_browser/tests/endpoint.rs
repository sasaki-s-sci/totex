use super::*;
use tauri::test::{MockRuntime, mock_builder, mock_context, noop_assets};
use totex_persistent::talk::Link;
use totex_persistent::{Persistent, serve};

const TOKEN: &str = "01234567-89ab-4def-8123-0123456789ab";

fn exchange(
    app: &AppHandle<MockRuntime>,
    server: &Serving,
    listener: &TcpListener,
    method: &str,
    path: &str,
    extra: &str,
    body: &str,
) -> (u16, String, Vec<u8>) {
    let address = listener.local_addr().unwrap();
    let request = format!(
        "{method} {path} HTTP/1.1\r\nHost: {address}\r\n{extra}Content-Length: {}\r\n\r\n{body}",
        body.len()
    );
    let client = std::thread::spawn(move || {
        let mut socket = TcpStream::connect(address).unwrap();
        socket
            .set_read_timeout(Some(Duration::from_secs(10)))
            .unwrap();
        socket.write_all(request.as_bytes()).unwrap();
        let mut response = Vec::new();
        socket.read_to_end(&mut response).unwrap();
        response
    });
    answer(app, server, listener.accept().unwrap().0).unwrap();
    let response = client.join().unwrap();
    let cut = response
        .windows(4)
        .position(|bytes| bytes == b"\r\n\r\n")
        .unwrap();
    let header = String::from_utf8(response[..cut].to_vec()).unwrap();
    let status = header.split_whitespace().nth(1).unwrap().parse().unwrap();
    (status, header, response[cut + 4..].to_vec())
}

#[test]
fn real_endpoint_scopes_files_commands_canvas_writes_and_media() {
    let dir = std::env::temp_dir().join(format!("totex-browser-endpoint-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let document = dir.join("note.md").to_string_lossy().into_owned();
    let image = dir.join("image.png").to_string_lossy().into_owned();
    let secret = dir.join("unrelated.txt").to_string_lossy().into_owned();
    let video = dir.join("clip.mp4").to_string_lossy().into_owned();
    std::fs::write(&document, "![image](image.png)").unwrap();
    std::fs::write(&image, b"picture").unwrap();
    std::fs::write(&secret, "private").unwrap();
    std::fs::write(&video, b"0123456789").unwrap();

    let keep = Persistent::new(None);
    let serving = serve::stand(Arc::clone(&keep), &dir, Box::new(|| {})).unwrap();
    let link = Arc::new(Link::connect(&dir).unwrap());
    let mut context = mock_context(noop_assets());
    context.config_mut().app.security.asset_protocol.enable = true;
    let app = mock_builder()
        .manage(crate::persistent::Reached::holding(link.clone()))
        .build(context)
        .unwrap();
    let handle = app.handle();
    for id in ["pinned", "other"] {
        crate::pty::pty_open(
            handle.clone(),
            id.into(),
            dir.to_string_lossy().into_owned(),
            24,
            80,
            (id == "pinned").then(|| json!({"canvas":"shared-canvas"}).to_string()),
        )
        .unwrap();
    }
    let initial: Canvas = link
        .asked(
            "canvas_write",
            json!({"id":"pinned","panes":[
                {"id":"note","kind":"file","path":document},
                {"id":"movie","kind":"video","src":video}
            ]}),
        )
        .unwrap();
    let _: Canvas = link
        .asked(
            "canvas_write",
            json!({"id":"other","panes":[{"id":"secret","kind":"file","path":secret}]}),
        )
        .unwrap();
    let mut access = scope::Access::default();
    access.update(&initial, &dir.to_string_lossy(), true);
    let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
    let server = Serving {
        port: listener.local_addr().unwrap().port(),
        tickets: Mutex::new(HashMap::from([(
            TOKEN.into(),
            Arc::new(Mutex::new(Grant {
                id: "pinned".into(),
                access,
            })),
        )])),
        requests: AtomicUsize::new(0),
    };
    let origin = format!("http://127.0.0.1:{}", server.port);
    let headers = format!(
        "Origin: {origin}\r\nAuthorization: Bearer {TOKEN}\r\nContent-Type: application/json\r\n"
    );
    let api = |command: &str, args: Value| {
        let (status, _, body) = exchange(
            handle,
            &server,
            &listener,
            "POST",
            "/api",
            &headers,
            &json!({"command":command,"args":args}).to_string(),
        );
        (status, serde_json::from_slice::<Value>(&body).unwrap())
    };
    let (status, value) = api("canvas_read", json!({"id":"other"}));
    assert_eq!(status, 200);
    assert_eq!(value.as_array().unwrap().len(), 1);
    assert_eq!(value[0]["id"], "shared-canvas");
    assert_eq!(api("session", json!({})).1["canvas"], "shared-canvas");
    assert_eq!(api("read_file_head", json!({"path":document})).0, 200);
    assert_eq!(api("read_file_data", json!({"path":image})).0, 200);
    assert_eq!(api("read_file_head", json!({"path":secret})).0, 400);
    assert_eq!(
        api(
            "write_file",
            json!({"path":image,"text":"bad","expected":"picture"})
        )
        .0,
        400
    );
    for command in [
        "pty_sessions",
        "pty_write",
        "persistent_get",
        "app_settings_patch",
        "read_directory",
        "fs_read_file",
    ] {
        assert_eq!(api(command, json!({})).0, 400, "{command}");
    }
    assert_eq!(
        api(
            "canvas_write",
            json!({"id":"other","revision":1,"panes":[]})
        )
        .0,
        400
    );
    for kind in ["file", "image", "video", "audio"] {
        let pane = if kind == "file" {
            json!({"id":"bad","kind":kind,"path":secret})
        } else {
            json!({"id":"bad","kind":kind,"src":secret})
        };
        assert_eq!(
            api(
                "canvas_write",
                json!({"id":"shared-canvas","revision":1,"panes":[pane]})
            )
            .0,
            400
        );
    }
    assert_eq!(
        api(
            "write_file",
            json!({"path":document,"text":"changed","expected":"wrong"})
        )
        .0,
        400
    );
    assert_eq!(api("write_file", json!({"path":document,"text":format!("[private]({secret})"),"expected":"![image](image.png)"})).0, 200);
    assert_eq!(api("read_file_head", json!({"path":secret})).0, 400);

    let foreign = headers.replace(&origin, "https://example.com");
    assert_eq!(
        exchange(handle, &server, &listener, "POST", "/api", &foreign, "{}").0,
        403
    );
    assert_eq!(
        exchange(
            handle,
            &server,
            &listener,
            "POST",
            "/api",
            &headers.replace(TOKEN, "wrong"),
            "{}"
        )
        .0,
        403
    );
    let path = format!(
        "/media/{TOKEN}/{}?v=1",
        reqwest::Url::parse("http://localhost")
            .unwrap()
            .query_pairs_mut()
            .append_pair("path", &video)
            .finish()
            .query()
            .unwrap()
            .trim_start_matches("path=")
    );
    let (status, header, body) = exchange(
        handle,
        &server,
        &listener,
        "GET",
        &path,
        "Range: bytes=2-5\r\n",
        "",
    );
    assert_eq!(status, 206);
    assert_eq!(body, b"2345");
    assert!(header.contains("Content-Security-Policy: sandbox; default-src 'none'"));
    assert!(header.contains("X-Content-Type-Options: nosniff"));
    assert!(header.contains("Content-Range: bytes 2-5/10"));

    for id in ["pinned", "other"] {
        crate::pty::pty_close(handle.clone(), id.into()).unwrap();
    }
    assert_eq!(api("canvas_read", json!({})).0, 400);
    drop(app);
    drop(link);
    drop(serving);
    drop(keep);
    std::fs::remove_dir_all(dir).unwrap();
}
