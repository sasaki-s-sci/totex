//! A terminal-scoped transport for agents started as separate CLI processes.

use std::io::{BufRead, Read, Write};
use std::time::Duration;

use serde_json::Value;

const REQUEST_LIMIT: u64 = 256 * 1024;
const RESPONSE_LIMIT: usize = 1024 * 1024;

pub(super) fn run(args: &[String]) -> Result<(), String> {
    let address = match args {
        [] => std::env::var("TOTEX_MCP_URL").map_err(|_| {
            "Open a new totex terminal with MCP enabled, then start the agent.".to_string()
        })?,
        [address] => address.clone(),
        _ => return Err("Expected --mcp-stdio with at most one terminal address.".into()),
    };
    let url = endpoint(&address)?;
    crate::release::fetch::provider();
    let client = reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(60))
        .build()
        .map_err(|error| error.without_url().to_string())?;
    tauri::async_runtime::block_on(relay(
        &client,
        &url,
        &mut std::io::stdin().lock(),
        &mut std::io::stdout().lock(),
    ))
}

fn endpoint(address: &str) -> Result<String, String> {
    let valid = reqwest::Url::parse(address).is_ok_and(|url| {
        url.as_str() == address
            && url.scheme() == "http"
            && url.host_str() == Some("127.0.0.1")
            && url.port().is_some_and(|port| port != 0)
            && url.username().is_empty()
            && url.password().is_none()
            && url.query().is_none()
            && url.fragment().is_none()
            && url.path().strip_prefix("/s/").is_some_and(|token| {
                token.len() == 16 && token.bytes().all(|byte| byte.is_ascii_hexdigit())
            })
    });
    if !valid {
        return Err(
            "No valid totex terminal address. Open a new terminal with MCP enabled.".into(),
        );
    }
    Ok(format!("{address}/terminal"))
}

async fn relay(
    client: &reqwest::Client,
    url: &str,
    input: &mut impl BufRead,
    output: &mut impl Write,
) -> Result<(), String> {
    loop {
        let mut line = String::new();
        let length = input
            .by_ref()
            .take(REQUEST_LIMIT + 1)
            .read_line(&mut line)
            .map_err(|error| error.to_string())?;
        if length == 0 {
            return Ok(());
        }
        if length as u64 > REQUEST_LIMIT {
            return Err("MCP request is too large.".into());
        }
        if line.trim().is_empty() {
            continue;
        }
        let message: Value = serde_json::from_str(&line).map_err(|_| "MCP request is not JSON.")?;
        if message["jsonrpc"] != "2.0" || !message["method"].is_string() {
            return Err("MCP request is not a JSON-RPC message.".into());
        }
        let mut response = client
            .post(url)
            .header("Content-Type", "application/json")
            .header("Accept", "application/json, text/event-stream")
            .body(line)
            .send()
            .await
            .map_err(|error| format!("Could not reach totex: {}", error.without_url()))?;
        if !response.status().is_success() {
            return Err(format!(
                "totex MCP returned HTTP {}. Update totex and open a new terminal with MCP enabled.",
                response.status().as_u16()
            ));
        }
        let mut bytes = Vec::new();
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|error| error.without_url().to_string())?
        {
            if bytes.len() + chunk.len() > RESPONSE_LIMIT {
                return Err("MCP response is too large.".into());
            }
            bytes.extend_from_slice(&chunk);
        }
        if message.get("id").is_none() {
            continue;
        }
        let reply: Value =
            serde_json::from_slice(&bytes).map_err(|_| "MCP response is not JSON.")?;
        if reply["jsonrpc"] != "2.0" || reply["id"] != message["id"] {
            return Err("MCP response does not match the request.".into());
        }
        writeln!(output, "{reply}")
            .and_then(|()| output.flush())
            .map_err(|error| error.to_string())?;
    }
}

#[cfg(test)]
mod tests;
