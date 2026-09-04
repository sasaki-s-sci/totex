//! The release page's own addresses, and the versions it lists.

use serde_json::Value;

use super::BACK;

/// What a release is tagged under, up to the version itself.
pub const TAG: &str = "v";

/// The document every release publishes, which is what says where the
/// downloads are and what they have to be signed with.
pub const MANIFEST: &str = "latest.json";

/// The manifest of one release.
///
/// Every release publishes its own copy under its own tag, so an address is
/// the repository, the tag, and the name of the document. Asked for without a
/// version, it is the address the app is actually configured with: GitHub
/// keeps `releases/latest/download/<name>` pointed at whichever release is
/// newest, and that is the only way to reach a release without having first
/// been told which ones exist.
///
/// Anything that is not a GitHub release address has no per-version copy this
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
    let repository = repository_url(endpoint)?;
    Some(format!(
        "{repository}/releases/download/{TAG}{version}/{MANIFEST}"
    ))
}

/// The repository the app is released out of, read out of the one address it is
/// already pointed at rather than written down again.
fn repository_url(endpoint: &str) -> Option<&str> {
    let (repository, _) = endpoint.split_once("/releases/latest/download/")?;
    Some(repository)
}

/// Where the releases that exist are listed.
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
/// A release of the app is a tag that is [`TAG`] and a version and nothing
/// else. That is what keeps the version-selectable installer's own releases,
/// tagged for the installer rather than for anything the app updates, out of
/// the list — and what kept the tags of the cycles this app used to have out
/// of it, which is why what follows the prefix has to be a version and
/// nothing else.
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
        .filter_map(|tag| tag.strip_prefix(TAG))
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
