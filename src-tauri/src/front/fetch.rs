//! Asking a URL for the bytes of a front, and unpacking what comes back.

use std::fs;
use std::path::Path;
use std::time::Duration;

use base64::Engine;
use base64::engine::general_purpose::STANDARD as BASE64;
use minisign_verify::{PublicKey, Signature};
use semver::Version;

use super::Unpacked;

/// How long a URL is given to answer, and to hand over a front.
const PATIENCE: Duration = Duration::from_secs(30);

/// The most of a front that will be read off the network. The pages of this app
/// are around a megabyte; this is what stops a URL that answers forever from
/// filling memory before a signature has been checked.
const MOST: usize = 64 * 1024 * 1024;

/// Reads a URL into memory, or says why it could not.
pub(super) async fn ask(url: &str) -> Result<Vec<u8>, String> {
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
    // What the server says it is about to send, before it sends any of it. A
    // server that says nothing is read anyway and stopped by the same limit.
    if response
        .content_length()
        .is_some_and(|len| len > MOST as u64)
    {
        return Err(format!("{url} is larger than a front has any right to be"));
    }
    let bytes = response
        .bytes()
        .await
        .map_err(|error| format!("{url} stopped part way: {error}"))?;
    if bytes.len() > MOST {
        return Err(format!("{url} is larger than a front has any right to be"));
    }
    Ok(bytes.to_vec())
}

/// Whether this is the front the release page named, signed with our key.
///
/// The two strings are base64 around the two halves of a minisign pair, which
/// is the shape the updater plugin's own manifest carries and the shape
/// `tauri signer` writes — the front is signed by the same command, with the
/// same key, in the same job as the installers beside it.
pub(super) fn ours(tarball: &[u8], signature: &str, key: &str) -> Result<(), String> {
    let text = |encoded: &str, what: &str| {
        BASE64
            .decode(encoded)
            .ok()
            .and_then(|bytes| String::from_utf8(bytes).ok())
            .ok_or_else(|| format!("the {what} is not what a {what} looks like"))
    };
    let key = PublicKey::decode(&text(key, "key")?)
        .map_err(|error| format!("the key will not decode: {error}"))?;
    let signature = Signature::decode(&text(signature, "signature")?)
        .map_err(|error| format!("the signature will not decode: {error}"))?;
    key.verify(tarball, &signature, true)
        .map_err(|_| "this front is not signed with the app's key".to_string())
}

/// Lays the front out on disk, under the name of the release it came from.
///
/// Unpacked beside where it is going and moved into place in one step, so that
/// what the name of a version points at is either the whole of that front or
/// nothing — a half-written directory under a version number is one a later
/// start would open on and be unable to draw.
pub(super) fn unpack(home: &Path, version: &Version, tarball: &[u8]) -> Result<Unpacked, String> {
    let dir = home.join(version.to_string());
    let taking = home.join(format!("{version}.taking"));
    fs::create_dir_all(home).map_err(|error| format!("{}: {error}", home.display()))?;
    let _ = fs::remove_dir_all(&taking);

    let mut archive = tar::Archive::new(flate2::read::GzDecoder::new(tarball));
    // These pages are read back by this app and by nothing else, so the modes
    // and the times the archive carries are not wanted. What is wanted is that
    // nothing in it lands outside the directory, and that is what `unpack`
    // already holds to: an entry naming its way out is skipped, not followed.
    archive.set_preserve_permissions(false);
    archive.set_preserve_mtime(false);
    archive
        .unpack(&taking)
        .map_err(|error| format!("the front would not unpack: {error}"))?;

    // The one file every front has, and the one a window asks for first.
    if !taking.join("index.html").is_file() {
        let _ = fs::remove_dir_all(&taking);
        return Err("the front arrived without a page in it".to_string());
    }

    let _ = fs::remove_dir_all(&dir);
    fs::rename(&taking, &dir).map_err(|error| format!("{}: {error}", dir.display()))?;
    Ok(Unpacked {
        dir,
        version: version.clone(),
    })
}
