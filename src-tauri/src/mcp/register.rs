//! One registration sets up both the shared connection and terminal identification.

use std::path::{Path, PathBuf};
use toml_edit::{Array, DocumentMut, Item, Table, TableLike, value};
use totex_host::{host::Host, wsl};

const LIMIT: u64 = 1024 * 1024;

pub(super) fn run(args: &[String]) -> Result<(), String> {
    let (host, home) = destination(args)?;
    let url = totex_persistent::door::connection::url()?;
    register(&host, &home, &url)
}

fn destination(args: &[String]) -> Result<(Host, PathBuf), String> {
    let mut distro = None;
    let mut home = None;
    let mut args = args.iter();
    while let Some(flag) = args.next() {
        let place = match flag.as_str() {
            "--wsl" if distro.is_none() => &mut distro,
            "--codex-home" if home.is_none() => &mut home,
            _ => return Err(format!("Unknown or repeated registration argument: {flag}")),
        };
        let value = args
            .next()
            .ok_or_else(|| format!("Missing value for {flag}"))?;
        if value.is_empty() || value.contains(['\0', '\r', '\n']) {
            return Err(format!("Invalid value for {flag}"));
        }
        *place = Some(value.clone());
    }
    let host = distro.map_or(Host::Local, Host::Wsl);
    let native = match (&host, home) {
        (_, Some(home)) => home,
        (Host::Local, None) => match std::env::var_os("CODEX_HOME").filter(|v| !v.is_empty()) {
            Some(home) => home
                .into_string()
                .map_err(|_| "CODEX_HOME is not valid UTF-8.")?,
            None => totex_host::fs_browse::home_dir()
                .ok_or("The home directory is unavailable.")?
                .join(".codex")
                .to_str()
                .ok_or("The home directory is not valid UTF-8.")?
                .to_string(),
        },
        _ => return Err("WSL registration needs --codex-home from that distribution.".into()),
    };
    let absolute = match host {
        Host::Local => Path::new(&native).is_absolute(),
        _ => native.starts_with('/'),
    };
    if !absolute || native.contains(['\0', '\r', '\n']) {
        return Err("CODEX_HOME must be an absolute path without line breaks.".into());
    }
    let home = host.canonical(&native);
    Ok((host, home))
}

fn register(host: &Host, home: &Path, url: &str) -> Result<(), String> {
    let config = host.join(home, "config.toml");
    let config = if host.exists(&config) {
        host.resolve(&config)
            .ok_or("Cannot resolve Codex config.toml.")?
    } else {
        config
    };
    let before = read(host, &config)?;
    let bridge = host.join(home, "totex-mcp-bridge.sh");
    let transport = match host {
        Host::Wsl(distro) => Some((host.native(&bridge), wsl::windows_curl(distro)?)),
        _ => None,
    };
    let next = patched(before.as_deref().unwrap_or(""), url, transport.as_ref())?;
    tauri::async_runtime::block_on(super::probe::ready(url))?;
    if transport.is_some() {
        let previous = read(host, &bridge)?;
        atomic(host, &bridge, BRIDGE, previous.as_deref())?;
    }
    if before.as_deref() != Some(&next) {
        atomic(host, &config, &next, before.as_deref())?;
    }
    Ok(())
}

fn table<'a>(parent: &'a mut dyn TableLike, name: &str) -> Result<&'a mut dyn TableLike, String> {
    parent
        .entry(name)
        .or_insert(Item::Table(Table::new()))
        .as_table_like_mut()
        .ok_or_else(|| format!("Codex {name} must be a TOML table."))
}

fn patched(before: &str, url: &str, bridge: Option<&(String, String)>) -> Result<String, String> {
    let mut document = before
        .parse::<DocumentMut>()
        .map_err(|error| format!("Codex config.toml is invalid: {error}"))?;
    let servers = table(document.as_table_mut(), "mcp_servers")?;
    let server = table(servers, "totex")?;
    for key in [
        "env",
        "env_vars",
        "cwd",
        "bearer_token",
        "bearer_token_env_var",
        "http_headers",
        "env_http_headers",
        "http_headers_helper",
        "enabled_tools",
        "disabled_tools",
        "environment_id",
    ] {
        server.remove(key);
    }
    if let Some((path, curl)) = bridge {
        server.remove("url");
        server.insert("command", value("sh"));
        server.insert(
            "args",
            value(
                [path.as_str(), curl.as_str(), url]
                    .into_iter()
                    .collect::<Array>(),
            ),
        );
    } else {
        server.remove("command");
        server.remove("args");
        server.insert("url", value(url));
    }
    server.insert("enabled", value(true));

    let tui = table(document.as_table_mut(), "tui")?;
    let defaults = ["activity", "thread-name", "project-name"]
        .into_iter()
        .collect::<Array>();
    let title = tui.entry("terminal_title").or_insert(value(defaults));
    let items = title
        .as_array_mut()
        .ok_or("Codex tui.terminal_title must be a string array.")?;
    if items.iter().any(|item| item.as_str().is_none()) {
        return Err("Codex tui.terminal_title must be a string array.".into());
    }
    items.retain(|item| !matches!(item.as_str(), Some("thread-id" | "session-id")));
    items.insert(0, "thread-id");
    Ok(document.to_string())
}

fn read(host: &Host, path: &Path) -> Result<Option<String>, String> {
    if !host.exists(path) {
        return Ok(None);
    }
    let (bytes, length) = host.read_head(path, LIMIT)?;
    if length > LIMIT {
        return Err("Codex setup file exceeds 1 MiB.".into());
    }
    String::from_utf8(bytes)
        .map(Some)
        .map_err(|_| "Codex setup file is not valid UTF-8.".into())
}

fn atomic(host: &Host, path: &Path, next: &str, expected: Option<&str>) -> Result<(), String> {
    let parent = host
        .parent(path)
        .ok_or("The settings path has no parent directory.")?;
    host.create_dir_all(&parent)?;
    let nonce = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_nanos();
    let staging = host.join(
        &parent,
        &format!(".totex-register-{}-{nonce}", std::process::id()),
    );
    host.create_private_dir(&staging)?;
    let writing = host.join(&staging, "config");
    let result = (|| {
        host.write_new(&writing, next.as_bytes())?;
        host.set_mode(&writing, 0o600)?;
        if read(host, path)?.as_deref() != expected {
            return Err(
                "Codex settings changed during registration; run the command again.".into(),
            );
        }
        host.rename(&writing, path)
    })();
    host.remove_all(&staging);
    result
}

// Windows curl reaches Windows loopback even when WSL uses NAT networking.
const BRIDGE: &str = r#"set -eu
curl=$1
url=$2
while IFS= read -r message || [ -n "$message" ]; do
  response=$(printf '%s' "$message" | "$curl" --noproxy '*' --fail --silent --show-error --connect-timeout 5 --max-time 60 -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' --data-binary @- "$url") || exit 1
  if [ -n "$response" ]; then printf '%s\n' "$response"; fi
done
"#;

#[cfg(test)]
mod tests;
