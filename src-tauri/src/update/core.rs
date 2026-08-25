//! Replacing the program, which is the layer that ends every terminal with it.
//!
//! The expensive third, and the only one that is not this app's own doing: what
//! replaces a program is an installer, and running one over the top of a copy
//! of itself is what the updater plugin is. This is the release page read the
//! way the other two layers read it, and then handed to the plugin.

use std::sync::Arc;
use std::time::Duration;

use tauri::ipc::Channel;
use tauri::{AppHandle, Manager};

use crate::front::Serving;
use crate::release::{self, Cycle};

use super::{Coming, Took, whole_update_supported};

/// How long the whole of a release is given to arrive.
///
/// Said apart from the reading of the release page, because they are not the
/// same wait: a page of JSON should come back inside a breath, and a program is
/// worth waiting a while for. The plugin would otherwise hold both to whichever
/// was asked for first — twenty seconds for an installer of eighty megabytes is
/// a download that ends in red on every line anybody has.
const FETCHING: Duration = Duration::from_secs(15 * 60);

/// Replaces the program with the one a named release carries.
///
/// The expensive layer, and the one that ends every terminal in the window, so
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
pub async fn take_core(
    app: &AppHandle,
    cycle: &Cycle,
    version: Option<&str>,
    coming: &Channel<Coming>,
) -> Result<Took, String> {
    use tauri_plugin_updater::UpdaterExt;

    if !whole_update_supported() {
        return Ok(Took::Held);
    }

    let (endpoint, _) = release::declared(app)?;
    let url = release::manifest_url(&endpoint, cycle, version).ok_or_else(|| {
        format!(
            "there is no release page here for {}",
            version.unwrap_or("the newest release")
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
    // The same check `release::read` makes on the other layers: a tag whose
    // manifest names a different version is a release page somebody has been
    // at, and taking what it offers anyway would make naming a version mean
    // nothing.
    if let Some(version) = version
        && update.version != version
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
                Coming::say(coming, taken, length);
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
pub async fn take_core(
    _app: &AppHandle,
    _cycle: &Cycle,
    _version: Option<&str>,
    _coming: &Channel<Coming>,
) -> Result<Took, String> {
    Ok(Took::Held)
}
