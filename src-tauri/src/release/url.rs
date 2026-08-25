//! The release page's own addresses, and the versions it lists.

use serde_json::Value;

use super::BACK;

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
