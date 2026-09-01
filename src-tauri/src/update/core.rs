//! Replacing the program, which is the layer that ends every terminal with it.
//!
//! The expensive third, and the only one that is not this app's own doing: what
//! replaces a program is an installer, and running one over the top of a copy
//! of itself is what the updater plugin is. This is the release page read the
//! way the other two layers read it, and then handed to the plugin.
//!
//! A press here is the download and nothing else. What puts the release in is
//! the app being closed, wherever putting it in would have closed the app —
//! see [`super::waiting`], which is the whole of why the two are apart.

use std::sync::Arc;
use std::time::Duration;

use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, Runtime};

use crate::front::Serving;
use crate::release::{self, Cycle};

use super::{Coming, Took, whole_update_supported};

/// Whether putting a release in ends this process.
///
/// The Windows installers are run over the top of a closed app: the updater
/// starts one, this process ends inside the call, and the installer opens the
/// new copy afterwards. Everywhere else an install is files being written — a
/// `.app` unpacked over, an AppImage rewritten — and the copy it replaces goes
/// on running out of what it already has open, up until the next start.
const ENDS_THIS_PROCESS: bool = cfg!(windows);

/// How long the whole of a release is given to arrive.
///
/// Said apart from the reading of the release page, because they are not the
/// same wait: a page of JSON should come back inside a breath, and a program is
/// worth waiting a while for. The plugin would otherwise hold both to whichever
/// was asked for first — twenty seconds for an installer of eighty megabytes is
/// a download that ends in red on every line anybody has.
const FETCHING: Duration = Duration::from_secs(15 * 60);

/// Takes the program a named release carries, ready for the next start.
///
/// The expensive layer, and the one whose arrival ends every terminal in the
/// window, so nothing here happens without the row having been pressed.
/// `version` is what the pull-down was on, or nothing at all on a window that
/// never got a list of versions — which asks the release page for whatever is
/// newest, exactly as every press meant before a version could be named.
///
/// A named version is taken whether it is newer or older than what is running.
/// That is the whole of what naming one is for: the default comparison would
/// turn down the release somebody just picked for the crime of being the one
/// they were on last week. Unnamed, the ordinary rule stands — newer only.
#[cfg(desktop)]
pub async fn take_core<R: Runtime>(
    app: &AppHandle<R>,
    cycle: &Cycle,
    version: Option<&str>,
    coming: &Channel<Coming>,
) -> Result<Took, String> {
    use super::waiting::Waiting;
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

    let mut taken = 0u64;
    let release = update
        .download(
            |chunk, length| {
                taken += chunk as u64;
                Coming::say(coming, taken, length);
            },
            || {},
        )
        .await
        .map_err(|error| format!("the release did not come down: {error}"))?;

    // It is here, the signature checked, and the window is still open — which
    // is the whole of what taking the download out of the install is for. From
    // this line on the release is going in, so the pages taken over the top of
    // the old program are dropped: the program about to be in place carries its
    // own, and those are the ones this release means. Only the next start is
    // reached by it; the window on the screen goes on being served out of the
    // directory it was opened on.
    app.state::<Arc<Serving>>().drop_front();

    if ENDS_THIS_PROCESS {
        app.state::<Arc<Waiting>>().hold(update, &release)?;
    } else {
        update
            .install(release)
            .map_err(|error| format!("the release did not go in: {error}"))?;
    }
    Ok(Took::Taken)
}

/// There is no program to replace where there is no updater to replace it: a
/// phone gets its app from a store rather than from a release page.
#[cfg(not(desktop))]
pub async fn take_core<R: Runtime>(
    _app: &AppHandle<R>,
    _cycle: &Cycle,
    _version: Option<&str>,
    _coming: &Channel<Coming>,
) -> Result<Took, String> {
    Ok(Took::Held)
}
