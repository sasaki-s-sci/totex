//! What a press decides, and what a front on disk is allowed to be.
//!
//! The two halves that can be run without a window: the choice between the
//! pages and the program, which is arithmetic on four versions, and the reading
//! of what an earlier run left behind, which is a directory and a small file
//! beside it.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, RwLock};

use semver::Version;
use tauri::Assets;
use tauri::test::MockRuntime;
use tauri::utils::assets::AssetKey;

use super::take::{Found, choose, ours, unpack};
use super::{Behind, Front, Held, Nothing, Serving, TAKEN, Taken, Unpacked, keep, read_under};

fn at(version: &str) -> Version {
    Version::parse(version).expect("a version")
}

/// A temporary directory that removes itself, so a failing test cannot leave a
/// front behind.
struct TempDir(PathBuf);

impl TempDir {
    fn new(tag: &str) -> Self {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|elapsed| elapsed.as_nanos())
            .unwrap_or_default();
        let path =
            std::env::temp_dir().join(format!("totex-front-{tag}-{}-{unique}", std::process::id()));
        std::fs::create_dir_all(&path).expect("create temp dir");
        Self(path)
    }

    fn path(&self) -> &Path {
        &self.0
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

/// A front lying under `home` the way a run that took one leaves it.
fn lay(home: &Path, version: &str, confirmed: bool) {
    let dir = home.join(version);
    fs::create_dir_all(&dir).expect("lay a front");
    fs::write(dir.join("index.html"), b"<!doctype html>").expect("lay a page");
    let taken = Taken {
        version: version.to_string(),
        confirmed,
    };
    fs::write(
        home.join(TAKEN),
        serde_json::to_vec(&taken).expect("write what was taken"),
    )
    .expect("write what was taken");
}

/// A front as the release job packs one: the contents of `dist`, at the root.
fn packed(files: &[(&str, &[u8])]) -> Vec<u8> {
    let mut builder = tar::Builder::new(flate2::write::GzEncoder::new(
        Vec::new(),
        flate2::Compression::fast(),
    ));
    for (name, body) in files {
        let mut header = tar::Header::new_gnu();
        header.set_size(body.len() as u64);
        header.set_mode(0o644);
        builder
            .append_data(&mut header, name, *body)
            .expect("pack a file");
    }
    builder
        .into_inner()
        .expect("finish the archive")
        .finish()
        .expect("finish the compression")
}

#[test]
fn a_press_takes_the_pages_before_the_program() {
    let built = at("0.1.2");
    let release = at("0.1.3");

    // The first press: the cheap half of the release, which costs a redraw.
    assert_eq!(
        choose(&release, Some(1), &built, &built, 1, true),
        Found::Front
    );
    // The second, with the pages already taken: what is left is the program.
    assert_eq!(
        choose(&release, Some(1), &release, &built, 1, true),
        Found::Whole
    );
    // And on a copy that cannot replace itself, that is the end of it.
    assert_eq!(
        choose(&release, Some(1), &release, &built, 1, false),
        Found::Held
    );
}

#[test]
fn the_newest_release_is_nothing_to_do() {
    let built = at("0.1.3");
    for release in ["0.1.3", "0.1.2", "0.0.9"] {
        assert_eq!(
            choose(&at(release), Some(1), &built, &built, 1, true),
            Found::Current,
            "{release} is not newer than {built}"
        );
    }
}

#[test]
fn pages_that_need_a_newer_program_are_left_alone() {
    let built = at("0.1.2");
    let release = at("0.1.3");

    // The release's pages talk to a program this one is not: taking them would
    // be a window drawn against commands that are not there.
    assert_eq!(
        choose(&release, Some(2), &built, &built, 1, true),
        Found::Whole
    );
    assert_eq!(
        choose(&release, Some(2), &built, &built, 1, false),
        Found::Held
    );
    // A release that names no front at all is the same answer.
    assert_eq!(
        choose(&release, None, &built, &built, 1, true),
        Found::Whole
    );
    assert_eq!(
        choose(&release, None, &built, &built, 1, false),
        Found::Held
    );
}

#[test]
fn a_page_can_only_ask_for_what_is_under_the_front() {
    let temp = TempDir::new("under");
    let front = temp.path().join("0.1.3");
    fs::create_dir_all(front.join("assets")).expect("lay a front");
    fs::write(front.join("assets").join("app.js"), b"there").expect("lay a file");
    fs::write(temp.path().join("secret"), b"not there").expect("lay a file");

    assert_eq!(
        read_under(&front, &AssetKey::from("/assets/app.js")).as_deref(),
        Some(&b"there"[..])
    );
    assert_eq!(read_under(&front, &AssetKey::from("/../secret")), None);
    assert_eq!(read_under(&front, &AssetKey::from("/assets/gone.js")), None);
}

#[test]
fn only_a_confirmed_front_newer_than_the_binary_is_opened_on() {
    let built = at("0.1.2");

    let kept = TempDir::new("kept");
    lay(kept.path(), "0.1.3", true);
    assert!(
        keep(kept.path(), &built).is_some(),
        "a confirmed newer front is what the window opens on"
    );

    // One that has never drawn a window is one that has had its chance.
    let unconfirmed = TempDir::new("unconfirmed");
    lay(unconfirmed.path(), "0.1.3", false);
    assert!(keep(unconfirmed.path(), &built).is_none());
    assert!(
        !unconfirmed.path().exists(),
        "and it is not left lying there"
    );

    // One the binary has caught up with is one the binary already carries.
    let overtaken = TempDir::new("overtaken");
    lay(overtaken.path(), "0.1.2", true);
    assert!(keep(overtaken.path(), &built).is_none());
    assert!(!overtaken.path().exists());
}

#[test]
fn opening_on_a_front_clears_away_the_ones_before_it() {
    let temp = TempDir::new("clears");
    lay(temp.path(), "0.1.3", true);
    lay(temp.path(), "0.1.4", true);

    let kept = keep(temp.path(), &at("0.1.2")).expect("the newest of them");
    assert_eq!(kept.version, at("0.1.4"));
    assert!(kept.dir.is_dir());
    assert!(
        !temp.path().join("0.1.3").exists(),
        "the one it overtook goes with it"
    );
}

#[test]
fn a_front_is_the_contents_of_dist_and_has_to_have_a_page() {
    let temp = TempDir::new("unpack");
    let whole = packed(&[
        ("./index.html", b"<!doctype html>"),
        ("./assets/app.js", b"nothing"),
    ]);

    let unpacked = unpack(temp.path(), &at("0.1.3"), &whole).expect("a front with a page in it");
    assert_eq!(unpacked.dir, temp.path().join("0.1.3"));
    assert!(unpacked.dir.join("index.html").is_file());
    assert!(unpacked.dir.join("assets").join("app.js").is_file());

    let partial = packed(&[("./assets/app.js", b"nothing")]);
    assert!(
        unpack(temp.path(), &at("0.1.4"), &partial).is_err(),
        "a front with no page is not a front"
    );
    assert!(
        !temp.path().join("0.1.4").exists(),
        "and it is not left under a version number"
    );
}

/// A front of five bytes and the signature `tauri signer sign` wrote for it,
/// under a key made for this test and thrown away — [`KEY`] is its public half.
///
/// What is held to here is a shape rather than a key. The release manifest
/// carries base64 around a minisign block and `tauri.conf.json` carries base64
/// around the other half of the same pair; these are what the release job
/// actually writes, so this is what says the two are read back the way they
/// were written.
const SIGNED: &[u8] = b"pages";
const SIGNATURE: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBmcm9tIHRhdXJpIHNlY3JldCBrZXkKUlVSYnl2SzBhb0g3aGdGR1A2Rzhzc1RCMHBvVWo2bzlFQlBicTRwUDIxejFrVkEvMStiWGkwOVNaQW1JZ2ZSdDFESC91UmlnYmhKUjJLTVBSYWJRbURrQy81Qk1yMHZCMndZPQp0cnVzdGVkIGNvbW1lbnQ6IHRpbWVzdGFtcDoxNzg3NTA5MTc0CWZpbGU6ZnJvbnQudGFyLmd6CkgrMGlvb0k0eEtPU0JkOWFxRXhLcGhqWk90RkFaK3J2V2pwN2hhaGU5OTBqQ093QnYxQ0hGZ3IxZlBFV2VyZGR4QlJlSmNWaDRYT0FZWmN1ejd2akFRPT0K";
const KEY: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDg2RkI4MTZBQjRGMkNBNUIKUldSYnl2SzBhb0g3aGwzS1ZPY04wenRUdmdnSW5EdnlEMVpMYy8zRnNCb1hwRENvUzVGRllKeUkK";

#[test]
fn a_front_signed_with_the_apps_key_is_the_one_that_is_taken() {
    ours(SIGNED, SIGNATURE, KEY).expect("the signature the signer wrote for it");
    assert!(
        ours(b"other pages", SIGNATURE, KEY).is_err(),
        "the signature is of the front, not of the fact that there is one"
    );
}

#[test]
fn a_front_that_is_not_signed_with_the_apps_key_is_not_taken() {
    assert!(ours(SIGNED, "not base64", KEY).is_err());
    // Well-formed base64 around something that is not a minisign block.
    assert!(ours(SIGNED, "aGVsbG8=", KEY).is_err());
    assert!(ours(SIGNED, SIGNATURE, "aGVsbG8=").is_err());
}

/// A `Serving` pointed at a front laid out under `home`, without going near the
/// machine's real data directory the way `prepare` does.
fn serving(home: &Path, built: &str, version: Option<&str>) -> Arc<Serving> {
    Arc::new(Serving {
        home: Some(home.to_path_buf()),
        built: at(built),
        held: RwLock::new(Held {
            at: version.map(|version| Unpacked {
                dir: home.join(version),
                version: at(version),
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
