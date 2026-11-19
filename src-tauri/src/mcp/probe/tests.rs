use super::*;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpListener;

const SECRET: &str = "private-registration-credential";

fn response(status: &str, body: &str) -> String {
    format!(
        "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    )
}

fn check(responses: Vec<String>) -> Result<(), String> {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}/mcp/{SECRET}", listener.local_addr().unwrap());
    let serving = std::thread::spawn(move || {
        for response in responses {
            let (mut socket, _) = listener.accept().unwrap();
            socket
                .set_read_timeout(Some(Duration::from_secs(5)))
                .unwrap();
            let mut request = BufReader::new(socket.try_clone().unwrap());
            let mut line = String::new();
            request.read_line(&mut line).unwrap();
            assert_eq!(line, format!("POST /mcp/{SECRET} HTTP/1.1\r\n"));
            let mut length = 0;
            loop {
                line.clear();
                request.read_line(&mut line).unwrap();
                if line == "\r\n" {
                    break;
                }
                if let Some((name, value)) = line.split_once(':')
                    && name.eq_ignore_ascii_case("content-length")
                {
                    length = value.trim().parse::<usize>().unwrap();
                }
            }
            request.read_exact(&mut vec![0; length]).unwrap();
            let _ = socket.write_all(response.as_bytes());
        }
    });
    let result = tauri::async_runtime::block_on(ready(&url));
    serving.join().unwrap();
    result
}

#[test]
fn a_stale_service_is_reported_without_exposing_the_registration_key() {
    let error = check(vec![response("404 Not Found", "")]).unwrap_err();
    assert!(error.contains("terminal service") && error.contains("404"));
    assert!(!error.contains(SECRET));
}

#[test]
fn setup_does_not_follow_a_redirect_with_its_credential() {
    let error = check(vec![format!(
        "HTTP/1.1 302 Found\r\nLocation: http://127.0.0.1:1/{SECRET}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
    )]).unwrap_err();
    assert!(error.contains("302"));
    assert!(!error.contains(SECRET));
}

#[test]
fn a_listener_that_is_not_totex_cannot_validate_registration() {
    for body in [
        r#"{"jsonrpc":"2.0","id":1,"result":{"serverInfo":{"name":"another-server"}}}"#,
        r#"{"jsonrpc":"2.0","id":1,"error":{"code":-32601,"message":"missing"}}"#,
        r#"{"jsonrpc":"2.0","id":2,"result":{}}"#,
        "not JSON",
    ] {
        assert!(check(vec![response("200 OK", body)]).is_err());
    }
}

#[test]
fn a_handshake_without_canvas_tools_is_not_ready() {
    let error = check(vec![
        response(
            "200 OK",
            r#"{"jsonrpc":"2.0","id":1,"result":{"serverInfo":{"name":"totex"}}}"#,
        ),
        response("202 Accepted", ""),
        response(
            "200 OK",
            r#"{"jsonrpc":"2.0","id":2,"result":{"tools":[]}}"#,
        ),
    ])
    .unwrap_err();
    assert!(error.contains("no canvas tool"));
}

#[test]
fn response_size_is_bounded_with_or_without_content_length() {
    let sized = format!(
        "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        LIMIT + 1
    );
    let chunked = format!(
        "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n{:x}\r\n{}\r\n1\r\nx\r\n0\r\n\r\n",
        LIMIT,
        "x".repeat(LIMIT)
    );
    for response in [sized, chunked] {
        assert!(check(vec![response]).unwrap_err().contains("too large"));
    }
}

#[test]
fn an_unavailable_endpoint_does_not_leak_the_key() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}/mcp/{SECRET}", listener.local_addr().unwrap());
    drop(listener);
    let error = tauri::async_runtime::block_on(ready(&url)).unwrap_err();
    assert!(error.contains("Start totex"));
    assert!(!error.contains(SECRET));
}
