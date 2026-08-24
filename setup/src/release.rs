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

/// How much a manifest is allowed to weigh. It is four platforms and a date.
pub const MANIFEST_MOST: usize = 256 * 1024;

/// How much a listing of releases is allowed to weigh.
pub const LISTING_MOST: usize = 4 * 1024 * 1024;

/// How much an installer is allowed to weigh.
pub const BUNDLE_MOST: usize = 512 * 1024 * 1024;

/// Which of the two Windows installers to take.
///
/// They differ in who they install for rather than in what they install: the
/// `.exe` puts the app under the account running it and asks nobody for
/// anything, and the `.msi` puts it on the machine for every account and wants
/// an administrator to say so.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    Exe,
    Msi,
}

impl Kind {
    /// The name the manifest files this kind of copy under. These are the
    /// updater's names for what is being replaced, not the platform's, which
    /// is why both Windows entries say which installer made the copy.
    fn target(self) -> &'static str {
        match self {
            Kind::Exe => "windows-x86_64-nsis",
            Kind::Msi => "windows-x86_64-msi",
        }
    }
}

/// One download, named by a manifest.
#[derive(Debug)]
pub struct Bundle {
    pub version: String,
    pub url: String,
    pub signature: String,
}

impl Bundle {
    /// What to call the file on the way to disk. The end of the address it
    /// came from, which is a name the release page chose rather than one made
    /// up here -- and never a path, because a manifest is not trusted to name
    /// where on the machine anything goes.
    pub fn file_name(&self) -> String {
        let last = self.url.rsplit('/').next().unwrap_or_default();
        let plain = last
            .chars()
            .filter(|letter| letter.is_ascii_alphanumeric() || matches!(letter, '.' | '-' | '_'))
            .collect::<String>();
        if plain.is_empty() {
            "totex-installer".to_string()
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
pub fn bundle(manifest: &[u8], asked: Option<&str>, kind: Kind) -> Result<Bundle, String> {
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

    let entry = &manifest["platforms"][kind.target()];
    let url = entry["url"]
        .as_str()
        .ok_or_else(|| format!("totex {released} has nothing for {}", kind.target()))?;
    let signature = entry["signature"]
        .as_str()
        .ok_or_else(|| format!("totex {released} is not signed for {}", kind.target()))?;

    Ok(Bundle {
        version: released.to_string(),
        url: url.to_string(),
        signature: signature.to_string(),
    })
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

/// Whether this is the installer the release page named, signed with our key.
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
mod tests {
    use super::*;

    /// A release manifest with the one entry a Windows machine reads.
    const MANIFEST: &str = r#"{
      "version": "0.1.6",
      "pub_date": "2026-08-24T00:00:00.000Z",
      "platforms": {
        "windows-x86_64-nsis": {
          "signature": "c2lnbmF0dXJl",
          "url": "https://github.com/sasaki-s-sci/totex/releases/download/v0.1.6/totex-windows-x86_64-setup.exe"
        }
      }
    }"#;

    #[test]
    fn a_version_is_three_numbers() {
        assert!(is_version("0.1.6"));
        assert!(is_version("10.20.30"));
        assert!(!is_version("v0.1.6"));
        assert!(!is_version("0.1"));
        assert!(!is_version("0.1.6.1"));
        assert!(!is_version("0.1.x"));
        assert!(!is_version("0..1"));
        assert!(!is_version(""));
        // Long enough to be a way of writing something else into an address.
        assert!(!is_version("0.1.99999999999"));
    }

    #[test]
    fn the_newest_release_is_a_different_address_from_a_named_one() {
        assert!(manifest_url(None).ends_with("/releases/latest/download/latest.json"));
        assert!(manifest_url(Some("0.1.2")).ends_with("/releases/download/v0.1.2/latest.json"));
    }

    #[test]
    fn a_manifest_names_what_to_download() {
        let bundle = bundle(MANIFEST.as_bytes(), None, Kind::Exe).unwrap();
        assert_eq!(bundle.version, "0.1.6");
        assert_eq!(bundle.file_name(), "totex-windows-x86_64-setup.exe");
    }

    #[test]
    fn a_tag_that_says_another_version_is_turned_down() {
        // The whole worth of asking for a version by name: a release page that
        // answers with something else is one to stop at.
        let complaint = bundle(MANIFEST.as_bytes(), Some("0.1.5"), Kind::Exe).unwrap_err();
        assert!(complaint.contains("0.1.5"), "{complaint}");
        assert!(complaint.contains("0.1.6"), "{complaint}");
    }

    #[test]
    fn a_release_with_nothing_for_this_machine_says_so() {
        let complaint = bundle(MANIFEST.as_bytes(), None, Kind::Msi).unwrap_err();
        assert!(complaint.contains("windows-x86_64-msi"), "{complaint}");
    }

    #[test]
    fn nothing_a_manifest_says_becomes_a_path() {
        let sideways = Bundle {
            version: "0.1.6".to_string(),
            url: "https://example.invalid/..\\..\\Startup\\totex.exe".to_string(),
            signature: String::new(),
        };
        let name = sideways.file_name();
        assert!(!name.contains(['/', '\\']), "{name}");
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

    #[test]
    fn base64_reads_what_the_manifest_carries() {
        assert_eq!(base64("dG90ZXg=").unwrap(), b"totex");
        assert_eq!(base64("dG90ZXhz").unwrap(), b"totexs");
        assert_eq!(base64("").unwrap(), b"");
        assert!(base64("not base64!").is_none());
    }

    #[test]
    fn a_signature_that_is_not_one_is_not_trusted() {
        assert!(ours(b"anything at all", "bm90IGEgc2lnbmF0dXJl").is_err());
        assert!(ours(b"anything at all", "!!!").is_err());
        assert!(ours(b"anything at all", "").is_err());
    }
}
