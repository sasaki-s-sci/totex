//! Reading a manifest off the release page, and asking a URL for bytes.

use tauri::AppHandle;

use super::url::{listing_url, manifest_url, versions};
use super::{Manifest, PATIENCE, SMALL, declared};

/// Reads what one release says about itself, and checks it is that release.
pub async fn read(endpoint: &str, version: Option<&str>) -> Result<Manifest, String> {
    let url = manifest_url(endpoint, version).ok_or_else(|| {
        format!(
            "there is no release page here for {}",
            version.unwrap_or("the newest release")
        )
    })?;
    let asked = ask(&url, SMALL).await?;
    let manifest: Manifest =
        serde_json::from_slice(&asked).map_err(|error| format!("unreadable manifest: {error}"))?;
    if let Some(version) = version
        && manifest.version != version
    {
        return Err(format!(
            "v{version} was asked for and the release under that tag says {}",
            manifest.version
        ));
    }
    Ok(manifest)
}

/// Settles which implementation of the ciphers this process uses, once.
///
/// rustls does not carry one: something has to name it before the first client
/// is built, and a client built before anything has is not an error but a
/// panic — the one failure that does not come back down the wire as a message
/// somebody could read. The updater plugin names one, and it does it on the way
/// into its own download, so a copy that has never downloaded a release is a
/// copy where nothing has named one yet — which is every copy at the moment it
/// opens and asks which releases there are.
///
/// So it is named here as well, and it is the same one the plugin names:
/// installing it twice is what `install_default` returns an error for, and that
/// error is the answer "somebody already did", which is not a failure.
fn provider() {
    static ONCE: std::sync::Once = std::sync::Once::new();
    ONCE.call_once(|| {
        let _ = rustls::crypto::ring::default_provider().install_default();
    });
}

/// Reads a URL into memory, or says why it could not.
///
/// `most` is what the thing being read has no right to be bigger than. Held to
/// twice: once on what the server says it is about to send, and once on what it
/// actually sent, because a server that says nothing is read anyway.
pub async fn ask(url: &str, most: usize) -> Result<Vec<u8>, String> {
    provider();
    let client = reqwest::Client::builder()
        .timeout(PATIENCE)
        .user_agent(concat!("totex/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|error| format!("no client: {error}"))?;
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|error| format!("{url} did not answer: {error}"))?
        .error_for_status()
        .map_err(|error| format!("{url} answered {error}"))?;
    if response
        .content_length()
        .is_some_and(|len| len > most as u64)
    {
        return Err(format!("{url} is larger than it has any right to be"));
    }
    let bytes = response
        .bytes()
        .await
        .map_err(|error| format!("{url} stopped part way: {error}"))?;
    if bytes.len() > most {
        return Err(format!("{url} is larger than it has any right to be"));
    }
    Ok(bytes.to_vec())
}

/// Which versions the pull-down offers, newest first.
///
/// Asked on a loop by the window rather than by a press, because a list has to
/// be filled before it is opened. Nothing is drawn for a listing that does not
/// answer: an empty answer leaves the window with the versions it already had,
/// and a window that has never had any offers the newest release instead, which
/// is what every press meant before a version could be named at all.
#[tauri::command]
pub async fn update_versions(app: AppHandle) -> Vec<String> {
    let Ok((endpoint, _)) = declared(&app) else {
        return Vec::new();
    };
    let Some(url) = listing_url(&endpoint) else {
        return Vec::new();
    };
    let Ok(listing) = ask(&url, SMALL).await else {
        return Vec::new();
    };
    versions(&listing)
}

#[cfg(test)]
mod tests {
    use super::super::url::is_version;
    use super::*;

    /// The address this app is actually pointed at, from `tauri.conf.json`.
    const ENDPOINT: &str =
        "https://github.com/sasaki-s-sci/totex/releases/latest/download/latest.json";

    /// The one thing about asking a URL that is not about the URL.
    ///
    /// A client is built out of a TLS stack that has to have been told which
    /// ciphers to use, and being told is a thing somebody does to the process
    /// rather than to the client — so the failure is not a failed request, it
    /// is a panic on the way to making one, and a panic inside a command is an
    /// answer the window never receives at all. Nothing here reaches a network:
    /// what is asked for is a port nothing is listening on, and the answer
    /// wanted is that it came back as an error rather than took the process
    /// with it.
    #[test]
    fn a_url_can_be_asked_before_anything_has_been_downloaded() {
        let refused = tauri::async_runtime::block_on(ask("http://127.0.0.1:1/nothing", SMALL));
        assert!(refused.is_err(), "nothing is listening there");
    }

    #[test]
    fn a_version_is_three_numbers() {
        assert!(is_version("0.1.6"));
        assert!(is_version("10.20.30"));
        assert!(!is_version("v0.1.6"));
        assert!(!is_version("0.1"));
        assert!(!is_version("0.1.6.1"));
        assert!(!is_version("../../etc"));
        assert!(!is_version(""));
        // Long enough to be a way of writing something else into an address.
        assert!(!is_version("0.1.99999999999"));
    }

    #[test]
    fn a_named_version_is_the_same_file_under_its_own_tag() {
        assert_eq!(manifest_url(ENDPOINT, None).as_deref(), Some(ENDPOINT));
        assert_eq!(
            manifest_url(ENDPOINT, Some("0.1.2")).as_deref(),
            Some("https://github.com/sasaki-s-sci/totex/releases/download/v0.1.2/latest.json")
        );
        // Nothing that is not a version becomes part of an address.
        assert_eq!(manifest_url(ENDPOINT, Some("0.1.2/../../x")), None);
        // And an endpoint of another shape has no per-version copy to name.
        assert_eq!(
            manifest_url("https://example.invalid/x.json", Some("0.1.2")),
            None
        );
    }

    #[test]
    fn the_listing_is_the_repository_the_endpoint_names() {
        assert_eq!(
            listing_url(ENDPOINT).as_deref(),
            Some("https://api.github.com/repos/sasaki-s-sci/totex/releases?per_page=30")
        );
        assert_eq!(listing_url("https://example.invalid/latest.json"), None);
        assert_eq!(listing_url("https://github.com/onlyowner"), None);
    }

    #[test]
    fn only_released_versions_of_the_app_are_offered() {
        let listing = br#"[
          {"tag_name": "v0.1.6", "draft": false, "prerelease": false},
          {"tag_name": "setup",  "draft": false, "prerelease": true},
          {"tag_name": "v0.1.5", "draft": true,  "prerelease": false},
          {"tag_name": "v0.1.4", "draft": false, "prerelease": true},
          {"tag_name": "nightly","draft": false, "prerelease": false},
          {"tag_name": "v0.1.3", "draft": false, "prerelease": false}
        ]"#;
        assert_eq!(
            versions(listing),
            vec!["0.1.6".to_string(), "0.1.3".to_string()]
        );
    }

    #[test]
    fn a_listing_that_is_not_one_offers_nothing() {
        assert!(versions(b"{\"message\":\"API rate limit exceeded\"}").is_empty());
        assert!(versions(b"not json at all").is_empty());
    }
}
