//! Two update boundaries: persistent installs and restarts the whole runtime;
//! ephemeral replaces compatible views inside the existing document.
//!
//! What a persistent install costs depends on the line -- see
//! [`totex_persistent::LINE`]. A patch stays on the line, so the service
//! holding the terminals is shared rather than replaced: the program is
//! installed, the window reopened, and the window that comes up finds the
//! shells where they were. A minor turns the line over, and that is the
//! release that puts another service in place and closes them -- the one
//! install that asks for the replacement outright, see
//! [`totex_persistent::RESTART_RUNTIME`] and [`update_restart`], because what
//! it installed is the program that is to hold them from here.

mod kept;
mod program;
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
    /// The native program, session service and stateful frontend host, installed together.
    Persistent,
    /// Compatible rendering expressions and styles, activated without restarting the host.
    Ephemeral,
    /// Legacy wire alias; never displayed as a third independently updatable layer.
    Front,
}

pub const LAYERS: [Layer; 2] = [Layer::Persistent, Layer::Ephemeral];

/// What a press on one layer found, which is also what was done.
#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Took {
    /// Staged: live activation for views, installation and restart for the runtime.
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
    /// The version the row is pointed at, if one has been named. One pin for
    /// both layers, said on each so a window reads it off whichever it holds.
    pub picked: Option<String>,
    /// The newest front contract this program answers, on the ephemeral row.
    pub front_contract: Option<u32>,
    /// Legacy wire field. Runtime choices now come from signed release manifests.
    pub held: Vec<String>,
    pub ephemeral_contract: String,
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
                Layer::Persistent => env!("CARGO_PKG_VERSION").to_string(),
                Layer::Ephemeral | Layer::Front => serving.version().to_string(),
            },
            can: match layer {
                Layer::Persistent => whole_update_supported(),
                Layer::Ephemeral | Layer::Front => bundle_type().is_some() && serving.keeps(),
            },
            picked: kept.picked(),
            front_contract: Some(crate::front::take::contract()),
            held: Vec::new(),
            ephemeral_contract: crate::front::take::runtime_contract().to_string(),
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
    let _updating = Updating::begin()?;
    if app.state::<std::sync::Arc<Serving>>().pending() {
        return Err("an ephemeral update is waiting for activation".to_string());
    }
    match layer {
        Layer::Persistent => program::take_persistent(&app, version.as_deref(), &coming).await,
        Layer::Ephemeral | Layer::Front => {
            crate::front::take::take_front(&app, version.as_deref(), &coming).await
        }
    }
}

/// Leaves the row pointed at one version, and remembers it.
///
/// Remembered by this program rather than by the window, which is the rule the
/// layers are arranged around: the pages are replaced, and they are not where
/// anything is kept. So a row that was left on a version is on it again after a
/// reload, and after the restart that a program takes.
#[tauri::command]
pub fn update_pick<R: Runtime>(app: AppHandle<R>, version: Option<String>) {
    // The row moved, and a release that came down for where it used to point is
    // one nothing is pointed at any more — see [`ready`].
    app.state::<std::sync::Arc<Ready>>()
        .let_go_unless(version.as_deref());
    app.state::<std::sync::Arc<Kept>>().pick(version);
}

/// Install the persistent bundle after this process exits, then relaunch totex.
///
/// The next run opens the views bundled with it. Whether it goes on with the
/// CLI service already running or replaces it is the line's to say: a release
/// on the running line is a patch, and a patch never ends a terminal, so the
/// window reopens over the service it left. A release on another line cannot
/// speak to that service, and asks for the replacement outright.
#[tauri::command(async)]
pub fn update_restart<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    let (version, install) = app
        .state::<std::sync::Arc<Ready>>()
        .take()
        .ok_or_else(|| "no release has come down".to_string())?;
    let args = if totex_persistent::line_of(&version) == Some(totex_persistent::LINE) {
        Vec::new()
    } else {
        vec![totex_persistent::RESTART_RUNTIME.to_string()]
    };
    let program = match install.kind {
        // What the runtime mounted is what is started again, not the program
        // inside the mount that is about to go away.
        totex_persistent::update::Kind::AppImage => install.target.clone(),
        totex_persistent::update::Kind::App => install.target.join("Contents/MacOS/totex"),
        totex_persistent::update::Kind::Nsis | totex_persistent::update::Kind::Msi => {
            install.target.clone()
        }
    };
    crate::persistent::link(&app).relaunch(&program, &args, Some(&install))?;
    // The new runtime starts with the views shipped with it. The pin stays: a
    // row pointed at the release just installed is pointed at what is drawn.
    app.state::<std::sync::Arc<Serving>>().drop_front();
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

/// The platform key used by both release choices and the actual installer download.
pub(crate) fn program_platform() -> Option<String> {
    program::standing().map(|(platform, _, _)| platform)
}

static UPDATING: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
struct Updating;
impl Updating {
    fn begin() -> Result<Self, String> {
        UPDATING
            .compare_exchange(
                false,
                true,
                std::sync::atomic::Ordering::SeqCst,
                std::sync::atomic::Ordering::SeqCst,
            )
            .map(|_| Self)
            .map_err(|_| "an update is already in progress".to_string())
    }
}
impl Drop for Updating {
    fn drop(&mut self) {
        UPDATING.store(false, std::sync::atomic::Ordering::SeqCst);
    }
}
