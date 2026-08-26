//! Replacing this copy of the app, a layer at a time.
//!
//! The app is three layers and they are taken apart from one another, because
//! they cost different things to replace and nobody should pay the expensive
//! one by having pressed the cheap one.
//!
//! **The pages.** About a megabyte, and it ends in a reload. The program
//! underneath is untouched, so every terminal it is holding stays open and is
//! redrawn from its own backlog as the window comes back. See [`crate::front`].
//!
//! **The application layer.** A small program beside this one, holding
//! everything the app asks of the machine that is a question rather than a
//! thing being kept — see [`crate::app_layer`]. It ends in nothing at all: the
//! new one is started, the old one is let go of between two questions, and the
//! window does not even blink.
//!
//! **The program.** That is the installer, and it ends in a restart — which
//! ends every terminal with it. It is a row of its own because it is a
//! different cost.
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
//! other two. The pages and the layer are kept in the app's own data directory
//! and touch nothing anything else owns, so a `.deb` and an `.rpm` are copies
//! that can be brought forward two thirds of the way, and are offered exactly
//! those two thirds.
//!
//! A binary run straight out of `target/` is offered the layer and nothing
//! else. It was never installed, so there is nothing for an installer to
//! overwrite, and the pages it draws are the ones somebody just built, which
//! taking a release's over would quietly undo. The layer is neither of those:
//! it is a program of its own, checked against what this one speaks before it
//! is run at all, and dropped by pressing one row — which is what makes it the
//! one third of this that can be tried without cutting a release first.
//!
//! ## Naming a version
//!
//! Every layer takes a version rather than "whatever is newest", and the same
//! version can be handed to all three. That is what makes a release page
//! something to choose from rather than a direction to be carried in: the pages
//! of 0.1.9 can be tried on the program of 0.1.7, a layer that turned out worse
//! can be put back, and what is running can be said exactly rather than
//! described as "the latest".
//!
//! ## And which releases a layer is looking at
//!
//! One more choice per layer, and it is the one that makes them independent for
//! real: which cycle its releases are cut on — see [`crate::release::cycle`].
//! Left alone, all three follow the app's own, which is the arrangement where
//! one release moves everything.

mod core;
mod kept;
pub(crate) mod layer;
#[cfg(test)]
mod tests;

use serde::{Deserialize, Serialize};
use tauri::ipc::Channel;
use tauri::utils::config::BundleType;
use tauri::utils::platform::bundle_type;
use tauri::{AppHandle, Manager, Runtime};

use crate::app_layer::Layers;
use crate::front::Serving;
use crate::release::Cycles;

pub use kept::Kept;

/// Which of the three a row is about.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Layer {
    /// The pages the window is drawn out of.
    Front,
    /// The application layer running beside the program.
    App,
    /// The program itself.
    Core,
}

/// The three of them, in the order the rows are drawn: cheapest first.
pub const LAYERS: [Layer; 3] = [Layer::Front, Layer::App, Layer::Core];

/// What a press on one layer found, which is also what was done.
#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Took {
    /// It is here. What is left is whatever finishes it — a reload for the
    /// pages, a restart for the program, and nothing at all for the layer.
    Taken,
    /// Nothing to do: that release is what is already being drawn, or already
    /// running, or already answering.
    Current,
    /// There is a release and this layer cannot bring it. The pages of it are
    /// the program's to bring, or the program is the package manager's, or the
    /// layer it carries talks a language this program does not.
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
    /// The version in place now — being drawn, answering, or running.
    pub at: String,
    /// Whether this copy can replace this layer at all.
    pub can: bool,
    /// Which cycle this layer's releases are cut on.
    pub cycle: Cycles,
    /// The version it is pointed at, if one has been named.
    pub picked: Option<String>,
    /// The application-layer conversation this layer speaks, where it has one.
    pub protocol: Option<u32>,
    /// The newest front contract this program answers, on the program row.
    pub front_contract: Option<u32>,
}

/// What the update rows are drawn from.
///
/// Asked again after every press rather than once for the life of the window,
/// because one of the three moves without either a reload or a restart: a layer
/// that has just been taken is answering questions already, and the row has to
/// say so.
#[tauri::command]
pub fn update_standing<R: Runtime>(app: AppHandle<R>) -> Vec<Rung> {
    let serving = app.state::<std::sync::Arc<Serving>>();
    let layers = app.state::<std::sync::Arc<Layers>>();
    let kept = app.state::<std::sync::Arc<Kept>>();

    LAYERS
        .into_iter()
        .map(|layer| Rung {
            layer,
            at: match layer {
                Layer::Front => serving.version().to_string(),
                Layer::App => layers.version(),
                Layer::Core => env!("CARGO_PKG_VERSION").to_string(),
            },
            can: match layer {
                // Somewhere to keep a front is as much a condition as having
                // been installed: a machine with no data directory can only
                // ever run the pages it was installed with.
                Layer::Front => bundle_type().is_some() && serving.keeps(),
                // And the layer asks only for somewhere to keep one. Not for
                // having been installed, because unlike the other two it is
                // nothing to do with how this copy got here: it is a program
                // started beside this one, checked before it is run and dropped
                // by pressing the row again.
                Layer::App => layers.keeps(),
                Layer::Core => whole_update_supported(),
            },
            cycle: kept.cycle(layer),
            picked: kept.picked(layer),
            protocol: matches!(layer, Layer::App | Layer::Core).then_some(totex_layer::PROTOCOL),
            front_contract: (layer == Layer::Core).then_some(crate::front::take::contract()),
        })
        .collect()
}

/// Takes one layer of one release, or says why this copy cannot.
///
/// The one press behind all three rows. What it ends in is the layer's own:
/// pages are unpacked and pointed at, a layer is started and asked the next
/// question, and a program is installed and waits for the restart.
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
        Layer::App => layer::take_layer(&app, &cycle, version.as_deref(), &coming).await,
        Layer::Core => core::take_core(&app, &cycle, version.as_deref(), &coming).await,
    }
}

/// Leaves one layer pointed at one version, and remembers it.
///
/// Remembered by this program rather than by the window, which is the rule the
/// three layers are arranged around: the pages are replaced and the layer is
/// replaced, and neither of them is where anything is kept. So a row that was
/// left on a version is on it again after a reload, after a layer has been
/// swapped, and after the restart that a program takes.
#[tauri::command]
pub fn update_pick<R: Runtime>(app: AppHandle<R>, layer: Layer, version: Option<String>) {
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
