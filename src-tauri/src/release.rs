//! Where the releases are, and what each of them says about itself.
//!
//! One document decides both halves. Every release carries a `latest.json`: the
//! updater plugin reads it for the installer that replaces the program, and
//! [`crate::front`] reads it for the pages that can be taken without one. What
//! a release is, is one fact, and two files saying it are two files that can
//! disagree — so there is one file, and this is the reading of it.
//!
//! ## Naming a version
//!
//! The app is pointed at one address and it is the newest release's copy of
//! that document: GitHub keeps `releases/latest/download/<name>` aimed at
//! whatever the newest release is. Every release also carries the same file
//! under its own tag, at an address that stops moving the moment it is cut. So
//! naming a version is the same address with the moving part taken out of it,
//! and nothing has to be configured twice for it.
//!
//! A release page is not trusted to say which release it is. A manifest under
//! `v0.1.6` that says 0.1.7 is a page somebody has been at, and taking what it
//! offers anyway would make naming a version mean nothing — so the two are
//! compared, which is the same check `setup/src/release.rs` makes for the same
//! reason.
//!
//! That file is the standalone Windows installer's half of all this, and the
//! resemblance is deliberate rather than shared code: it is a crate of its own,
//! released on a cycle of its own, and it has to install a version of the app
//! onto a machine that has none. What is common to the two is what a release
//! page is, which is a shape neither of them owns.
//!
//! ## And which versions there are to name
//!
//! A manifest says what one release is; it does not say which releases exist.
//! That is the repository's own listing, and it is the one thing here that is
//! read without anybody having pressed anything — see [`update_versions`], which
//! is asked on a slow loop so that the list of versions is filled before it is
//! opened rather than after. It is therefore also the one thing allowed to fail
//! in silence: a rate limit on an address anybody can read leaves the list as it
//! was, and every press still works with no list at all.

use std::time::Duration;

use serde::Deserialize;
use serde_json::Value;
use tauri::{AppHandle, Runtime};

/// How long the release page is given to answer, and to hand over a front.
pub const PATIENCE: Duration = Duration::from_secs(30);

/// The most a manifest or a listing is allowed to weigh.
///
/// One is four platforms and a date; the other is thirty releases and what
/// GitHub says about each of them. Neither is a size to be reached — this is
/// what stops a URL that answers forever from filling memory, which is the one
/// thing an unbounded read of somebody else's server can be made to do.
pub const SMALL: usize = 4 * 1024 * 1024;

/// How many releases back the listing is asked for.
///
/// Enough that the versions worth going back to are all in it, and few enough
/// to be one page: what is wanted is a pull-down somebody can read, not the
/// whole history of the repository.
const BACK: usize = 30;

/// As much of the release manifest as anything here reads.
///
/// The same document the updater plugin reads, from the same URL. The plugin
/// ignores a key that is not part of its own shape, and everything here ignores
/// `platforms`, which is the plugin's half of it.
#[derive(Deserialize)]
pub struct Manifest {
    pub version: String,
    pub front: Option<Entry>,
}

/// Where the pages of a release are, and what they need to run against.
#[derive(Deserialize)]
pub struct Entry {
    /// The oldest agreement between the pages and the program that these pages
    /// will work against — `frontContract` in `package.json`, which is the one
    /// place the number is written and the number both halves are built with.
    pub needs: u32,
    pub url: String,
    pub signature: String,
}

/// The URL a new version is named at and the key it has to be signed with,
/// both read out of the updater's own configuration.
///
/// Not a second copy of either. The whole worth of the key is that there is one
/// of them: the app already declares it once for the plugin, and the build
/// refuses a tree where the two install scripts do not carry the same string.
/// A front signed with anything else is a front from somebody else.
pub fn declared<R: Runtime>(app: &AppHandle<R>) -> Result<(String, String), String> {
    let updater = app
        .config()
        .plugins
        .0
        .get("updater")
        .ok_or_else(|| "this build has no updater configured".to_string())?;
    let endpoint = updater["endpoints"][0]
        .as_str()
        .ok_or_else(|| "the updater names no endpoint".to_string())?;
    let key = updater["pubkey"]
        .as_str()
        .ok_or_else(|| "the updater carries no key".to_string())?;
    Ok((endpoint.to_string(), key.to_string()))
}

/// The manifest of one release, or of whichever is newest when none is named.
///
/// The endpoint is the newest release's copy under the address GitHub keeps
/// pointed at it; a named version is the same file under that release's own
/// tag. Anything that is not that shape of address has no per-version copy this
/// knows how to reach, and says so rather than guessing at one.
pub fn manifest_url(endpoint: &str, version: Option<&str>) -> Option<String> {
    let Some(version) = version else {
        return Some(endpoint.to_string());
    };
    // A version goes into an address, so what it may hold is worth being exact
    // about: this is the only thing between the pull-down and a URL.
    if !is_version(version) {
        return None;
    }
    let (repository, name) = endpoint.split_once("/releases/latest/download/")?;
    Some(format!("{repository}/releases/download/v{version}/{name}"))
}

/// Where the releases that exist are listed.
///
/// Read out of the endpoint rather than written again: the repository releases
/// are cut from is the repository the app updates itself out of, and the one
/// address it is already pointed at names it.
pub fn listing_url(endpoint: &str) -> Option<String> {
    let rest = endpoint.strip_prefix("https://github.com/")?;
    let (owner, rest) = rest.split_once('/')?;
    let (repository, _) = rest.split_once('/')?;
    if owner.is_empty() || repository.is_empty() {
        return None;
    }
    Some(format!(
        "https://api.github.com/repos/{owner}/{repository}/releases?per_page={BACK}"
    ))
}

/// The versions there are to take, newest first.
///
/// Anything that is not a released `vX.Y.Z` is left out, which is what keeps
/// the standalone installer's own releases — tagged for the installer rather
/// than for the app — from being offered as versions of the app.
pub fn versions(listing: &[u8]) -> Vec<String> {
    let Ok(Value::Array(releases)) = serde_json::from_slice::<Value>(listing) else {
        return Vec::new();
    };
    releases
        .iter()
        .filter(|release| {
            release["draft"] != Value::Bool(true) && release["prerelease"] != Value::Bool(true)
        })
        .filter_map(|release| release["tag_name"].as_str())
        .filter_map(|tag| tag.strip_prefix('v'))
        .filter(|tag| is_version(tag))
        .map(str::to_string)
        .collect()
}

/// Whether a string is the three numbers a release is tagged under.
pub fn is_version(text: &str) -> bool {
    let mut parts = text.split('.');
    let three = [parts.next(), parts.next(), parts.next()];
    parts.next().is_none()
        && three.iter().all(|part| {
            part.is_some_and(|part| {
                !part.is_empty()
                    && part.len() < 10
                    && part.bytes().all(|byte| byte.is_ascii_digit())
            })
        })
}

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
