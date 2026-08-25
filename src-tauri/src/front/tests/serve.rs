//! Which front a window is actually drawn out of, page by page.

use std::fs;
use std::path::Path;
use std::sync::{Arc, RwLock};

use tauri::Assets;
use tauri::test::MockRuntime;
use tauri::utils::assets::AssetKey;

use super::super::{Behind, Front, Held, Nothing, Serving, Unpacked};
use super::{TempDir, at, lay};

/// A `Serving` pointed at a front laid out under `home`, without going near the
/// machine's real data directory the way `prepare` does.
pub(super) fn serving(home: &Path, built: &str, version: Option<&str>) -> Arc<Serving> {
    Arc::new(Serving {
        home: Some(home.to_path_buf()),
        built: at(built),
        held: RwLock::new(Held {
            at: version.map(|version| Unpacked {
                dir: home.join(version),
                version: at(version),
                needs: 1,
                pinned: false,
            }),
            behind: Behind::Nothing,
        }),
    })
}

fn asked(front: &Front<MockRuntime>, path: &str) -> Option<Vec<u8>> {
    Assets::<MockRuntime>::get(front, &AssetKey::from(path)).map(|bytes| bytes.into_owned())
}

#[test]
fn a_window_is_drawn_out_of_the_front_that_is_being_served() {
    let temp = TempDir::new("served");
    lay(temp.path(), "0.1.3", true);

    let front = Front::new(
        serving(temp.path(), "0.1.2", Some("0.1.3")),
        Box::new(Nothing),
    );
    assert_eq!(
        asked(&front, "/index.html").as_deref(),
        Some(&b"<!doctype html>"[..])
    );
    // Nothing stands behind a front that has been opened on, so a file it has
    // not got is a file there is not -- see the module docs.
    assert_eq!(asked(&front, "/assets/gone.js"), None);

    // And with no front taken at all, every ask goes to what was built in.
    let built_in = Front::new(serving(temp.path(), "0.1.2", None), Box::new(Nothing));
    assert_eq!(asked(&built_in, "/index.html"), None);
}

#[test]
fn the_front_being_replaced_answers_until_a_window_has_been_drawn() {
    let temp = TempDir::new("behind");
    lay(temp.path(), "0.1.3", true);
    fs::write(
        temp.path().join("0.1.3").join("old.js"),
        b"the open window's",
    )
    .expect("lay a file");
    lay(temp.path(), "0.1.4", false);

    let serving = serving(temp.path(), "0.1.2", Some("0.1.3"));
    let front = Front::new(Arc::clone(&serving), Box::new(Nothing));
    serving.point_at(Unpacked {
        dir: temp.path().join("0.1.4"),
        version: at("0.1.4"),
        needs: 1,
        pinned: false,
    });

    // The window on the screen is still the one that was there, and it goes on
    // asking for its own pieces as parts of it are opened for the first time.
    assert_eq!(
        asked(&front, "/old.js").as_deref(),
        Some(&b"the open window's"[..])
    );
    // The one it was taken for is drawn out of the new one either way.
    assert_eq!(
        asked(&front, "/index.html").as_deref(),
        Some(&b"<!doctype html>"[..])
    );

    // Once a window has been drawn out of the new front, nothing is left
    // asking for the old one.
    serving.drawn();
    assert_eq!(asked(&front, "/old.js"), None);
}

#[test]
fn tauri_asks_this_for_the_page_the_window_opens_on() {
    let temp = TempDir::new("resolver");
    lay(temp.path(), "0.1.3", true);

    // A whole app, built the way the real one is built: the context is handed
    // the front before it is run, and what is asked of it here is what the
    // webview asks of it there -- the same resolver, on the way to the same
    // `get`. Nothing below this line is this module's own code, which is the
    // point of running it.
    let mut context = tauri::test::mock_context(tauri::test::noop_assets());
    context.set_assets(Box::new(Front::new(
        serving(temp.path(), "0.1.2", Some("0.1.3")),
        Box::new(Nothing),
    )));
    let app = tauri::test::mock_builder()
        .build(context)
        .expect("an app with a front in it");

    let asset = app
        .asset_resolver()
        .get("index.html".to_string())
        .expect("the page the window opens on");
    assert_eq!(asset.bytes, b"<!doctype html>");
    assert_eq!(asset.mime_type, "text/html");
}
