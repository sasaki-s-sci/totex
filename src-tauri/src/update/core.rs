//! Replacing the program, which is the layer that takes the window with it.
//!
//! The expensive half, and no longer the one that ends every terminal: the
//! shells are held by the program beside this one — see `keep` — and that is
//! also the program that puts a release in, because it is the one still here
//! when this window is not. What happens here is the release page read the way
//! the pages' row reads it, and the download handed to the keep to bring down
//! and check.
//!
//! A press here is the download and nothing else. What puts the release in is
//! this window leaving so that the next can take its place — see [`super::ready`]
//! and [`super::update_restart`] — which the pages ask for the moment the
//! download is here.

use std::sync::Arc;

use semver::Version;
use tauri::ipc::Channel;
use tauri::utils::config::BundleType;
use tauri::utils::platform::bundle_type;
use tauri::{AppHandle, Manager, Runtime};

use totex_keep::update::{Install, Kind, Taken};

use crate::front::Serving;
use crate::release::{self, Cycle};

use super::ready::Ready;
use super::{Coming, Took, whole_update_supported};

/// Which kind of installed copy this is, and what a release of it replaces.
///
/// The release manifest lists a download per kind of installed copy rather
/// than per platform — see `scripts/update-manifest.mjs`, which is the other
/// half of these names — because a `.deb` is files a package manager owns, and
/// handing it an AppImage to write over itself with would leave the manager
/// describing a version that is no longer there. Such a copy is not in here at
/// all, and is offered nothing.
///
/// What is replaced is the thing this window is running from: the AppImage is
/// named by the runtime that mounted it, the bundle is three directories above
/// the program, and on Windows the installer writes over the program itself.
pub(super) fn standing() -> Option<(String, Kind, std::path::PathBuf)> {
    let arch = std::env::consts::ARCH;
    let exe = std::env::current_exe().ok()?;
    Some(match bundle_type()? {
        BundleType::AppImage => (
            format!("linux-{arch}-appimage"),
            Kind::AppImage,
            std::env::var_os("APPIMAGE").map(std::path::PathBuf::from)?,
        ),
        BundleType::App => (
            format!("darwin-{arch}"),
            Kind::App,
            exe.ancestors().nth(3)?.to_path_buf(),
        ),
        BundleType::Nsis => (format!("windows-{arch}-nsis"), Kind::Nsis, exe),
        BundleType::Msi => (format!("windows-{arch}-msi"), Kind::Msi, exe),
        _ => return None,
    })
}

/// Takes the program a named release carries, ready for the restart.
///
/// `version` is what the pull-down was on, or nothing at all on a window that
/// never got a list of versions — which asks the release page for whatever is
/// newest, exactly as every press meant before a version could be named.
///
/// A named version is taken whether it is newer or older than what is running.
/// That is the whole of what naming one is for: the default comparison would
/// turn down the release somebody just picked for the crime of being the one
/// they were on last week. Unnamed, the ordinary rule stands — newer only.
pub async fn take_core<R: Runtime>(
    app: &AppHandle<R>,
    cycle: &Cycle,
    version: Option<&str>,
    coming: &Channel<Coming>,
) -> Result<Took, String> {
    if !whole_update_supported() {
        return Ok(Took::Held);
    }
    let Some((platform, kind, target)) = standing() else {
        return Ok(Took::Held);
    };

    let (endpoint, key) = release::declared(app)?;
    let manifest = release::read(&endpoint, cycle, version).await?;
    let release = Version::parse(&manifest.version)
        .map_err(|error| format!("unreadable version: {error}"))?;
    let running = Version::parse(env!("CARGO_PKG_VERSION")).expect("this program's version");
    if release == running || (version.is_none() && release < running) {
        return Ok(Took::Current);
    }
    let Some(download) = manifest.platforms.get(&platform) else {
        return Ok(Took::Held);
    };

    // Brought down by the program beside this one, which is the one that will
    // put it in. The socket is not the event loop's to wait on: the whole of
    // a release comes back down it.
    let link = crate::keep::link(app);
    let asking = serde_json::json!({
        "url": download.url,
        "signature": download.signature,
        "key": key,
    });
    let telling = coming.clone();
    let taken: Taken = tauri::async_runtime::spawn_blocking(move || {
        let said = link.ask_watching(
            "take_program",
            asking,
            Box::new(move |taken, length| Coming::say(&telling, taken, length)),
        )?;
        serde_json::from_value(said).map_err(|error| format!("the release was not said: {error}"))
    })
    .await
    .map_err(|error| format!("the release did not come down: {error}"))??;

    // It is here and the signature checked. From this line on the release is
    // going in, so the pages taken over the top of the old program are
    // dropped: the program about to be in place carries its own, and those
    // are the ones this release means. Only the next window is reached by it;
    // this one goes on being served out of the directory it was opened on.
    app.state::<Arc<Serving>>().drop_front();
    app.state::<Arc<Ready>>().hold(
        &release.to_string(),
        Install {
            kind,
            download: taken.path,
            target,
        },
    );
    Ok(Took::Taken)
}
