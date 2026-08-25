//! Finding the pages of a release, making sure they are ours, and putting them
//! in place.
//!
//! One half of one press: the pages, which cost a download of about a megabyte
//! and a reload. The program under them is [`crate::update`], and the two are
//! asked for separately because they interrupt different amounts — see there
//! for the whole of why a release is taken in halves at all.

use std::fs;
use std::path::Path;
use std::sync::Arc;

use base64::Engine as _;
use base64::engine::general_purpose::STANDARD as BASE64;
use minisign_verify::{PublicKey, Signature};
use semver::Version;
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, Runtime};

use super::{Serving, TAKEN, Taken, Unpacked};
use crate::release::{self, Cycle};
use crate::update::{Coming, Took};

/// The most of a front that will be read off the network.
///
/// The pages of this app are around a megabyte. This is not a size anything is
/// expected to reach — it is what stops a URL that answers forever from filling
/// memory, which is the one thing an unbounded read of somebody else's server
/// can be made to do before a signature has been checked.
const MOST: usize = 64 * 1024 * 1024;

/// What a press on the pages row does about the release it was pointed at.
///
/// `needs` is the agreement the release's own pages were built against, and
/// nothing when the release names no front at all — one cut before this was
/// written, or one cut without a key to sign anything with.
///
/// `serving` is the version of the front the window is drawn out of now, which
/// is `built` until something newer has been taken.
///
/// `named` is whether somebody said which release this is about. It is the
/// whole of the difference between going forward and going back. Left to
/// itself, the pages only go forward: a press that means "bring me up to date"
/// and finds pages older than the program has found nothing worth doing, since
/// the program's own pages are newer than what it would be taking. Named, it
/// is not a direction at all — it is a version somebody chose, and choosing the
/// one you were on last week is the thing choosing is for. What holds a front
/// older than the program in place afterwards is [`super::Taken::pinned`].
pub(super) fn choose(
    release: &Version,
    needs: Option<u32>,
    serving: &Version,
    built: &Version,
    contract: u32,
    named: bool,
) -> Took {
    if release == serving {
        // These are the pages on the screen. Whether they were taken or built
        // in, there is nothing here left to take.
        return Took::Current;
    }
    match needs {
        // Pages that talk to a program this one is not would be a window
        // calling commands that are not there, whoever asked for them.
        Some(needs) if needs > contract => Took::Held,
        Some(_) if release > built || named => Took::Taken,
        // Either the release keeps its pages inside its program, or they are
        // behind the program already here and nobody asked for them by name.
        // Both are the same answer: these are not pages this row can bring, and
        // the row underneath is the one that brings them.
        _ => Took::Held,
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
pub(crate) fn contract() -> u32 {
    env!("FRONT_CONTRACT")
        .parse()
        .expect("build.rs writes this out of package.json")
}

/// Takes the pages of one release, or says why they are not this row's to take.
///
/// `version` is what the pull-down was on, or nothing at all on a window that
/// never got a list of versions — which reads whatever the release page says is
/// newest, exactly as every press meant before a version could be named.
pub async fn take_front<R: Runtime>(
    app: &AppHandle<R>,
    cycle: &Cycle,
    version: Option<&str>,
    coming: &Channel<Coming>,
) -> Result<Took, String> {
    let serving = Arc::clone(app.state::<Arc<Serving>>().inner());
    let (endpoint, key) = release::declared(app)?;

    let manifest = release::read(&endpoint, cycle, version).await?;
    let release = Version::parse(&manifest.version)
        .map_err(|error| format!("unreadable version: {error}"))?;

    // A machine with no data directory to keep a front in cannot take one, so
    // it is told that rather than left with a press that can only end in an
    // error nobody can do anything about.
    let entry = manifest.front.filter(|_| serving.keeps());
    let took = choose(
        &release,
        entry.as_ref().map(|entry| entry.needs),
        &serving.version(),
        serving.built(),
        contract(),
        version.is_some(),
    );
    if took != Took::Taken {
        return Ok(took);
    }

    let home = serving
        .home
        .clone()
        .ok_or_else(|| "nowhere to keep a front".to_string())?;
    let entry = entry.expect("choose only takes a front it was given");
    let tarball = release::fetch::along(&entry.url, MOST, |taken, length| {
        Coming::say(coming, taken, length);
    })
    .await?;

    // Everything left is the disk, and the disk is not the event loop's to
    // wait on: a front is a few hundred files, and unpacking them is long
    // enough to be seen in a window that is still drawing.
    let pinned = release <= *serving.built();
    let unpacked = tauri::async_runtime::spawn_blocking(move || {
        ours(&tarball, &entry.signature, &key)?;
        let unpacked = unpack(&home, &release, entry.needs, pinned, &tarball)?;
        point(&home, &unpacked)?;
        Ok::<_, String>(unpacked)
    })
    .await
    .map_err(|error| format!("the front was not put in place: {error}"))??;

    serving.point_at(unpacked);
    Ok(Took::Taken)
}

/// Told by a window that has finished drawing itself out of a taken front.
///
/// Until this, a taken front is one that has never been seen to work, and the
/// next start of the app throws it away rather than open on it. Called on every
/// start and out of every front, because a window cannot know which of the two
/// it was drawn from and does not need to: there is nothing to write unless
/// there is a taken front that has not said this yet.
#[tauri::command(async)]
pub fn confirm_front<R: Runtime>(app: AppHandle<R>) {
    let serving = app.state::<Arc<Serving>>();
    // Whatever this window was drawn out of, nothing is asking for the front
    // before it any more: this window is the one that was waited for.
    serving.drawn();
    let (Some(home), Some(unpacked)) = (serving.home.clone(), serving.at()) else {
        return;
    };
    let confirmed = Taken {
        version: unpacked.version.to_string(),
        needs: unpacked.needs,
        pinned: unpacked.pinned,
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

/// Whether this is the front the release page named, signed with our key.
///
/// The two strings are base64 around the two halves of a minisign pair, which
/// is the shape the updater plugin's own manifest carries and the shape
/// `tauri signer` writes — the front is signed by the same command, with the
/// same key, in the same job as the installers beside it.
pub(crate) fn ours(tarball: &[u8], signature: &str, key: &str) -> Result<(), String> {
    let text = |encoded: &str, what: &str| {
        BASE64
            .decode(encoded)
            .ok()
            .and_then(|bytes| String::from_utf8(bytes).ok())
            .ok_or_else(|| format!("the {what} is not what a {what} looks like"))
    };
    let key = PublicKey::decode(&text(key, "key")?)
        .map_err(|error| format!("the key will not decode: {error}"))?;
    let signature = Signature::decode(&text(signature, "signature")?)
        .map_err(|error| format!("the signature will not decode: {error}"))?;
    key.verify(tarball, &signature, true)
        .map_err(|_| "this front is not signed with the app's key".to_string())
}

/// Lays the front out on disk, under the name of the release it came from.
///
/// Unpacked beside where it is going and moved into place in one step, so that
/// what the name of a version points at is either the whole of that front or
/// nothing — a half-written directory under a version number is one a later
/// start would open on and be unable to draw.
pub(super) fn unpack(
    home: &Path,
    version: &Version,
    needs: u32,
    pinned: bool,
    tarball: &[u8],
) -> Result<Unpacked, String> {
    let dir = home.join(version.to_string());
    let taking = home.join(format!("{version}.taking"));
    fs::create_dir_all(home).map_err(|error| format!("{}: {error}", home.display()))?;
    let _ = fs::remove_dir_all(&taking);

    let mut archive = tar::Archive::new(flate2::read::GzDecoder::new(tarball));
    // These pages are read back by this app and by nothing else, so the modes
    // and the times the archive carries are not wanted. What is wanted is that
    // nothing in it lands outside the directory, and that is what `unpack`
    // already holds to: an entry naming its way out is skipped, not followed.
    archive.set_preserve_permissions(false);
    archive.set_preserve_mtime(false);
    archive
        .unpack(&taking)
        .map_err(|error| format!("the front would not unpack: {error}"))?;

    // The one file every front has, and the one a window asks for first.
    if !taking.join("index.html").is_file() {
        let _ = fs::remove_dir_all(&taking);
        return Err("the front arrived without a page in it".to_string());
    }

    let _ = fs::remove_dir_all(&dir);
    fs::rename(&taking, &dir).map_err(|error| format!("{}: {error}", dir.display()))?;
    Ok(Unpacked {
        dir,
        version: version.clone(),
        needs,
        pinned,
    })
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
        needs: unpacked.needs,
        pinned: unpacked.pinned,
        confirmed: false,
    };
    let bytes = serde_json::to_vec(&taken).map_err(|error| error.to_string())?;
    fs::write(home.join(TAKEN), bytes).map_err(|error| format!("{}: {error}", home.display()))
}
