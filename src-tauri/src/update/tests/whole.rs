//! One press, the whole way: a release page, a signed download, and pages the
//! next window is drawn out of.
//!
//! Everything else about updating is checked a piece at a time — the manifest,
//! the signature, the unpacking. This is the one that runs all of it against
//! each other, and it is the one that cannot run on its own: signing is done by
//! the same command the release job signs with, which is the tauri CLI, which
//! is node and a directory of dependencies. So it is asked for by name rather
//! than run with everything else:
//!
//! ```sh
//! cargo test --manifest-path src-tauri/Cargo.toml -p totex -- --ignored whole
//! ```

use std::collections::HashMap;
use std::path::Path;
use std::process::Command;
use std::sync::Arc;

use tauri::ipc::Channel;
use tauri::test::{mock_builder, mock_context, noop_assets};

use crate::release::Cycles;
use crate::update::{Kept, Took};

use super::{Page, TempDir};

/// The root of the checkout, which is where `pnpm` is run from.
fn repository() -> &'static Path {
    // The crate is under it, and cargo says where the crate is.
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("the checkout the crate is in")
}

/// Runs one `pnpm tauri ...`, and says what it said if it would not.
fn tauri_cli(args: &[&str]) -> String {
    let ran = Command::new("pnpm")
        .arg("tauri")
        .args(args)
        .current_dir(repository())
        .output()
        .expect("pnpm is on the path -- see the module docs");
    assert!(
        ran.status.success(),
        "pnpm tauri {}: {}",
        args.join(" "),
        String::from_utf8_lossy(&ran.stderr)
    );
    String::from_utf8_lossy(&ran.stdout).into_owned()
}

/// A front as the release job packs one: the contents of `dist`, at the root.
fn pages() -> Vec<u8> {
    let mut builder = tar::Builder::new(flate2::write::GzEncoder::new(
        Vec::new(),
        flate2::Compression::fast(),
    ));
    for (name, body) in [
        ("./index.html", &b"<!doctype html><title>taken</title>"[..]),
        ("./assets/app.js", &b"nothing"[..]),
    ] {
        let mut header = tar::Header::new_gnu();
        header.set_size(body.len() as u64);
        header.set_mode(0o644);
        builder
            .append_data(&mut header, name, body)
            .expect("pack a file");
    }
    builder
        .into_inner()
        .expect("finish the archive")
        .finish()
        .expect("finish the compression")
}

#[test]
#[ignore = "signs with the tauri CLI, which is node and its dependencies"]
fn a_press_downloads_the_pages_and_the_next_window_is_drawn_out_of_them() {
    let temp = TempDir::new("pages");

    // A key of this test's own, made by the command the release job's key was
    // made by. Nothing here goes near the app's own key: what is being checked
    // is that a copy takes what is signed with the key it was built with.
    let key = temp.path().join("key");
    tauri_cli(&[
        "signer",
        "generate",
        "-w",
        &key.to_string_lossy(),
        "--password",
        "",
        "--force",
    ]);
    let public = std::fs::read_to_string(temp.path().join("key.pub")).expect("the public half");

    let tarball = temp.path().join("front.tar.gz");
    std::fs::write(&tarball, pages()).expect("pack the pages");
    tauri_cli(&[
        "signer",
        "sign",
        "-f",
        &key.to_string_lossy(),
        "-p",
        "",
        &tarball.to_string_lossy(),
    ]);
    let signature = std::fs::read_to_string(format!("{}.sig", tarball.display()))
        .expect("the signature beside it");

    let mut held = HashMap::new();
    held.insert(
        "/front.tar.gz".to_string(),
        std::fs::read(&tarball).expect("the packed pages"),
    );
    let page = Page::holding(held);
    page.says(serde_json::json!({
        "version": "9.9.9",
        "front": {
            // What this build of the program answers to, so the pages and the
            // program agree -- see `contract` in front/take.rs.
            "needs": crate::front::take::contract(),
            "url": page.url("/front.tar.gz"),
            "signature": signature.trim(),
        }
    }));

    let mut context = mock_context(noop_assets());
    context.config_mut().plugins.0.insert(
        "updater".to_string(),
        serde_json::json!({ "endpoints": [page.endpoint()], "pubkey": public.trim() }),
    );
    let serving = Arc::new(crate::front::Serving::keeping(
        Some(temp.path().join("front")),
        "0.1.0".parse().expect("a version"),
    ));
    let app = mock_builder()
        .manage(Arc::clone(&serving))
        .manage(Arc::new(Kept::at(Some(temp.path().join("update.json")))))
        .build(context)
        .expect("an app pointed at the page this test is holding");

    let coming = Channel::new(|_| Ok(()));
    let took = tauri::async_runtime::block_on(crate::front::take::take_front(
        app.handle(),
        &Cycles::Release.cycle(),
        None,
        &coming,
    ))
    .expect("the press");
    assert_eq!(took, Took::Taken);

    // The window on the screen is still the one that was there; what has moved
    // is what the next one will be drawn out of.
    assert_eq!(serving.version().to_string(), "9.9.9");
    let drawn = temp.path().join("front").join("9.9.9").join("index.html");
    assert!(drawn.is_file(), "{} was not unpacked", drawn.display());
    assert_eq!(
        std::fs::read(&drawn).expect("the page"),
        b"<!doctype html><title>taken</title>"
    );
}
