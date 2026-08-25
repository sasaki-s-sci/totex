//! The release page as it actually stands, asked the way the app asks it.
//!
//! Ignored by default: every one of these reaches somebody else's server, and a
//! test suite that cannot be run on a train is a test suite nobody runs. What
//! they are for is the question no amount of arithmetic over versions answers —
//! whether the document the app is pointed at today says what this build of the
//! app expects it to say. Run them with
//! `cargo test --manifest-path src-tauri/Cargo.toml -- --ignored --nocapture`.

use super::super::take::{contract, ours, unpack};
use super::TempDir;
use crate::release;
use crate::release::url::{listing_url, versions};

/// The address and the key this build is pointed at, read from the same place
/// the app reads them: `tauri.conf.json`, which the test binary has no app to
/// ask, so the file is read instead.
fn declared() -> (String, String) {
    let text = std::fs::read_to_string("tauri.conf.json").expect("the config beside the crate");
    let read: serde_json::Value = serde_json::from_str(&text).expect("the config is JSON");
    let updater = &read["plugins"]["updater"];
    (
        updater["endpoints"][0]
            .as_str()
            .expect("an endpoint")
            .to_string(),
        updater["pubkey"].as_str().expect("a key").to_string(),
    )
}

#[test]
#[ignore = "reads the release page over the network"]
fn the_newest_release_says_what_this_build_expects_it_to() {
    let (endpoint, _) = declared();
    let manifest = tauri::async_runtime::block_on(release::read(&endpoint, None))
        .expect("the newest release's manifest");
    println!("newest release: {}", manifest.version);
    let front = manifest.front.expect("the newest release carries a front");
    println!("  front needs {} and is at {}", front.needs, front.url);
    println!("  this build answers to contract {}", contract());
}

#[test]
#[ignore = "reads the release page over the network"]
fn every_listed_release_can_be_named() {
    let (endpoint, _) = declared();
    let url = listing_url(&endpoint).expect("the listing of the repository");
    let listing = tauri::async_runtime::block_on(release::ask(&url, release::SMALL))
        .expect("the listing answers");
    let versions = versions(&listing);
    println!("listed: {versions:?}");
    assert!(!versions.is_empty(), "the pull-down would be empty");

    for version in &versions {
        match tauri::async_runtime::block_on(release::read(&endpoint, Some(version))) {
            Ok(manifest) => println!(
                "  v{version}: front {}",
                manifest.front.map_or_else(
                    || "none".to_string(),
                    |front| format!("needs {}", front.needs)
                )
            ),
            Err(error) => println!("  v{version}: {error}"),
        }
    }
}

#[test]
#[ignore = "downloads the front of the newest release"]
fn the_front_of_the_newest_release_is_ours_and_unpacks() {
    let (endpoint, key) = declared();
    let manifest = tauri::async_runtime::block_on(release::read(&endpoint, None))
        .expect("the newest release's manifest");
    let front = manifest.front.expect("the newest release carries a front");
    let version = semver::Version::parse(&manifest.version).expect("a version");

    let tarball = tauri::async_runtime::block_on(release::ask(&front.url, 64 * 1024 * 1024))
        .expect("the front downloads");
    println!("front.tar.gz is {} bytes", tarball.len());
    ours(&tarball, &front.signature, &key).expect("the front is signed with the app's key");

    let temp = TempDir::new("live");
    let unpacked = unpack(temp.path(), &version, front.needs, &tarball).expect("it unpacks");
    println!("unpacked into {}", unpacked.dir.display());
    assert!(unpacked.dir.join("index.html").is_file());
}
