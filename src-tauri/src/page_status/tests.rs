use super::*;
use std::io::{BufRead, BufReader, Write};
use std::net::TcpListener;

fn check(responses: &[&str]) -> PageStatus {
    let server = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}/", server.local_addr().unwrap());
    let responses: Vec<String> = responses.iter().map(|value| value.to_string()).collect();
    let thread = std::thread::spawn(move || {
        for response in responses {
            let (mut stream, _) = server.accept().unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(5)))
                .unwrap();
            let mut line = String::new();
            BufReader::new(stream.try_clone().unwrap())
                .read_line(&mut line)
                .unwrap();
            assert!(line.starts_with("GET /"));
            stream
                .write_all(
                    format!(
                        "HTTP/1.1 {response}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
                    )
                    .as_bytes(),
                )
                .unwrap();
        }
    });
    let result = tauri::async_runtime::block_on(canvas_page_status(url)).unwrap();
    thread.join().unwrap();
    result
}

#[test]
fn only_loopback_pages_without_credentials_are_checked() {
    for value in [
        "http://127.0.0.1:3002/",
        "http://localhost:3000/",
        "https://[::1]/",
    ] {
        assert!(local(&Url::parse(value).unwrap()));
    }
    for value in [
        "file:///tmp/a",
        "https://example.com/",
        "http://192.168.1.1/",
        "http://localhost.evil/",
        "http://user:secret@localhost/",
    ] {
        assert!(!local(&Url::parse(value).unwrap()));
    }
}

#[test]
fn blocked_embedding_and_missing_pages_are_distinguished() {
    assert_eq!(
        check(&["200 OK\r\nX-Frame-Options: DENY"]),
        PageStatus::FrameBlocked
    );
    assert_eq!(
        check(&["200 OK\r\nX-Frame-Options: SAMEORIGIN"]),
        PageStatus::FrameBlocked
    );
    assert_eq!(
        check(&["200 OK\r\nContent-Security-Policy: frame-ancestors 'none'"]),
        PageStatus::FrameBlocked
    );
    assert_eq!(
        check(&["200 OK\r\nX-Frame-Options: DENY\r\nContent-Security-Policy: frame-ancestors *"]),
        PageStatus::Ready
    );
    assert_eq!(
        check(&["404 Not Found"]),
        PageStatus::HttpError { status: 404 }
    );
    assert_eq!(check(&["401 Unauthorized"]), PageStatus::Ready);
    assert_eq!(check(&["405 Method Not Allowed"]), PageStatus::Ready);
}

#[test]
fn redirects_stay_on_the_original_origin() {
    assert_eq!(
        check(&["302 Found\r\nLocation: /ready", "200 OK"]),
        PageStatus::Ready
    );
    assert_eq!(
        check(&["302 Found\r\nLocation: https://example.com/"]),
        PageStatus::RedirectBlocked
    );
    assert_eq!(
        check(&["302 Found\r\nLocation: http://127.0.0.1:1/"]),
        PageStatus::RedirectBlocked
    );
}

#[test]
fn a_closed_local_port_can_be_retried() {
    let server = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}/", server.local_addr().unwrap());
    drop(server);
    assert!(matches!(
        tauri::async_runtime::block_on(canvas_page_status(url)).unwrap(),
        PageStatus::Unavailable { reason: "refused", detail } if !detail.is_empty()
    ));
}

#[test]
fn a_server_that_never_sends_headers_reports_a_timeout() {
    let server = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}/", server.local_addr().unwrap());
    assert!(matches!(
        tauri::async_runtime::block_on(canvas_page_status(url)).unwrap(),
        PageStatus::Unavailable {
            reason: "timeout",
            ..
        }
    ));
}

#[test]
fn get_without_a_response_is_not_mistaken_for_a_ready_page() {
    let server = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}/?secret=private", server.local_addr().unwrap());
    let thread = std::thread::spawn(move || {
        let (stream, _) = server.accept().unwrap();
        stream
            .set_read_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        let mut reader = BufReader::new(stream);
        let mut line = String::new();
        reader.read_line(&mut line).unwrap();
        assert!(line.starts_with("GET /"));
        loop {
            line.clear();
            reader.read_line(&mut line).unwrap();
            if line == "\r\n" || line.is_empty() {
                break;
            }
        }
    });
    let status = tauri::async_runtime::block_on(canvas_page_status(url)).unwrap();
    thread.join().unwrap();
    assert!(matches!(
        status,
        PageStatus::Unavailable { reason: "connection", detail }
            if !detail.is_empty() && !detail.contains("private")
    ));
}
