//! Replacing this copy of the app, and how much of it there is to replace.
//!
//! A release has two halves and they are taken apart from one another. The
//! pages the window is drawn out of are a small download and a reload; the
//! program under them is a large one and a restart that ends every terminal in
//! the window. So they are two mechanisms — [`crate::front`] takes the pages,
//! and the updater plugin replaces the program — and this is the half that
//! replaces the program, beside the two questions that are about the copy
//! rather than about either half.
//!
//! ## What a copy can have
//!
//! The updater swaps the thing it is running from, so what it can do depends
//! entirely on what that thing is. An AppImage is one file and is overwritten; a
//! `.app` is a directory and is unpacked over; the two Windows installers are
//! re-run over themselves. A `.deb` or an `.rpm` is none of those — the files
//! belong to the package manager, the app is not running as root, and replacing
//! them behind the manager's back would leave it describing a version that is no
//! longer there.
//!
//! That is the whole answer for the program. It is not the whole answer for the
//! app: the pages are replaced without touching a file anything else owns, so a
//! `.deb` and an `.rpm` are copies that can be brought forward halfway, and are
//! offered exactly that half.
//!
//! A binary run straight out of `target/` is offered neither. It was never
//! installed, so there is nothing to overwrite; and the pages it draws are the
//! ones somebody just built, which taking a release's over would quietly undo.
//!
//! The answer is asked for before either row is drawn rather than found out by
//! pressing one. The bundler patches it into each bundle it makes — the same
//! binary comes out of the Windows job twice, once saying NSIS and once saying
//! MSI — so this is what the running copy actually is, not what the platform
//! usually is.
//!
//! ## Naming a version
//!
//! Both halves take a version rather than "whatever is newest", and the same
//! version can be handed to both. That is what makes a release page something to
//! choose from rather than a direction to be carried in: the pages of 0.1.9 can
//! be tried on the program of 0.1.7, and a program that turned out worse can be
//! put back the way it was. Going back is the program's alone — see `choose` in
//! `front/take.rs` for why the pages only ever go forward — so taking a program
//! is also what clears away a front taken over the top of it, and the release
//! that was asked for is the whole of what is left standing.

use std::sync::Arc;
use std::time::Duration;

use serde::Serialize;
use tauri::ipc::Channel;
use tauri::utils::config::BundleType;
use tauri::utils::platform::bundle_type;
use tauri::{AppHandle, Manager};

use crate::front::Serving;
use crate::release;

/// How long the whole of a release is given to arrive.
///
/// Said apart from the reading of the release page, because they are not the
/// same wait: a page of JSON should come back inside a breath, and a program is
/// worth waiting a while for. The plugin would otherwise hold both to whichever
/// was asked for first — twenty seconds for an installer of eighty megabytes is
/// a download that ends in red on every line anybody has.
const FETCHING: Duration = Duration::from_secs(15 * 60);

/// What a press on one half of a release found, which is also what was done.
#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Took {
    /// It is here. What is left is the press that finishes it — a reload for
    /// the pages, a restart for the program.
    Taken,
    /// Nothing to do: that release is what is already being drawn, or already
    /// running.
    Current,
    /// There is a release and this half cannot bring it. The pages of it are
    /// the program's to bring, or the program is the package manager's.
    Held,
}

/// How much of the program has arrived, said as it arrives.
///
/// Cumulative rather than a chunk at a time, so that a window which missed one
/// message draws the same ring as one that missed none.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Coming {
    /// How many bytes are here.
    taken: u64,
    /// How many there are, where the server said. A server that did not say
    /// leaves the ring turning instead of filling, which is the honest drawing.
    length: Option<u64>,
}

/// Where this copy stands: what each half can be replaced with, and what each
/// half is at now.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Standing {
    /// Whether the pages can be replaced on their own.
    front: bool,
    /// Whether the program can replace itself.
    whole: bool,
    /// The version of the program running.
    running: String,
    /// The version of the pages the window is drawn out of, which is the
    /// program's own until something newer has been taken.
    drawn: String,
}

/// What the two rows of the settings dialog are drawn from.
///
/// Asked once for the life of the window: which halves can be replaced is a
/// fact about how the app was installed, and neither version moves without a
/// reload or a restart. A copy where both are false draws no update rows at
/// all, because every press of one would end in the same answer: this is not a
/// copy anybody installed.
#[tauri::command]
pub fn update_standing(app: AppHandle) -> Standing {
    let serving = app.state::<Arc<Serving>>();
    Standing {
        // Somewhere to keep a front is as much a condition as having been
        // installed: a machine with no data directory can only ever run the
        // pages it was installed with.
        front: bundle_type().is_some() && serving.keeps(),
        whole: whole_update_supported(),
        running: serving.built().to_string(),
        drawn: serving.version().to_string(),
    }
}

/// Whether the updater can replace the whole of this copy in place.
pub fn whole_update_supported() -> bool {
    matches!(
        bundle_type(),
        Some(BundleType::App | BundleType::AppImage | BundleType::Msi | BundleType::Nsis)
    )
}

/// Replaces the program with the one a named release carries.
///
/// The expensive half, and the one that ends every terminal in the window, so
/// nothing here happens without the row having been pressed. `version` is what
/// the pull-down was on, or nothing at all on a window that never got a list of
/// versions — which asks the release page for whatever is newest, exactly as
/// every press meant before a version could be named.
///
/// A named version is taken whether it is newer or older than what is running.
/// That is the whole of what naming one is for: the default comparison would
/// turn down the release somebody just picked for the crime of being the one
/// they were on last week. Unnamed, the ordinary rule stands — newer only.
#[cfg(desktop)]
#[tauri::command]
pub async fn take_whole(
    app: AppHandle,
    version: Option<String>,
    coming: Channel<Coming>,
) -> Result<Took, String> {
    use tauri_plugin_updater::UpdaterExt;

    if !whole_update_supported() {
        return Ok(Took::Held);
    }

    let (endpoint, _) = release::declared(&app)?;
    let url = release::manifest_url(&endpoint, version.as_deref()).ok_or_else(|| {
        format!(
            "there is no release page here for {}",
            version.as_deref().unwrap_or("the newest release")
        )
    })?;
    let url = tauri::Url::parse(&url).map_err(|error| format!("{url}: {error}"))?;

    let mut builder = app
        .updater_builder()
        .endpoints(vec![url])
        .map_err(|error| format!("the release page cannot be asked: {error}"))?
        .timeout(release::PATIENCE);
    if version.is_some() {
        builder = builder.version_comparator(|running, release| release.version != running);
    }
    let updater = builder
        .build()
        .map_err(|error| format!("nothing to update with: {error}"))?;

    let found = updater
        .check()
        .await
        .map_err(|error| format!("the release page did not answer: {error}"))?;
    let Some(mut update) = found else {
        return Ok(Took::Current);
    };
    // The same check `release::read` makes on the other half: a tag whose
    // manifest names a different version is a release page somebody has been
    // at, and taking what it offers anyway would make naming a version mean
    // nothing.
    if let Some(version) = &version
        && &update.version != version
    {
        return Err(format!(
            "v{version} was asked for and the release under that tag says {}",
            update.version
        ));
    }

    // The check is done and what is left is the download, which is the other
    // wait entirely — see `FETCHING`.
    update.timeout = Some(FETCHING);

    // Before the download rather than after it, because on Windows there is no
    // after: the installer is run over the top of a closed app, so this process
    // ends inside `download_and_install` and the installer opens the new one. A
    // download that then fails leaves the window drawn out of the pages the
    // program was built with, which is the one front that always works.
    let serving = Arc::clone(app.state::<Arc<Serving>>().inner());
    serving.drop_front();

    let mut taken = 0u64;
    update
        .download_and_install(
            |chunk, length| {
                taken += chunk as u64;
                // A window that has closed the channel is a window that was
                // reloaded mid-download; the download is still worth finishing.
                let _ = coming.send(Coming { taken, length });
            },
            || {},
        )
        .await
        .map_err(|error| format!("the release did not go in: {error}"))?;
    Ok(Took::Taken)
}

/// There is no program to replace where there is no updater to replace it: a
/// phone gets its app from a store rather than from a release page.
#[cfg(not(desktop))]
#[tauri::command]
pub async fn take_whole(
    _app: AppHandle,
    _version: Option<String>,
    _coming: Channel<Coming>,
) -> Result<Took, String> {
    Ok(Took::Held)
}
