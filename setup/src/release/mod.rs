//! What a release page says, and whether to believe it.
//!
//! Nothing here names a version. Which one this installs is decided by the
//! manifest it reads, exactly as it is in scripts/install.sh and
//! scripts/install.ps1 -- the same file, under the same two unchanging
//! addresses, checked against the same key. An install is the first update,
//! and what the app would refuse to update itself with is what this refuses to
//! put on the machine.

use minisign_verify::{PublicKey, Signature};
use serde_json::Value;

/// Where releases come from. One repository, so this is written rather than
/// asked for.
const REPO: &str = "sasaki-s-sci/totex";

/// The key every release is signed with, verbatim from `plugins > updater >
/// pubkey` in src-tauri/tauri.conf.json -- the build refuses a tree where the
/// copies of it have stopped being the same string. It is the app's own key on
/// purpose: a download this accepts is one the installed app would accept too.
const PUBLIC_KEY: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IEE1Mzg0NDdDQzMyRjc5RjIKUldUeWVTL0RmRVE0cFNIcTBWL3FCbDV3MzZRVm95ZjZUdWZWazdVWEJVNGppRGdoNkNLanE1eDgK";

/// Which machine's downloads this asks for.
///
/// The kind of machine rather than the kind of installed copy, which is what
/// `programs` is keyed by -- see scripts/update-manifest.mjs. There is one of
/// these because this program is one of these: a Windows installer, built for
/// the one architecture the app is built for.
const TARGET: &str = "windows-x86_64";

/// The kind of copy the per-version installer makes, for the releases that
/// carry no program of their own -- see [`Release::Installer`].
const NSIS: &str = "windows-x86_64-nsis";

/// How much a manifest is allowed to weigh. It is four platforms and a date.
pub const MANIFEST_MOST: usize = 256 * 1024;

/// How much a listing of releases is allowed to weigh.
pub const LISTING_MOST: usize = 4 * 1024 * 1024;

/// How much a download is allowed to weigh.
pub const DOWNLOAD_MOST: usize = 512 * 1024 * 1024;

/// What a release offers this machine, which is one of two things.
///
/// The whole point of the difference is that only one of them is still being
/// published. A release cut since this installer learned to install has its
/// program beside its installers, and that is what goes on the machine. A
/// release cut before it has only its own installer, and the only way onto the
/// machine is to run it -- which is what this used to do for every version and
/// now does for none that could be done otherwise.
#[derive(Debug, PartialEq, Eq)]
pub enum Release {
    /// The program of this release, to be installed by us.
    Program,
    /// This release's own installer, to be run.
    Installer,
}

/// One download, named by a manifest.
#[derive(Debug)]
pub struct Bundle {
    pub version: String,
    pub url: String,
    pub signature: String,
    /// What was found, which decides what is done with it.
    pub what: Release,
}

impl Bundle {
    /// What to call the file on the way to disk, for the one kind that is
    /// written under a name of its own: an installer that is about to be run.
    ///
    /// The end of the address it came from, which is a name the release page
    /// chose rather than one made up here -- and never a path, because a
    /// manifest is not trusted to name where on the machine anything goes. The
    /// program needs none of this: it goes in under the one name the app is
    /// installed as, whatever the release page calls it.
    pub fn file_name(&self) -> String {
        let last = self.url.rsplit('/').next().unwrap_or_default();
        let plain = last
            .chars()
            .filter(|letter| letter.is_ascii_alphanumeric() || matches!(letter, '.' | '-' | '_'))
            .collect::<String>();
        if plain.is_empty() {
            "totex-installer.exe".to_string()
        } else {
            plain
        }
    }
}

/// The manifest to read. Every release carries one under a fixed name, which
/// is what makes both of these a single unchanging address: the newest release
/// always answers the first, and a release that has already happened always
/// answers the second with what it shipped, whatever has been released since.
pub fn manifest_url(version: Option<&str>) -> String {
    match version {
        Some(version) => {
            format!("https://github.com/{REPO}/releases/download/v{version}/latest.json")
        }
        None => format!("https://github.com/{REPO}/releases/latest/download/latest.json"),
    }
}

/// Where the releases that exist are listed. Only so the window can offer them
/// -- a version can be typed in whether this answers or not, and a rate limit
/// on an address anybody can read is a thing to carry on without.
pub fn listing_url() -> String {
    format!("https://api.github.com/repos/{REPO}/releases?per_page=30")
}

/// What a manifest says this machine should download.
///
/// `asked` is checked against what the release under that tag says about
/// itself: a tag whose manifest names another version is a release page
/// somebody has been at, and installing what it offers anyway would make
/// asking for a version by name mean nothing.
///
/// The program is preferred over the installer wherever a release carries one,
/// which is every release cut since it started carrying one. See [`Release`].
pub fn bundle(manifest: &[u8], asked: Option<&str>) -> Result<Bundle, String> {
    let manifest: Value = serde_json::from_slice(manifest)
        .map_err(|_| "the release page answered with something that is not a manifest")?;
    let released = manifest["version"]
        .as_str()
        .ok_or("the release manifest says nothing about a version")?;
    if let Some(asked) = asked
        && asked != released
    {
        return Err(format!(
            "v{asked} was asked for and the release under that tag says {released}"
        ));
    }

    let found = [
        (Release::Program, &manifest["programs"][TARGET]),
        (Release::Installer, &manifest["platforms"][NSIS]),
    ]
    .into_iter()
    .find_map(|(what, entry)| {
        let url = entry["url"].as_str()?;
        let signature = entry["signature"].as_str()?;
        Some(Bundle {
            version: released.to_string(),
            url: url.to_string(),
            signature: signature.to_string(),
            what,
        })
    });

    found.ok_or_else(|| format!("totex {released} has nothing signed for {TARGET}"))
}

/// The versions there are to install, newest first.
///
/// Anything that is not a released `vX.Y.Z` is left out, which is what keeps
/// this installer's own releases -- tagged for the installer rather than for
/// the app -- from being offered as versions of the app.
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

/// Whether a string is the three numbers a release is tagged under. A version
/// is put into an address, so what it may hold is worth being exact about.
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

/// Whether this is the download the release page named, signed with our key.
///
/// The signature travels as base64 around the whole of a minisign document,
/// which is the shape the updater's own manifest carries and the shape
/// `tauri signer` writes. What is checked is the file's contents, so it is
/// checked here on the bytes as they arrived rather than on anything already
/// written to disk under a name something else could have got at.
pub fn ours(bundle: &[u8], signature: &str) -> Result<(), String> {
    let text = |encoded: &str, what: &str| {
        base64(encoded)
            .and_then(|bytes| String::from_utf8(bytes).ok())
            .ok_or_else(|| format!("the {what} is not what a {what} looks like"))
    };
    let key = PublicKey::decode(&text(PUBLIC_KEY, "key")?)
        .map_err(|error| format!("the key will not decode: {error}"))?;
    let signature = Signature::decode(&text(signature, "signature")?)
        .map_err(|error| format!("the signature will not decode: {error}"))?;
    key.verify(bundle, &signature, true)
        .map_err(|_| "this download is not signed with the key totex is released with".to_string())
}

/// Standard base64, decoded. Both strings this is given are written by the
/// same signer the app reads them from, and neither is long enough to be
/// worth a crate that also encodes.
fn base64(text: &str) -> Option<Vec<u8>> {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut bytes = Vec::with_capacity(text.len() / 4 * 3);
    let mut held: u32 = 0;
    let mut bits = 0u32;
    for letter in text.bytes() {
        if letter == b'=' || letter.is_ascii_whitespace() {
            continue;
        }
        let value = ALPHABET.iter().position(|&known| known == letter)? as u32;
        held = (held << 6) | value;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            bytes.push((held >> bits) as u8);
        }
    }
    // What is left over is the padding's worth of zero bits and nothing else;
    // anything set in it is a string that was cut off part way through.
    (held & ((1 << bits) - 1) == 0).then_some(bytes)
}

#[cfg(test)]
mod tests;
