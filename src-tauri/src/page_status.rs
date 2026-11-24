use reqwest::{Url, header::HeaderMap};
use serde::Serialize;
use std::time::Duration;

#[derive(Debug, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum PageStatus {
    Ready,
    Unavailable,
    FrameBlocked,
    RedirectBlocked,
    HttpError { status: u16 },
}

fn local(url: &Url) -> bool {
    matches!(url.scheme(), "http" | "https")
        && url.username().is_empty()
        && url.password().is_none()
        && url.host_str().is_some_and(|host| {
            host == "localhost"
                || host
                    .trim_matches(['[', ']'])
                    .parse::<std::net::IpAddr>()
                    .is_ok_and(|address| address.is_loopback())
        })
}

fn frame_blocked(headers: &HeaderMap) -> bool {
    let ancestors = headers
        .get_all("content-security-policy")
        .iter()
        .filter_map(|value| value.to_str().ok())
        .flat_map(|value| value.split(';'))
        .filter_map(|directive| {
            let mut words = directive.split_whitespace();
            words
                .next()?
                .eq_ignore_ascii_case("frame-ancestors")
                .then(|| words.collect::<Vec<_>>())
        })
        .collect::<Vec<_>>();
    if !ancestors.is_empty() {
        // An enforcing frame-ancestors directive takes precedence over X-Frame-Options.
        return ancestors
            .iter()
            .any(|sources| sources.is_empty() || sources == &["'none'"] || sources == &["'self'"]);
    }
    headers
        .get_all("x-frame-options")
        .iter()
        .filter_map(|value| value.to_str().ok())
        .flat_map(|value| value.split(','))
        .any(|value| {
            matches!(
                value.trim().to_ascii_uppercase().as_str(),
                "DENY" | "SAMEORIGIN"
            )
        })
}

/// Diagnose local development pages without forwarding credentials or reading their bodies.
#[tauri::command]
pub async fn canvas_page_status(url: String) -> Result<PageStatus, String> {
    let mut url = Url::parse(&url).map_err(|_| "Invalid page URL")?;
    if !local(&url) {
        return Err("Only loopback HTTP(S) pages can be checked".into());
    }
    crate::release::fetch::provider();
    let client = reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(3))
        .build()
        .map_err(|_| "Could not check the page")?;
    for _ in 0..4 {
        let response = match client.head(url.clone()).send().await {
            Ok(response) => response,
            Err(_) => return Ok(PageStatus::Unavailable),
        };
        if response.status().is_redirection() {
            let next = response
                .headers()
                .get("location")
                .and_then(|value| value.to_str().ok())
                .and_then(|value| url.join(value).ok());
            let Some(next) = next.filter(|next| local(next) && next.origin() == url.origin())
            else {
                return Ok(PageStatus::RedirectBlocked);
            };
            url = next;
            continue;
        }
        if frame_blocked(response.headers()) {
            return Ok(PageStatus::FrameBlocked);
        }
        let status = response.status().as_u16();
        // An anonymous HEAD is not evidence that the browser's authenticated GET will fail.
        if status == 404 || status == 410 || status >= 500 {
            return Ok(PageStatus::HttpError { status });
        }
        return Ok(PageStatus::Ready);
    }
    Ok(PageStatus::RedirectBlocked)
}

#[cfg(test)]
mod tests;
