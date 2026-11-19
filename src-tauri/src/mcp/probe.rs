//! Confirm the running service before offering or writing a registration.

use serde_json::{Value, json};
use std::time::Duration;

const LIMIT: usize = 128 * 1024;

pub(super) async fn ready(url: &str) -> Result<(), String> {
    crate::release::fetch::provider();
    let client = reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(3))
        .build()
        .map_err(|error| format!("Could not check totex MCP: {}", error.without_url()))?;
    let hello = post(
        &client,
        url,
        json!({
            "jsonrpc":"2.0", "id":1, "method":"initialize", "params":{
                "protocolVersion":"2025-06-18", "capabilities":{},
                "clientInfo":{"name":"totex-setup", "version":env!("CARGO_PKG_VERSION")}
            }
        }),
    )
    .await?;
    if hello["result"]["serverInfo"]["name"] != "totex" {
        return Err("Another server is answering at totex's MCP address.".into());
    }
    post(
        &client,
        url,
        json!({"jsonrpc":"2.0", "method":"notifications/initialized"}),
    )
    .await?;
    let listed = post(
        &client,
        url,
        json!({"jsonrpc":"2.0", "id":2, "method":"tools/list"}),
    )
    .await?;
    if !listed["result"]["tools"].as_array().is_some_and(|tools| {
        tools
            .iter()
            .any(|tool| tool["name"] == "canvas" && tool["inputSchema"]["type"] == "object")
    }) {
        return Err("The running totex service has no canvas tool. Update and restart the terminal service.".into());
    }
    Ok(())
}

async fn post(client: &reqwest::Client, url: &str, message: Value) -> Result<Value, String> {
    let mut response = client
        .post(url)
        .header("Content-Type", "application/json")
        .header("Accept", "application/json, text/event-stream")
        .body(message.to_string())
        .send()
        .await
        .map_err(|error| {
            format!(
                "Could not connect to totex MCP. Start totex first. {}",
                error.without_url()
            )
        })?;
    if response.status() == reqwest::StatusCode::NOT_FOUND {
        return Err("The running terminal service rejected the MCP connection (HTTP 404). Update and restart totex's terminal service; restarting only the window does not update it.".into());
    }
    if !response.status().is_success() {
        return Err(format!(
            "The totex MCP connection failed (HTTP {}).",
            response.status().as_u16()
        ));
    }
    if response
        .content_length()
        .is_some_and(|size| size > LIMIT as u64)
    {
        return Err("The MCP setup response is too large.".into());
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|error| {
        format!(
            "Could not read the MCP setup response: {}",
            error.without_url()
        )
    })? {
        if bytes.len() + chunk.len() > LIMIT {
            return Err("The MCP setup response is too large.".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    if message.get("id").is_none() {
        return Ok(Value::Null);
    }
    let reply: Value =
        serde_json::from_slice(&bytes).map_err(|_| "The MCP setup response is not JSON.")?;
    if reply["jsonrpc"] != "2.0"
        || reply["id"] != message["id"]
        || reply.get("error").is_some()
        || !reply["result"].is_object()
    {
        return Err("The running service did not accept the MCP setup request.".into());
    }
    Ok(reply)
}

#[cfg(test)]
mod tests;
