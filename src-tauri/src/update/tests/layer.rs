//! Taking the application layer, against a release page this test is holding.

use std::collections::HashMap;

use tauri::ipc::Channel;

use crate::app_layer::Layers;
use crate::release::{Cycles, target};
use crate::update::Took;
use crate::update::layer::take_layer;

use super::{Page, TempDir, app};

/// A release page holding one manifest, and whatever else is named in it.
fn holding(manifest: serde_json::Value, files: &[(&str, &[u8])]) -> Page {
    let mut held = HashMap::new();
    held.insert(
        "/releases/latest/download/latest.json".to_string(),
        serde_json::to_vec(&manifest).expect("a manifest is JSON"),
    );
    for (path, body) in files {
        held.insert((*path).to_string(), body.to_vec());
    }
    Page::holding(held)
}

/// What a press is answered with, with nothing listening to the download.
fn press(
    app: &tauri::App<tauri::test::MockRuntime>,
    version: Option<&str>,
) -> Result<Took, String> {
    let coming = Channel::new(|_| Ok(()));
    tauri::async_runtime::block_on(take_layer(
        app.handle(),
        &Cycles::Release.cycle(),
        version,
        &coming,
    ))
}

#[test]
fn a_release_whose_layer_speaks_another_language_is_not_downloaded() {
    let temp = TempDir::new("protocol");
    let page = holding(
        serde_json::json!({
            "version": "9.9.9",
            "layers": {
                target(): {
                    // A layer built against a conversation this program does
                    // not have. Said in the manifest, so it is known before
                    // anything has been downloaded.
                    "protocol": totex_layer::PROTOCOL + 1,
                    "url": "http://127.0.0.1:1/never-asked-for",
                    "signature": "",
                }
            }
        }),
        &[],
    );
    let app = app(page.endpoint(), temp.path());
    assert_eq!(press(&app, None), Ok(Took::Held));
}

#[test]
fn a_release_with_no_layer_for_this_machine_is_the_programs_to_bring() {
    let temp = TempDir::new("elsewhere");
    let page = holding(
        serde_json::json!({
            "version": "9.9.9",
            "layers": {
                "commodore-6502": {
                    "protocol": totex_layer::PROTOCOL,
                    "url": "http://127.0.0.1:1/never-asked-for",
                    "signature": "",
                }
            }
        }),
        &[],
    );
    let app = app(page.endpoint(), temp.path());
    assert_eq!(press(&app, None), Ok(Took::Held));
}

#[test]
fn the_layer_that_is_already_answering_is_nothing_to_do() {
    let temp = TempDir::new("current");
    let page = holding(
        serde_json::json!({ "version": totex_layer::VERSION, "layers": {} }),
        &[],
    );
    let app = app(page.endpoint(), temp.path());
    assert_eq!(press(&app, None), Ok(Took::Current));
}

#[test]
fn a_layer_that_is_not_signed_with_the_apps_key_is_not_put_anywhere() {
    let temp = TempDir::new("unsigned");
    // The page has to be up before the manifest can say where the file on it
    // is, so it is put up holding the file and then told what to say about it.
    let mut held = HashMap::new();
    held.insert("/layer.gz".to_string(), b"not a layer either".to_vec());
    let page = Page::holding(held);
    let page = holding(
        serde_json::json!({
            "version": "9.9.9",
            "layers": {
                target(): {
                    "protocol": totex_layer::PROTOCOL,
                    "url": page.url("/layer.gz"),
                    "signature": "not a signature",
                }
            }
        }),
        &[("/layer.gz", b"not a layer either")],
    );
    let app = app(page.endpoint(), temp.path());

    let refused = press(&app, None).expect_err("nothing signed with our key");
    assert!(
        refused.contains("signature") || refused.contains("key"),
        "{refused}"
    );
    assert!(
        !temp.path().join("layer").join("9.9.9").exists(),
        "and nothing was put under a version number"
    );
}

#[test]
fn a_program_that_is_not_a_layer_is_not_the_one_the_next_start_opens_on() {
    let temp = TempDir::new("wontstart");
    let layers = Layers::at(Some(temp.path().to_path_buf()));

    // A download that arrived as something that is not a program at all, which
    // is what half of one looks like from here.
    let mut packed = Vec::new();
    {
        use std::io::Write as _;
        let mut packing = flate2::write::GzEncoder::new(&mut packed, flate2::Compression::fast());
        packing
            .write_all(b"this is not a program")
            .expect("pack it");
        packing.finish().expect("finish packing");
    }

    let refused = layers
        .put("9.9.9", &packed)
        .expect_err("that is not a layer");
    assert!(!refused.is_empty());
    assert!(
        !temp.path().join("9.9.9").exists(),
        "a layer that will not run is not left lying under a version"
    );
    assert_eq!(
        layers.version(),
        totex_layer::VERSION,
        "and what answers is the copy this program carries"
    );
}

#[test]
fn a_layer_that_was_never_put_anywhere_leaves_the_built_in_copy_answering() {
    let temp = TempDir::new("nothing");
    let layers = Layers::at(Some(temp.path().to_path_buf()));
    assert_eq!(layers.version(), totex_layer::VERSION);
    assert!(layers.keeps());

    // And the whole of the folder browser still answers, out of the copy this
    // program carries -- which is what makes taking a layer a thing that can go
    // wrong without anything being lost.
    let listing: crate::fs_browse::Listing = layers
        .ask(
            "read_directory",
            serde_json::json!({ "path": temp.path().to_string_lossy(), "show_hidden": false }),
        )
        .expect("the built-in copy answers");
    assert!(listing.entries.is_empty());
}
