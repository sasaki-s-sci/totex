//! Taking the application layer, against a release page this test is holding.

use std::collections::HashMap;

use tauri::ipc::Channel;

use crate::app_layer::Layers;
use crate::release::{Cycles, target};
use crate::update::Took;
use crate::update::layer::take_layer;

use super::{Page, TempDir, app};

/// A release page saying one thing about itself, and holding nothing.
///
/// For the presses that are answered before anything is downloaded, which is
/// most of them: a release that keeps its layer inside its program, one built
/// for another machine, one this program could not talk to.
fn holding(manifest: serde_json::Value) -> Page {
    let page = Page::holding(HashMap::new());
    page.says(manifest);
    page
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
    let page = holding(serde_json::json!({
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
    }));
    let app = app(page.endpoint(), temp.path());
    assert_eq!(press(&app, None), Ok(Took::Held));
}

#[test]
fn a_release_with_no_layer_for_this_machine_is_the_programs_to_bring() {
    let temp = TempDir::new("elsewhere");
    let page = holding(serde_json::json!({
        "version": "9.9.9",
        "layers": {
            "commodore-6502": {
                "protocol": totex_layer::PROTOCOL,
                "url": "http://127.0.0.1:1/never-asked-for",
                "signature": "",
            }
        }
    }));
    let app = app(page.endpoint(), temp.path());
    assert_eq!(press(&app, None), Ok(Took::Held));
}

#[test]
fn the_layer_that_is_already_answering_is_nothing_to_do() {
    let temp = TempDir::new("current");
    let page = holding(serde_json::json!({ "version": totex_layer::VERSION, "layers": {} }));
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
    page.says(serde_json::json!({
        "version": "9.9.9",
        "layers": {
            target(): {
                "protocol": totex_layer::PROTOCOL,
                "url": page.url("/layer.gz"),
                "signature": "not a signature",
            }
        }
    }));
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

/// The layer as a release ships it, which is the program cargo built beside
/// this test.
///
/// `cargo test --workspace` -- which is what `task test` runs, and what the
/// build workflow runs -- builds every target in the workspace before it runs
/// any of them, so by the time this is asked the program is there. Anything
/// that skipped building it is told so rather than quietly passing: what is
/// being checked here is the one thing that cannot be checked without it.
pub(super) fn built_layer() -> std::path::PathBuf {
    let program = if cfg!(windows) {
        "totex-layer.exe"
    } else {
        "totex-layer"
    };
    let beside = std::env::current_exe()
        .expect("this test")
        // target/<profile>/deps/<test> -> target/<profile>/<program>
        .parent()
        .and_then(|deps| deps.parent())
        .expect("the directory this test was built in")
        .join(program);
    assert!(
        beside.is_file(),
        "{} was not built -- run `task test`, which builds the whole workspace",
        beside.display()
    );
    beside
}

/// A layer as a release ships one: the program, gzipped.
pub(super) fn packed(program: &std::path::Path) -> Vec<u8> {
    use std::io::Write as _;
    let mut packed = Vec::new();
    let mut packing = flate2::write::GzEncoder::new(&mut packed, flate2::Compression::fast());
    packing
        .write_all(&std::fs::read(program).expect("read the program"))
        .expect("pack it");
    packing.finish().expect("finish packing");
    packed
}

#[test]
fn a_layer_that_was_taken_is_what_answers_afterwards() {
    let temp = TempDir::new("swapped");
    let layers = Layers::at(Some(temp.path().to_path_buf()));
    assert!(!layers.beside(), "nothing has been taken yet");

    let took = layers
        .put(totex_layer::VERSION, &packed(&built_layer()))
        .expect("a layer that is a layer");
    assert_eq!(took, Took::Taken);
    assert!(layers.beside(), "and it is the one being asked");

    // Asked something, and the answer is the answer -- which is the whole of
    // what taking a layer is for, and the one part of it that goes through a
    // pipe to another process.
    let listing: crate::fs_browse::Listing = layers
        .ask(
            "read_directory",
            serde_json::json!({ "path": temp.path().to_string_lossy(), "show_hidden": true }),
        )
        .expect("the layer answers");
    assert!(
        listing
            .entries
            .iter()
            .any(|entry| entry.name == totex_layer::VERSION),
        "the layer reads the directory it was unpacked into"
    );

    // A question that layer does not answer is answered by the copy this
    // program carries, without anybody being told anything went wrong.
    let refused = layers.ask::<serde_json::Value>("pty_open", serde_json::json!({}));
    assert!(refused.is_err_and(|said| said.contains("pty_open")));

    // And what the next start of the app would open on is this same layer.
    let after = Layers::at(Some(temp.path().to_path_buf()));
    assert!(
        after.beside(),
        "it was written down as the one that was taken"
    );
}

#[test]
fn letting_go_of_a_layer_leaves_the_built_in_copy_answering() {
    let temp = TempDir::new("forgotten");
    let layers = Layers::at(Some(temp.path().to_path_buf()));
    layers
        .put(totex_layer::VERSION, &packed(&built_layer()))
        .expect("a layer that is a layer");

    layers.forget();
    assert!(!layers.beside());
    // The window never finds out: the same question is answered by the copy
    // the program carries, and the answer is the same answer.
    let listing: crate::fs_browse::Listing = layers
        .ask(
            "read_directory",
            serde_json::json!({ "path": temp.path().to_string_lossy(), "show_hidden": true }),
        )
        .expect("the built-in copy answers");
    assert!(listing.entries.is_empty(), "and it was cleared away");

    let after = Layers::at(Some(temp.path().to_path_buf()));
    assert!(!after.beside(), "the next start opens on the built-in copy");
}
