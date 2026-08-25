//! What the release page says, and whether it was signed by us.

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
