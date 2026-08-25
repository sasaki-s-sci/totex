//! Finding a newer front, making sure it is ours, and putting it in place.
//!
//! The whole of one press of the update mark is decided here, including the
//! part this file does not do: the mark asks for the cheapest thing the copy
//! can have, and replacing the program is what is left when replacing only its
//! pages is not enough. See [`choose`].

use std::fs;
use std::path::Path;
use std::sync::Arc;

use semver::Version;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use super::fetch::{ask, ours, unpack};
use super::{Serving, TAKEN, Taken, Unpacked};
use crate::update;

/// As much of the release manifest as this reads. The same document the updater
/// plugin reads, from the same URL: what the newest release is is one fact, and
/// two files saying it are two files that can disagree.
#[derive(Deserialize)]
struct Manifest {
    version: String,
    front: Option<Entry>,
}

/// Where the pages of a release are, and what they need to run against.
#[derive(Deserialize)]
struct Entry {
    /// The oldest agreement between the pages and the program that these pages
    /// will work against — `frontContract` in `package.json`, which is the one
    /// place the number is written and the number both halves are built with.
    needs: u32,
    url: String,
    signature: String,
}

/// What a press found, which is also what was done about it.
#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Found {
    /// The pages of a newer release are unpacked and pointed at. The window has
    /// to be loaded again to be drawn out of them, and that is a press away.
    Front,
    /// Nothing left to take but the program itself, which this copy can
    /// replace: the updater plugin does that, and the window drives it.
    Whole,
    /// There is a newer release and nothing here can have any more of it.
    Held,
    /// This is the newest release.
    Current,
}

/// Which of the four one press ends in, before anything is downloaded.
///
/// Ordered by what it costs the person it is done to. The pages are a download
/// and a redraw; the program is a download and the end of every terminal in the
/// window. So a copy that is behind is given the pages first and offered the
/// program on the next press — the two things arrive in the order of what they
/// interrupt, and neither is done without being asked for.
///
/// `needs` is the agreement the release's own pages were built against, and
/// nothing when the release page names no front at all — one cut before this
/// was written, or one cut without a key to sign anything with.
///
/// `serving` is the version of the front the window is drawn out of now, which
/// is `built` until something newer has been taken. Once it has, the same press
/// that would have taken it again falls through to the program instead, and
/// that is what makes the second press mean the next thing rather than the same
/// thing.
pub(super) fn choose(
    release: &Version,
    needs: Option<u32>,
    serving: &Version,
    built: &Version,
    contract: u32,
    whole: bool,
) -> Found {
    if release <= built {
        // The program is the newest there is, so the pages inside it are too:
        // both come out of the one release, and a front taken before this
        // binary arrived was deleted on the way up for being older than it.
        return Found::Current;
    }
    let takeable = needs.is_some_and(|needs| release > serving && needs <= contract);
    if takeable {
        Found::Front
    } else if whole {
        Found::Whole
    } else {
        Found::Held
    }
}

/// The agreement between the pages and the program, as this binary has it.
///
/// Written into the binary by `build.rs` out of `package.json`, so the number
/// the pages of a release declare and the number the program of that same
/// release accepts are read from one line of one file. It goes up when the
/// commands or the events change in a way older pages could not be run against
/// — and nothing else moves it, because everything it stops is a front being
/// taken onto a program that would not answer it.
fn contract() -> u32 {
    env!("FRONT_CONTRACT")
        .parse()
        .expect("build.rs writes this out of package.json")
}

/// Looks for a newer release and takes as much of it as this copy can have.
#[tauri::command]
pub async fn take_front(app: AppHandle) -> Result<Found, String> {
    let serving = Arc::clone(app.state::<Arc<Serving>>().inner());
    let (endpoint, key) = declared(&app)?;

    let asked = ask(&endpoint).await?;
    let manifest: Manifest =
        serde_json::from_slice(&asked).map_err(|error| format!("unreadable manifest: {error}"))?;
    let release = Version::parse(&manifest.version)
        .map_err(|error| format!("unreadable version: {error}"))?;

    // A machine with no data directory to keep a front in cannot take one, so
    // it is offered whatever else there is rather than a press that can only
    // end in an error nobody can do anything about.
    let front = manifest.front.as_ref().filter(|_| serving.home.is_some());
    let found = choose(
        &release,
        front.map(|entry| entry.needs),
        &serving.version(),
        &serving.built,
        contract(),
        update::whole_update_supported(),
    );
    if found != Found::Front {
        return Ok(found);
    }

    let home = serving
        .home
        .clone()
        .ok_or_else(|| "nowhere to keep a front".to_string())?;
    let entry = manifest
        .front
        .expect("choose only takes a front it was given");
    let tarball = ask(&entry.url).await?;

    // Everything left is the disk, and the disk is not the event loop's to
    // wait on: a front is a few hundred files, and unpacking them is long
    // enough to be seen in a window that is still drawing.
    let unpacked = tauri::async_runtime::spawn_blocking(move || {
        ours(&tarball, &entry.signature, &key)?;
        let unpacked = unpack(&home, &release, &tarball)?;
        point(&home, &unpacked)?;
        Ok::<_, String>(unpacked)
    })
    .await
    .map_err(|error| format!("the front was not put in place: {error}"))??;

    serving.point_at(unpacked);
    Ok(Found::Front)
}

/// Told by a window that has finished drawing itself out of a taken front.
///
/// Until this, a taken front is one that has never been seen to work, and the
/// next start of the app throws it away rather than open on it. Called on every
/// start and out of every front, because a window cannot know which of the two
/// it was drawn from and does not need to: there is nothing to write unless
/// there is a taken front that has not said this yet.
#[tauri::command(async)]
pub fn confirm_front(app: AppHandle) {
    let serving = app.state::<Arc<Serving>>();
    // Whatever this window was drawn out of, nothing is asking for the front
    // before it any more: this window is the one that was waited for.
    serving.drawn();
    let (Some(home), Some(unpacked)) = (serving.home.clone(), serving.at()) else {
        return;
    };
    let confirmed = Taken {
        version: unpacked.version.to_string(),
        confirmed: true,
    };
    let already = fs::read(home.join(TAKEN))
        .ok()
        .and_then(|bytes| serde_json::from_slice::<Taken>(&bytes).ok())
        .is_some_and(|taken| taken.confirmed && taken.version == confirmed.version);
    if already {
        return;
    }
    if let Ok(bytes) = serde_json::to_vec(&confirmed) {
        let _ = fs::write(home.join(TAKEN), bytes);
    }
}

/// The URL a new version is named at and the key it has to be signed with,
/// both read out of the updater's own configuration.
///
/// Not a second copy of either. The whole worth of the key is that there is one
/// of them: the app already declares it once for the plugin, and the build
/// refuses a tree where the two install scripts do not carry the same string.
/// A front signed with anything else is a front from somebody else.
fn declared(app: &AppHandle) -> Result<(String, String), String> {
    let updater = app
        .config()
        .plugins
        .0
        .get("updater")
        .ok_or_else(|| "this build has no updater configured".to_string())?;
    let endpoint = updater["endpoints"][0]
        .as_str()
        .ok_or_else(|| "the updater names no endpoint".to_string())?;
    let key = updater["pubkey"]
        .as_str()
        .ok_or_else(|| "the updater carries no key".to_string())?;
    Ok((endpoint.to_string(), key.to_string()))
}

/// Writes down which front was taken.
///
/// Written unconfirmed, because it is: the window this was taken for has not
/// been drawn yet, and until one has been, this is a directory the next start
/// deletes rather than opens on.
///
/// What it replaces is left where it is. The window on the screen is still
/// being served out of it — see `Behind` — and the next start is what clears
/// away every front but the one it opens on.
fn point(home: &Path, unpacked: &Unpacked) -> Result<(), String> {
    let taken = Taken {
        version: unpacked.version.to_string(),
        confirmed: false,
    };
    let bytes = serde_json::to_vec(&taken).map_err(|error| error.to_string())?;
    fs::write(home.join(TAKEN), bytes).map_err(|error| format!("{}: {error}", home.display()))
}
