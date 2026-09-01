//! The release page's own addresses, and the versions it lists.

use serde_json::Value;

use super::BACK;
use super::cycle::Cycle;

/// The manifest of one release of one cycle.
///
/// Every cycle publishes its own document under its own tag, so an address is
/// the repository, the tag the cycle names a version under, and the name of the
/// document. The one exception is the address the app is actually configured
/// with: GitHub keeps `releases/latest/download/<name>` pointed at whichever
/// release is newest, and that is the only way to reach a release without
/// having first been told which ones exist — so the cycle the app is released
/// on is allowed to be asked for without naming a version, and the others are
/// not. See [`Cycle::rides_the_newest`].
///
/// Anything that is not a GitHub release address has no per-version copy this
/// knows how to reach, and says so rather than guessing at one.
pub fn manifest_url(endpoint: &str, cycle: &Cycle, version: Option<&str>) -> Option<String> {
    let Some(version) = version else {
        return cycle.rides_the_newest().then(|| endpoint.to_string());
    };
    // A version goes into an address, so what it may hold is worth being exact
    // about: this is the only thing between the pull-down and a URL.
    if !is_version(version) {
        return None;
    }
    let repository = repository_url(endpoint)?;
    Some(format!(
        "{repository}/releases/download/{}{version}/{}",
        cycle.tag, cycle.manifest
    ))
}

/// The repository the app is released out of, read out of the one address it is
/// already pointed at rather than written down again.
fn repository_url(endpoint: &str) -> Option<&str> {
    let (repository, _) = endpoint.split_once("/releases/latest/download/")?;
    Some(repository)
}

/// Where the releases that exist are listed.
///
/// One listing serves every cycle: they are tags on the same repository, and
/// which of them belongs to which cycle is the prefix on the tag — see
/// [`versions`].
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

/// The versions of one cycle there are to take, newest first.
///
/// A tag belongs to the cycle whose prefix it carries and to no other, which is
/// what keeps three cycles on one repository apart — and what keeps the
/// version-selectable installer's own releases, tagged for the installer rather
/// than for anything the app updates, out of every one of them.
///
/// The tag of a cycle whose prefix is a prefix of another's would be read as
/// both. That cannot happen with the cycles that exist -- `v` and `layer-v`
/// have no version in common, because `0.1.10` is not what follows `layer-v` in
/// `layer-v0.1.10` -- and it is why what is left after the prefix has to be a
/// version and nothing else.
pub fn versions(listing: &[u8], cycle: &Cycle) -> Vec<String> {
    let Ok(Value::Array(releases)) = serde_json::from_slice::<Value>(listing) else {
        return Vec::new();
    };
    releases
        .iter()
        .filter(|release| {
            release["draft"] != Value::Bool(true) && release["prerelease"] != Value::Bool(true)
        })
        .filter_map(|release| release["tag_name"].as_str())
        .filter_map(|tag| tag.strip_prefix(cycle.tag))
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
