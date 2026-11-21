//! A browser tab sees one canvas through a loopback capability, never general native IPC.

mod scope;

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Seek, SeekFrom, Write};
use std::net::{TcpListener, TcpStream};
use std::path::Path;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tauri::{AppHandle, Manager, Runtime};
use totex_persistent::door::canvas::{Canvas, Pane};
use totex_persistent::session::Running;

#[derive(Default)]
pub struct Browser(Mutex<Option<Arc<Serving>>>);

struct Serving {
    port: u16,
    tickets: Mutex<HashMap<String, Arc<Mutex<Grant>>>>,
    requests: AtomicUsize,
}

struct Grant {
    id: String,
    access: scope::Access,
}

#[tauri::command(async)]
pub fn canvas_browser_open<R: Runtime>(
    app: AppHandle<R>,
    id: String,
    token: String,
) -> Result<String, String> {
    let sessions = crate::persistent::link(&app).asked::<Vec<Running>>("sessions", json!({}))?;
    let running = sessions
        .iter()
        .find(|session| session.id == id)
        .ok_or("The terminal has ended")?;
    let current = canvas(&app, &id)?;
    let mut access = scope::Access::default();
    access.update(&current, &running.cwd, true);
    if !valid_token(&token) {
        return Err("Invalid browser capability".into());
    }
    let state = app.state::<Browser>();
    let mut held = state.0.lock().map_err(|e| e.to_string())?;
    if held.is_none() {
        let listener = TcpListener::bind(("127.0.0.1", 0)).map_err(|e| e.to_string())?;
        let serving = Arc::new(Serving {
            port: listener.local_addr().map_err(|e| e.to_string())?.port(),
            tickets: Mutex::new(HashMap::new()),
            requests: AtomicUsize::new(0),
        });
        let server = Arc::clone(&serving);
        let owner = app.clone();
        std::thread::spawn(move || {
            for stream in listener.incoming().flatten() {
                if server.requests.fetch_add(1, Ordering::Relaxed) >= 16 {
                    server.requests.fetch_sub(1, Ordering::Relaxed);
                    continue;
                }
                let server = Arc::clone(&server);
                let app = owner.clone();
                std::thread::spawn(move || {
                    let _ = answer(&app, &server, stream);
                    server.requests.fetch_sub(1, Ordering::Relaxed);
                });
            }
        });
        *held = Some(serving);
    }
    let server = held.as_ref().unwrap();
    let mut tickets = server.tickets.lock().map_err(|e| e.to_string())?;
    let token = issue(&mut tickets, &sessions, id, token, access)?;
    Ok(format!(
        "http://127.0.0.1:{}/browser.html#{token}",
        server.port
    ))
}

fn issue(
    tickets: &mut HashMap<String, Arc<Mutex<Grant>>>,
    sessions: &[Running],
    id: String,
    token: String,
    access: scope::Access,
) -> Result<String, String> {
    tickets.retain(|_, grant| {
        grant
            .lock()
            .is_ok_and(|grant| sessions.iter().any(|session| session.id == grant.id))
    });
    let previous = tickets.iter().find_map(|(token, grant)| {
        grant
            .lock()
            .ok()
            .and_then(|grant| (grant.id == id).then(|| token.clone()))
    });
    let token = if let Some(previous) = previous {
        previous
    } else {
        if tickets.len() >= 128 {
            return Err("Too many browser canvases are open".into());
        }
        if tickets.contains_key(&token) {
            return Err("Browser capability is already in use".into());
        }
        token
    };
    tickets.insert(token.clone(), Arc::new(Mutex::new(Grant { id, access })));
    Ok(token)
}

fn valid_token(token: &str) -> bool {
    token.len() == 36
        && token.bytes().enumerate().all(|(at, byte)| {
            if [8, 13, 18, 23].contains(&at) {
                byte == b'-'
            } else {
                byte.is_ascii_hexdigit()
            }
        })
}

fn session<R: Runtime>(app: &AppHandle<R>, id: &str) -> Result<Running, String> {
    crate::persistent::link(app)
        .asked::<Vec<Running>>("sessions", json!({}))?
        .into_iter()
        .find(|session| session.id == id)
        .ok_or("The terminal has ended".into())
}

fn canvas<R: Runtime>(app: &AppHandle<R>, id: &str) -> Result<Canvas, String> {
    crate::persistent::link(app)
        .asked::<Vec<Canvas>>("canvas_read", json!({}))?
        .into_iter()
        .find(|canvas| canvas.id == id)
        .map(Ok)
        .unwrap_or_else(|| {
            Ok(Canvas {
                id: id.into(),
                revision: 0,
                panes: vec![],
            })
        })
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Call {
    command: String,
    #[serde(default)]
    args: Value,
}

fn encode(value: impl Serialize) -> Result<Value, String> {
    serde_json::to_value(value).map_err(|e| e.to_string())
}

fn string<'a>(args: &'a Value, key: &str) -> Result<&'a str, String> {
    args[key].as_str().ok_or_else(|| format!("Missing {key}"))
}

fn invoke<R: Runtime>(app: &AppHandle<R>, grant: &mut Grant, call: Call) -> Result<Value, String> {
    let id = grant.id.as_str();
    let running = session(app, id)?;
    let current = canvas(app, id)?;
    grant.access.update(&current, &running.cwd, true);
    let args = call.args;
    match call.command.as_str() {
        "session" => {
            let meta: Value = running
                .meta
                .as_deref()
                .and_then(|text| serde_json::from_str(text).ok())
                .unwrap_or(Value::Null);
            Ok(
                json!({"id":id,"cwd":running.cwd,"branch":meta["branch"].as_str().unwrap_or(""),"folder":meta["folder"]}),
            )
        }
        "canvas_read" => encode(vec![current]),
        "canvas_write" => {
            if string(&args, "id")? != id {
                return Err("This browser tab belongs to another canvas".into());
            }
            let panes: Vec<Pane> =
                serde_json::from_value(args["panes"].clone()).map_err(|e| e.to_string())?;
            let revision = args["revision"].as_u64().ok_or("Missing canvas revision")?;
            let next = Canvas {
                id: id.into(),
                revision,
                panes,
            };
            if scope::files(&next)
                .iter()
                .any(|path| !grant.access.readable(&current, path))
            {
                return Err("Add local files from the native canvas or its MCP tool first".into());
            }
            let next: Canvas = crate::persistent::link(app).asked(
                "canvas_write",
                json!({"id":id,"panes":next.panes,"revision":revision}),
            )?;
            // Browser-originated Markdown must not grant itself new filesystem access.
            grant.access.update(&next, &running.cwd, false);
            encode(next)
        }
        "read_file_head" | "read_file_data" | "stat_file" | "file_diff" | "media_file"
        | "write_file" => {
            let path = string(&args, "path")?;
            let write = call.command == "write_file";
            if !(if write {
                scope::direct(&current, path)
            } else {
                grant.access.readable(&current, path)
            }) {
                return Err("This file is not part of this canvas".into());
            }
            match call.command.as_str() {
                "read_file_head" => encode(crate::fs_browse::read_file_head(path)?),
                "read_file_data" => encode(crate::fs_browse::read_file_data(path)?),
                "stat_file" => encode(crate::fs_browse::stat_file(path)?),
                "file_diff" => encode(crate::git::patch::file_diff(
                    crate::fs_browse::resolve(path)?
                        .1
                        .to_string_lossy()
                        .into_owned(),
                )),
                "media_file" => encode(
                    crate::fs_browse::media_file(path, &app.asset_protocol_scope())?
                        .map(|_| path.to_string()),
                ),
                _ => encode(crate::fs_browse::write_file(
                    path,
                    string(&args, "text")?,
                    string(&args, "expected")?,
                )?),
            }
        }
        "fs_create_entry" => {
            if args["directory"].as_bool() != Some(false) {
                return Err("Only a canvas file can be restored".into());
            }
            let parent = string(&args, "parent")?;
            let name = string(&args, "name")?;
            let path = crate::host::Host::of_str(parent).join(Path::new(parent), name);
            if !scope::direct(&current, &path.to_string_lossy()) {
                return Err("This file is not part of this canvas".into());
            }
            encode(crate::fs_browse::create_entry(parent, name, false)?)
        }
        "directory_changes" => {
            let paths: Vec<String> =
                serde_json::from_value(args["paths"].clone()).map_err(|e| e.to_string())?;
            let files = scope::files(&current);
            let paths = paths
                .into_iter()
                .filter(|path| {
                    files.iter().any(|file| {
                        crate::host::Host::of_str(file)
                            .parent(Path::new(file))
                            .as_deref()
                            == Some(Path::new(path))
                    })
                })
                .collect();
            let mut changes = crate::git::changes::directory_changes(paths);
            for (parent, answer) in &mut changes {
                let host = crate::host::Host::of_str(parent);
                let allowed = |name: &str| {
                    scope::direct(
                        &current,
                        &host.join(Path::new(parent), name).to_string_lossy(),
                    )
                };
                answer.changed.retain(|name, _| allowed(name));
                answer.ignored.retain(|name| allowed(name));
            }
            encode(changes)
        }
        "app_settings_read" => {
            // A browser never seeds or changes the native preferences document.
            let source = dirs::home_dir()
                .map(|home| home.join(".totex/totex.json"))
                .and_then(|path| std::fs::read_to_string(path).ok())
                .and_then(|text| serde_json::from_str::<Value>(&text).ok())
                .unwrap_or_else(|| json!({}));
            let mut value = serde_json::Map::new();
            for key in [
                "theme",
                "appearance",
                "language",
                "fileTitle",
                "cardText",
                "pageText",
                "terminalText",
            ] {
                if let Some(setting) = source.get(key) {
                    value.insert(key.into(), setting.clone());
                }
            }
            Ok(json!({"path":"","text":"","value":value}))
        }
        "themes_read" => encode(crate::themes::themes_read()?),
        _ => Err("This command is unavailable in a browser canvas".into()),
    }
}

struct Request {
    method: String,
    path: String,
    headers: HashMap<String, String>,
    body: Vec<u8>,
}

fn read_request(stream: &TcpStream) -> Result<Request, String> {
    let mut reader = BufReader::new(stream);
    let mut header = Vec::new();
    loop {
        if reader
            .by_ref()
            .take(16 * 1024 + 1)
            .read_until(b'\n', &mut header)
            .map_err(|e| e.to_string())?
            == 0
        {
            return Err("Incomplete HTTP request".into());
        }
        if header.len() > 16 * 1024 {
            return Err("HTTP headers are too large".into());
        }
        if header.ends_with(b"\r\n\r\n") {
            break;
        }
    }
    let header = std::str::from_utf8(&header).map_err(|e| e.to_string())?;
    let mut lines = header.split("\r\n");
    let parts: Vec<_> = lines
        .next()
        .unwrap_or_default()
        .split_whitespace()
        .collect();
    if parts.len() != 3 || parts[2] != "HTTP/1.1" {
        return Err("Invalid HTTP request".into());
    }
    let mut headers = HashMap::new();
    for line in lines.filter(|line| !line.is_empty()) {
        let (key, value) = line.split_once(':').ok_or("Invalid HTTP header")?;
        if headers
            .insert(key.to_ascii_lowercase(), value.trim().to_string())
            .is_some()
        {
            return Err("Repeated HTTP header".into());
        }
    }
    if headers.contains_key("transfer-encoding") {
        return Err("Chunked requests are unsupported".into());
    }
    let length: usize = headers
        .get("content-length")
        .map(|length| length.parse())
        .transpose()
        .map_err(|_| "Invalid content length")?
        .unwrap_or(0);
    if length > 1024 * 1024 {
        return Err("Canvas request is too large".into());
    }
    let mut body = vec![0; length];
    reader.read_exact(&mut body).map_err(|e| e.to_string())?;
    Ok(Request {
        method: parts[0].into(),
        path: parts[1].into(),
        headers,
        body,
    })
}

fn origin_allowed(request: &Request, port: u16) -> bool {
    let host = format!("127.0.0.1:{port}");
    request.headers.get("host") == Some(&host)
        && request
            .headers
            .get("origin")
            .is_none_or(|origin| origin == &format!("http://{host}"))
        && request
            .headers
            .get("sec-fetch-site")
            .is_none_or(|site| site != "cross-site")
}

fn answer<R: Runtime>(
    app: &AppHandle<R>,
    server: &Serving,
    mut stream: TcpStream,
) -> Result<(), String> {
    stream
        .set_read_timeout(Some(Duration::from_secs(5)))
        .map_err(|e| e.to_string())?;
    stream
        .set_write_timeout(Some(Duration::from_secs(30)))
        .map_err(|e| e.to_string())?;
    let request = match read_request(&stream) {
        Ok(request) => request,
        Err(error) => return json_response(&mut stream, 400, json!({"error":error})),
    };
    if !origin_allowed(&request, server.port) {
        return json_response(&mut stream, 403, json!({"error":"Untrusted canvas origin"}));
    }
    if request.method == "POST" && request.path == "/api" {
        let token = request
            .headers
            .get("authorization")
            .and_then(|value| value.strip_prefix("Bearer "))
            .unwrap_or("");
        let grant = server
            .tickets
            .lock()
            .map_err(|e| e.to_string())?
            .get(token)
            .cloned();
        let Some(grant) = grant else {
            return json_response(
                &mut stream,
                403,
                json!({"error":"Invalid canvas capability"}),
            );
        };
        if request.headers.get("origin") != Some(&format!("http://127.0.0.1:{}", server.port))
            || request
                .headers
                .get("content-type")
                .is_none_or(|value| value != "application/json")
        {
            return json_response(
                &mut stream,
                403,
                json!({"error":"Invalid canvas request origin or content type"}),
            );
        }
        let result = serde_json::from_slice::<Call>(&request.body)
            .map_err(|e| e.to_string())
            .and_then(|call| invoke(app, &mut *grant.lock().map_err(|e| e.to_string())?, call));
        return match result {
            Ok(value) => json_response(&mut stream, 200, value),
            Err(error) => json_response(&mut stream, 400, json!({"error":error})),
        };
    }
    if request.method == "GET" && request.path.starts_with("/media/") {
        return media(app, server, &request, &mut stream);
    }
    let path = request.path.split('?').next().unwrap_or_default();
    if request.method != "GET" || !asset_path(path) {
        return json_response(&mut stream, 404, json!({"error":"Not found"}));
    }
    let Some(asset) = app
        .asset_resolver()
        .get(path.trim_start_matches('/').into())
    else {
        return json_response(
            &mut stream,
            404,
            json!({"error":"Canvas assets are unavailable"}),
        );
    };
    respond(&mut stream, 200, &asset.mime_type, &asset.bytes)
}

fn asset_path(path: &str) -> bool {
    (path == "/browser.html"
        || path == "/ephemeral.json"
        || path.starts_with("/assets/")
        || path.starts_with("/pdf-assets/"))
        && !path.contains(['%', '\\'])
        && !path.split('/').any(|part| part == "." || part == "..")
}

fn headers(
    stream: &mut TcpStream,
    status: u16,
    kind: &str,
    length: u64,
    extra: &str,
) -> Result<(), String> {
    write!(stream, "HTTP/1.1 {status} Canvas\r\nContent-Type: {kind}\r\nContent-Length: {length}\r\nConnection: close\r\nCache-Control: no-store\r\nReferrer-Policy: no-referrer\r\nX-Content-Type-Options: nosniff\r\nX-Frame-Options: DENY\r\n{extra}\r\n").map_err(|e| e.to_string())
}

fn respond(stream: &mut TcpStream, status: u16, kind: &str, bytes: &[u8]) -> Result<(), String> {
    headers(stream, status, kind, bytes.len() as u64, "")?;
    stream.write_all(bytes).map_err(|e| e.to_string())
}

fn json_response(stream: &mut TcpStream, status: u16, value: Value) -> Result<(), String> {
    respond(
        stream,
        status,
        "application/json",
        &serde_json::to_vec(&value).map_err(|e| e.to_string())?,
    )
}

fn media<R: Runtime>(
    app: &AppHandle<R>,
    server: &Serving,
    request: &Request,
    stream: &mut TcpStream,
) -> Result<(), String> {
    let url = reqwest::Url::parse(&format!("http://127.0.0.1:{}{}", server.port, request.path))
        .map_err(|e| e.to_string())?;
    let Some((token, path)) = url
        .path()
        .strip_prefix("/media/")
        .and_then(|tail| tail.split_once('/'))
    else {
        return json_response(
            stream,
            403,
            json!({"error":"Invalid canvas media capability"}),
        );
    };
    let grant = server
        .tickets
        .lock()
        .map_err(|e| e.to_string())?
        .get(token)
        .cloned();
    let Some(grant) = grant else {
        return json_response(stream, 403, json!({"error":"Invalid canvas capability"}));
    };
    // Query parsing uses the URL implementation's percent decoder; the encoded
    // path is a single segment, leaving ?v=... available to the existing player.
    let path = reqwest::Url::parse(&format!("http://localhost/?path={path}"))
        .map_err(|e| e.to_string())?
        .query_pairs()
        .next()
        .map(|(_, value)| value.into_owned())
        .unwrap_or_default();
    let result: Result<_, String> = (|| {
        let mut grant = grant.lock().map_err(|e| e.to_string())?;
        let running = session(app, &grant.id)?;
        let current = canvas(app, &grant.id)?;
        grant.access.update(&current, &running.cwd, true);
        if !grant.access.readable(&current, &path) {
            return Err("This file is not part of this canvas".into());
        }
        let path = crate::fs_browse::media_file(&path, &app.asset_protocol_scope())?
            .ok_or("Media streaming is unavailable for this path")?;
        let mut file = std::fs::File::open(&path).map_err(|e| e.to_string())?;
        let size = file.metadata().map_err(|e| e.to_string())?.len();
        let (start, end, partial) =
            byte_range(request.headers.get("range").map(String::as_str), size)?;
        file.seek(SeekFrom::Start(start))
            .map_err(|e| e.to_string())?;
        Ok((file, path, size, start, end, partial))
    })();
    let (file, path, size, start, end, partial) = match result {
        Ok(read) => read,
        Err(error) => return json_response(stream, 400, json!({"error":error})),
    };
    let kind = tauri::utils::mime_type::MimeType::parse(&[], &path);
    // Even a mislabeled media file cannot become an active document on the API origin.
    let mut extra =
        "Content-Security-Policy: sandbox; default-src 'none'\r\nAccept-Ranges: bytes\r\n"
            .to_string();
    if partial {
        extra.push_str(&format!("Content-Range: bytes {start}-{end}/{size}\r\n"));
    }
    headers(
        stream,
        if partial { 206 } else { 200 },
        &kind,
        end - start + 1,
        &extra,
    )?;
    std::io::copy(&mut file.take(end - start + 1), stream).map_err(|e| e.to_string())?;
    Ok(())
}

fn byte_range(value: Option<&str>, size: u64) -> Result<(u64, u64, bool), String> {
    if size == 0 {
        return Err("Empty media file".into());
    }
    let Some(value) = value else {
        return Ok((0, size - 1, false));
    };
    let (start, end) = value
        .strip_prefix("bytes=")
        .and_then(|range| range.split_once('-'))
        .ok_or("Invalid byte range")?;
    let (start, end) = if start.is_empty() {
        let length = end.parse::<u64>().map_err(|_| "Invalid byte range")?;
        if length == 0 {
            return Err("Invalid byte range".into());
        }
        (size.saturating_sub(length), size - 1)
    } else {
        (
            start.parse::<u64>().map_err(|_| "Invalid byte range")?,
            if end.is_empty() {
                size - 1
            } else {
                end.parse::<u64>()
                    .map_err(|_| "Invalid byte range")?
                    .min(size - 1)
            },
        )
    };
    if start > end || start >= size {
        return Err("Invalid byte range".into());
    }
    Ok((start, end, true))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn browser_requests_reject_foreign_origins_hosts_and_asset_traversal() {
        let mut request = Request {
            method: "POST".into(),
            path: "/api".into(),
            headers: HashMap::from([
                ("host".into(), "127.0.0.1:12345".into()),
                ("origin".into(), "http://127.0.0.1:12345".into()),
            ]),
            body: vec![],
        };
        assert!(origin_allowed(&request, 12345));
        request
            .headers
            .insert("origin".into(), "https://example.com".into());
        assert!(!origin_allowed(&request, 12345));
        request.headers.remove("origin");
        request
            .headers
            .insert("host".into(), "attacker.example:12345".into());
        assert!(!origin_allowed(&request, 12345));
        assert!(asset_path("/browser.html"));
        assert!(asset_path("/assets/canvas.js"));
        assert!(!asset_path("/assets/../../secret"));
        assert!(!asset_path("/assets/%2e%2e/secret"));
        assert!(!asset_path("/index.html"));
        assert!(valid_token("01234567-89ab-4def-8123-0123456789ab"));
        assert!(!valid_token("short"));
    }
    #[test]
    fn media_ranges_are_bounded() {
        assert_eq!(byte_range(None, 100).unwrap(), (0, 99, false));
        assert_eq!(byte_range(Some("bytes=20-"), 100).unwrap(), (20, 99, true));
        assert_eq!(byte_range(Some("bytes=-10"), 100).unwrap(), (90, 99, true));
        assert_eq!(byte_range(Some("bytes=0-999"), 100).unwrap(), (0, 99, true));
        assert!(byte_range(Some("bytes=100-"), 100).is_err());
        assert!(byte_range(Some("bytes=10-2"), 100).is_err());
        assert!(byte_range(Some("bytes=0-1,3-4"), 100).is_err());
    }

    #[test]
    fn ended_sessions_do_not_consume_browser_ticket_capacity() {
        let mut tickets = (0..128)
            .map(|index| {
                (
                    format!("old-{index}"),
                    Arc::new(Mutex::new(Grant {
                        id: format!("ended-{index}"),
                        access: scope::Access::default(),
                    })),
                )
            })
            .collect();
        let sessions = vec![Running {
            id: "live".into(),
            cwd: "/tmp".into(),
            rows: 24,
            cols: 80,
            meta: None,
            pid: None,
        }];
        assert_eq!(
            issue(
                &mut tickets,
                &sessions,
                "live".into(),
                "fresh".into(),
                scope::Access::default()
            )
            .unwrap(),
            "fresh"
        );
        assert_eq!(tickets.len(), 1);
        assert_eq!(
            issue(
                &mut tickets,
                &sessions,
                "live".into(),
                "unused".into(),
                scope::Access::default()
            )
            .unwrap(),
            "fresh"
        );
        assert_eq!(tickets.len(), 1);
    }
}

#[cfg(all(test, unix))]
#[path = "tests/endpoint.rs"]
mod endpoint_tests;
