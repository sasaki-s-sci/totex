use super::*;
use std::io::{BufReader, Read};
use std::net::TcpListener;

#[test]
fn only_a_local_terminal_address_can_be_relayed() {
    let own = "http://127.0.0.1:26374/s/0123456789abcdef";
    assert_eq!(endpoint(own).unwrap(), format!("{own}/terminal"));
    for invalid in [
        "",
        "https://127.0.0.1:26374/s/0123456789abcdef",
        "http://example.com:26374/s/0123456789abcdef",
        "http://user@127.0.0.1:26374/s/0123456789abcdef",
        "http://127.0.0.1:26374/mcp/shared",
        "http://127.0.0.1:26374/s/not-a-key",
        &format!("{own}?redirect=elsewhere"),
        &format!("{own}#fragment"),
        &format!("{own}/terminal"),
        &format!(" {own}"),
    ] {
        assert!(endpoint(invalid).is_err(), "{invalid}");
    }
}

fn check(input: &str, replies: &[(&str, &str)]) -> (Result<(), String>, String) {
    crate::release::fetch::provider();
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!(
        "http://{}/s/0123456789abcdef/terminal",
        listener.local_addr().unwrap()
    );
    let replies: Vec<_> = replies.iter().map(|(status, body)| format!(
        "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()
    )).collect();
    let server = std::thread::spawn(move || {
        for reply in replies {
            let (mut socket, _) = listener.accept().unwrap();
            socket
                .set_read_timeout(Some(Duration::from_secs(5)))
                .unwrap();
            let mut request = BufReader::new(socket.try_clone().unwrap());
            let mut line = String::new();
            request.read_line(&mut line).unwrap();
            assert_eq!(line, "POST /s/0123456789abcdef/terminal HTTP/1.1\r\n");
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
            let _ = socket.write_all(reply.as_bytes());
        }
    });
    let client = reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(3))
        .build()
        .unwrap();
    let mut output = Vec::new();
    let result =
        tauri::async_runtime::block_on(relay(&client, &url, &mut input.as_bytes(), &mut output));
    server.join().unwrap();
    (result, String::from_utf8(output).unwrap())
}

#[test]
fn notifications_are_silent_and_tool_errors_are_preserved() {
    let input = "{\"jsonrpc\":\"2.0\",\"method\":\"notifications/initialized\"}\n{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/call\"}\n";
    let reply = r#"{"jsonrpc":"2.0","id":1,"result":{"isError":true,"content":[]}}"#;
    let (result, output) = check(input, &[("202 Accepted", ""), ("200 OK", reply)]);
    result.unwrap();
    let lines: Vec<_> = output.lines().collect();
    assert_eq!(lines.len(), 1);
    assert_eq!(
        serde_json::from_str::<Value>(lines[0]).unwrap()["result"]["isError"],
        true
    );
}

#[test]
fn invalid_oversized_and_failed_exchanges_stop_without_leaking_credentials() {
    for input in [
        "not-json\n".to_string(),
        "x".repeat(REQUEST_LIMIT as usize + 1),
    ] {
        assert!(check(&input, &[]).0.is_err());
    }
    let input = "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"ping\"}\n";
    for (status, body) in [
        ("404 Not Found", ""),
        ("302 Found", ""),
        ("200 OK", "not-json"),
        ("200 OK", r#"{"jsonrpc":"2.0","id":2,"result":{}}"#),
        ("200 OK", &"x".repeat(RESPONSE_LIMIT + 1)),
    ] {
        let (result, output) = check(input, &[(status, body)]);
        let error = result.unwrap_err();
        assert!(!error.contains("0123456789abcdef"));
        assert!(output.is_empty());
    }
}
