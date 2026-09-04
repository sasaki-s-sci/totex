//! Replacing this copy of the app, one half at a time.
//!
//! The app is two halves, and they are taken apart from one another because
//! they cost different things to replace and nobody should pay the expensive
//! one by having pressed the cheap one.
//!
//! **The ephemeral half.** This program — the window, the commands it answers
//! and the pages it draws — and everything in it can be thrown away and drawn
//! again. Replacing it is the installer, and an installer cannot be put in
//! underneath a window that is open. So a press is the download and nothing
//! else, and what puts the release in is this window leaving so that the next
//! can take its place — see [`ready`] and [`update_restart`]. The terminals
//! are not in this window, so nothing anybody was working on goes with it: the
//! window closes, the release goes in, and the window opens again on it in
//! front of the same terminals.
//!
//! **The persistent half.** The program beside this one that holds the
//! terminals — see `totex_persistent`. Never taken by a row: it comes with a
//! release of the ephemeral half, and which releases replace it is said by the
//! version number itself. A patch release leaves it exactly where it is; a
//! minor release is one it cannot be kept across, and the next window says so
//! before it presses — see `totex_persistent::LINE`.
//!
//! **And the pages on their own.** About a megabyte, and a reload. The half
//! of the ephemeral half that a copy can take without an installer, which is
//! the whole of the update a copy the package manager owns can have — see
//! [`crate::front`].
//!
//! ## What a copy can have
//!
//! The updater swaps the thing it is running from, so what it can do depends
//! entirely on what that thing is. An AppImage is one file and is overwritten; a
//! `.app` is a directory and is unpacked over; the two Windows installers are
//! re-run over themselves. A `.deb` or an `.rpm` is none of those — the files
//! belong to the package manager, the app is not running as root, and replacing
//! them behind the manager's back would leave it describing a version that is no
//! longer there. Such a copy is offered its pages and nothing else.
//!
//! A binary run straight out of `target/` is offered nothing. It was never
//! installed, so there is nothing for an installer to overwrite, and the pages
//! it draws are the ones somebody just built, which taking a release's over
//! would quietly undo.
//!
//! ## Naming a version
//!
//! The row takes a version rather than "whatever is newest". That is what
//! makes a release page something to choose from rather than a direction to
//! be carried in: the release of last week can be gone back to, and what is
//! running can be said exactly rather than described as "the latest".

mod ephemeral;
mod kept;
mod ready;
#[cfg(test)]
mod tests;

use serde::{Deserialize, Serialize};
use tauri::ipc::Channel;
use tauri::utils::config::BundleType;
use tauri::utils::platform::bundle_type;
use tauri::{AppHandle, Manager, Runtime};

use crate::front::Serving;

pub use kept::Kept;
pub use ready::Ready;

/// Which layer a row is about.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Layer {
    /// The program beside this one that holds the terminals -- see
    /// `totex_persistent`. Not taken from a release page: it comes with a
    /// release of the ephemeral half, and the row offers the ones this
    /// machine holds. Replaced by the next window at the moment the version
    /// says it has to be, or by the one press that ends every terminal -- see
    /// `crate::persistent::persistent_restart`.
    Persistent,
    /// This program, with its pages inside it: what a release replaces.
    Ephemeral,
    /// The pages on their own -- the part of the ephemeral half that can be
    /// taken without an installer, see [`crate::front`].
    Front,
}

/// The three of them, in the order the rows are drawn: the one that cannot be
/// pressed first, because it is what everything else stands on.
pub const LAYERS: [Layer; 3] = [Layer::Persistent, Layer::Ephemeral, Layer::Front];

/// What a press on one layer found, which is also what was done.
#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Took {
    /// It is here. What is left is whatever finishes it — a reload for the
    /// pages, the restart for the program.
    Taken,
    /// Nothing to do: that release is what is already being drawn, or already
    /// running.
    Current,
    /// There is a release and this layer cannot bring it. The pages of it are
    /// the program's to bring, or the program is the package manager's.
    Held,
}

/// How much of a download has arrived, said as it arrives.
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

impl Coming {
    /// Says how far along a download is, and does not mind a window that has
    /// stopped listening — one that was reloaded mid-download is a window whose
    /// download is still worth finishing.
    pub(crate) fn say(channel: &Channel<Coming>, taken: u64, length: Option<u64>) {
        let _ = channel.send(Coming { taken, length });
    }
}

/// One row: which layer, what is in place, and what it is pointed at.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Rung {
    pub layer: Layer,
    /// The version in place now — being drawn, or running.
    pub at: String,
    /// Whether this copy can replace this layer at all.
    pub can: bool,
    /// The version it is pointed at, if one has been named.
    pub picked: Option<String>,
    /// The newest front contract this program answers, on the ephemeral row.
    pub front_contract: Option<u32>,
    /// The versions of this layer this machine holds and could start, on the
    /// persistent row -- see `crate::persistent::held`. Its releases are not
    /// a page somewhere: they are the programs earlier releases left here.
    pub held: Vec<String>,
}

/// What the update rows are drawn from.
///
/// Asked again after every press rather than once for the life of the window,
/// because what a press did is what the rows are drawn from.
#[tauri::command]
pub fn update_standing<R: Runtime>(app: AppHandle<R>) -> Vec<Rung> {
    let serving = app.state::<std::sync::Arc<Serving>>();
    let kept = app.state::<std::sync::Arc<Kept>>();
    let identifier = app.config().identifier.clone();

    LAYERS
        .into_iter()
        .map(|layer| Rung {
            layer,
            at: match layer {
                // What is actually running beside this window, which may be
                // an earlier patch of this line if it is still holding
                // something.
                Layer::Persistent => app
                    .try_state::<std::sync::Arc<crate::persistent::Reached>>()
                    .map(|reached| reached.link().version().to_string())
                    .unwrap_or_default(),
                Layer::Ephemeral => env!("CARGO_PKG_VERSION").to_string(),
                Layer::Front => serving.version().to_string(),
            },
            can: match layer {
                // Replaced by a press only with something to replace it with.
                Layer::Persistent => !crate::persistent::held_versions(&identifier).is_empty(),
                Layer::Ephemeral => whole_update_supported(),
                // Somewhere to keep a front is as much a condition as having
                // been installed: a machine with no data directory can only
                // ever run the pages it was installed with.
                Layer::Front => bundle_type().is_some() && serving.keeps(),
            },
            picked: kept.picked(layer),
            front_contract: (layer == Layer::Ephemeral).then_some(crate::front::take::contract()),
            held: match layer {
                Layer::Persistent => crate::persistent::held_versions(&identifier),
                Layer::Ephemeral | Layer::Front => Vec::new(),
            },
        })
        .collect()
}

/// Takes one layer of one release, or says why this copy cannot.
///
/// The one press behind the rows. What it ends in is the layer's own: pages
/// are unpacked and pointed at, and a program is brought down and waits for
/// the restart.
#[tauri::command]
pub async fn update_take<R: Runtime>(
    app: AppHandle<R>,
    layer: Layer,
    version: Option<String>,
    coming: Channel<Coming>,
) -> Result<Took, String> {
    match layer {
        // Replaced by a restart and not by a download -- see
        // `crate::persistent::persistent_restart`, which the page asks for
        // instead of this.
        Layer::Persistent => Ok(Took::Held),
        Layer::Ephemeral => ephemeral::take_ephemeral(&app, version.as_deref(), &coming).await,
        Layer::Front => crate::front::take::take_front(&app, version.as_deref(), &coming).await,
    }
}

/// Leaves one layer pointed at one version, and remembers it.
///
/// Remembered by this program rather than by the window, which is the rule the
/// layers are arranged around: the pages are replaced, and they are not where
/// anything is kept. So a row that was left on a version is on it again after a
/// reload, and after the restart that a program takes.
#[tauri::command]
pub fn update_pick<R: Runtime>(app: AppHandle<R>, layer: Layer, version: Option<String>) {
    // The row moved, and a release that came down for where it used to point is
    // one nothing is pointed at any more — see [`ready`].
    if layer == Layer::Ephemeral {
        app.state::<std::sync::Arc<Ready>>()
            .let_go_unless(version.as_deref());
    }
    app.state::<std::sync::Arc<Kept>>().pick(layer, version);
}

/// Leaves, so that the release that came down can go in and the next window
/// can open on it.
///
/// The persistent half is asked to start this program again once this window
/// has gone, with the release put in first; then this window goes. Every
/// terminal stays where it is throughout, because none of them were ever in
/// here. Nothing waiting is a restart with nothing to put in, which is refused
/// rather than made: a window that closes for no reason is a window somebody
/// lost.
#[tauri::command(async)]
pub fn update_restart<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    let install = app
        .state::<std::sync::Arc<Ready>>()
        .take()
        .ok_or_else(|| "no release has come down".to_string())?;
    let program = match install.kind {
        // What the runtime mounted is what is started again, not the program
        // inside the mount that is about to go away.
        totex_persistent::update::Kind::AppImage => install.target.clone(),
        totex_persistent::update::Kind::App => install.target.join("Contents/MacOS/totex"),
        totex_persistent::update::Kind::Nsis | totex_persistent::update::Kind::Msi => {
            install.target.clone()
        }
    };
    crate::persistent::link(&app).relaunch(&program, &[], Some(&install))?;
    app.exit(0);
    Ok(())
}

/// Whether the updater can replace the whole of this copy in place.
pub fn whole_update_supported() -> bool {
    matches!(
        bundle_type(),
        Some(BundleType::App | BundleType::AppImage | BundleType::Msi | BundleType::Nsis)
    )
}
