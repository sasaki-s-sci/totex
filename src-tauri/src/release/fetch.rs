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

/// Reads a URL into memory, or says why it could not.
///
/// `most` is what the thing being read has no right to be bigger than. Held to
/// twice: once on what the server says it is about to send, and once on what it
/// actually sent, because a server that says nothing is read anyway.
pub async fn ask(url: &str, most: usize) -> Result<Vec<u8>, String> {
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
