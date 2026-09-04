//! A press against the release page as it actually stands.
//!
//! Ignored, like every other check that reaches somebody else's server. What it
//! is for is the one question nothing local can answer: whether what the
//! release job publishes today is what this build of the app expects to find,
//! down to the key it is signed with. Run it with
//! `cargo test --manifest-path src-tauri/Cargo.toml -p totex -- --ignored live`.

use std::sync::Arc;

use tauri::ipc::Channel;
use tauri::test::{mock_builder, mock_context, noop_assets};

use crate::release::{self, Cycles};
use crate::update::{Kept, Took};

use super::TempDir;

/// The address and the key this build is pointed at, read out of the file the
/// app is configured by.
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
#[ignore = "downloads the newest released pages"]
fn the_newest_released_front_of_every_cycle_is_taken() {
    let (endpoint, _) = declared();
    let listing = release::url::listing_url(&endpoint).expect("the listing");
    let listing = tauri::async_runtime::block_on(release::fetch::ask(&listing, release::SMALL))
        .expect("the listing answers");

    for which in [Cycles::Release, Cycles::Front] {
        let cycle = which.cycle();
        let versions = release::url::versions(&listing, &cycle);
        println!("{}*: {versions:?}", cycle.tag);
        match versions.first() {
            None => println!("  nothing has been released on that cycle yet"),
            Some(newest) => drawn(&cycle, newest),
        }
    }
}

/// One press on the pages row, against the release page as it stands.
fn drawn(cycle: &release::Cycle, newest: &str) {
    let (endpoint, key) = declared();
    let temp = TempDir::new("live-front");
    let mut context = mock_context(noop_assets());
    context.config_mut().plugins.0.insert(
        "updater".to_string(),
        serde_json::json!({ "endpoints": [endpoint], "pubkey": key }),
    );
    // Older pages than the release has, so that there is something to do about
    // it. Every other thing the press does is the real one.
    let serving = Arc::new(crate::front::Serving::keeping(
        Some(temp.path().to_path_buf()),
        "0.0.1".parse().expect("a version"),
    ));
    let app = mock_builder()
        .manage(Arc::clone(&serving))
        .manage(Arc::new(Kept::at(None)))
        .build(context)
        .expect("an app pointed at the release page");

    let coming = Channel::new(|_| Ok(()));
    let took = tauri::async_runtime::block_on(crate::front::take::take_front(
        app.handle(),
        cycle,
        Some(newest),
        &coming,
    ))
    .expect("the press");
    println!("  taking {}{newest}: {took:?}", cycle.tag);
    assert_eq!(took, Took::Taken);

    // What the next window would be drawn out of.
    assert_eq!(serving.version().to_string(), *newest);
    let page = temp.path().join(newest).join("index.html");
    assert!(page.is_file(), "{} was not unpacked", page.display());
    println!(
        "  and the page it opens on is {} bytes",
        std::fs::metadata(&page).expect("the page").len()
    );
}
