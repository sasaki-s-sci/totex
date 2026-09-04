//! Replacing this copy of the app, a layer at a time.
//!
//! The app is two layers and they are taken apart from one another, because
//! they cost different things to replace and nobody should pay the expensive
//! one by having pressed the cheap one.
//!
//! **The pages.** About a megabyte, and it ends in a reload. The program
//! underneath is untouched, so every terminal it is holding stays open and is
//! redrawn from its own backlog as the window comes back. See [`crate::front`].
//!
//! **The program.** That is the installer, and it is the one layer that cannot
//! be put in underneath a window that is open. So a press is the download and
//! nothing else, and what puts the release in is the app being closed — see
//! [`waiting`]. Nothing goes away while somebody is working; the next start is
//! the one on the new release. It is a row of its own because it is a different
//! cost, and this is that cost paid where it costs nothing.
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
//! That is the whole answer for the program, and it is not the answer for the
//! pages. They are kept in the app's own data directory and touch nothing
//! anything else owns, so a `.deb` and an `.rpm` are copies that can be brought
//! forward half the way, and are offered exactly that half.
//!
//! A binary run straight out of `target/` is offered nothing. It was never
//! installed, so there is nothing for an installer to overwrite, and the pages
//! it draws are the ones somebody just built, which taking a release's over
//! would quietly undo.
//!
//! ## Naming a version
//!
//! Every layer takes a version rather than "whatever is newest", and the same
//! version can be handed to both. That is what makes a release page something
//! to choose from rather than a direction to be carried in: the pages of 0.1.9
//! can be tried on the program of 0.1.7, and what is running can be said
//! exactly rather than described as "the latest".
//!
//! ## And which releases a layer is looking at
//!
//! One more choice per layer, and it is the one that makes them independent for
//! real: which cycle its releases are cut on — see [`crate::release::cycle`].
//! Left alone, both follow the app's own, which is the arrangement where one
//! release moves everything.

mod core;
mod kept;
#[cfg(test)]
mod tests;
/// A release that is down and waiting for the app to be closed, which is only
/// ever a thing on a desktop: the updater the whole of this rests on is not
/// built for a phone.
#[cfg(desktop)]
mod waiting;

use serde::{Deserialize, Serialize};
use tauri::ipc::Channel;
use tauri::utils::config::BundleType;
use tauri::utils::platform::bundle_type;
use tauri::{AppHandle, Manager, Runtime};

use crate::front::Serving;
use crate::release::Cycles;

pub use kept::Kept;
#[cfg(desktop)]
pub use waiting::Waiting;

/// Which of the two a row is about.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Layer {
    /// The pages the window is drawn out of.
    Front,
    /// The program itself.
    Core,
}

/// The two of them, in the order the rows are drawn: cheapest first.
pub const LAYERS: [Layer; 2] = [Layer::Front, Layer::Core];

/// What a press on one layer found, which is also what was done.
#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Took {
    /// It is here. What is left is whatever finishes it — a reload for the
    /// pages, the next start of the app for the program.
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
    /// Which cycle this layer's releases are cut on.
    pub cycle: Cycles,
    /// The version it is pointed at, if one has been named.
    pub picked: Option<String>,
    /// The newest front contract this program answers, on the program row.
    pub front_contract: Option<u32>,
}

/// What the update rows are drawn from.
///
/// Asked again after every press rather than once for the life of the window,
/// because what a press did is what the rows are drawn from.
#[tauri::command]
pub fn update_standing<R: Runtime>(app: AppHandle<R>) -> Vec<Rung> {
    let serving = app.state::<std::sync::Arc<Serving>>();
    let kept = app.state::<std::sync::Arc<Kept>>();

    LAYERS
        .into_iter()
        .map(|layer| Rung {
            layer,
            at: match layer {
                Layer::Front => serving.version().to_string(),
                Layer::Core => env!("CARGO_PKG_VERSION").to_string(),
            },
            can: match layer {
                // Somewhere to keep a front is as much a condition as having
                // been installed: a machine with no data directory can only
                // ever run the pages it was installed with.
                Layer::Front => bundle_type().is_some() && serving.keeps(),
                Layer::Core => whole_update_supported(),
            },
            cycle: kept.cycle(layer),
            picked: kept.picked(layer),
            front_contract: (layer == Layer::Core).then_some(crate::front::take::contract()),
        })
        .collect()
}

/// Takes one layer of one release, or says why this copy cannot.
///
/// The one press behind both rows. What it ends in is the layer's own: pages
/// are unpacked and pointed at, and a program is installed and waits for the
/// restart.
#[tauri::command]
pub async fn update_take<R: Runtime>(
    app: AppHandle<R>,
    layer: Layer,
    version: Option<String>,
    coming: Channel<Coming>,
) -> Result<Took, String> {
    let cycle = app.state::<std::sync::Arc<Kept>>().cycle(layer).cycle();
    match layer {
        Layer::Front => {
            crate::front::take::take_front(&app, &cycle, version.as_deref(), &coming).await
        }
        Layer::Core => core::take_core(&app, &cycle, version.as_deref(), &coming).await,
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
    // one nothing is pointed at any more — see [`waiting`]. Asked here rather
    // than on [`update_follow`] because every move of a row ends in a pick: a
    // row sent to another cycle is a row that names a version of that cycle a
    // moment later, and that is the naming worth reading.
    #[cfg(desktop)]
    if layer == Layer::Core {
        app.state::<std::sync::Arc<Waiting>>()
            .let_go_unless(version.as_deref());
    }
    app.state::<std::sync::Arc<Kept>>().pick(layer, version);
}

/// Points one layer at a different cycle of releases, and remembers that too.
#[tauri::command]
pub fn update_follow<R: Runtime>(app: AppHandle<R>, layer: Layer, cycle: Cycles) {
    app.state::<std::sync::Arc<Kept>>().follow(layer, cycle);
}

/// Whether the updater can replace the whole of this copy in place.
pub fn whole_update_supported() -> bool {
    matches!(
        bundle_type(),
        Some(BundleType::App | BundleType::AppImage | BundleType::Msi | BundleType::Nsis)
    )
}
