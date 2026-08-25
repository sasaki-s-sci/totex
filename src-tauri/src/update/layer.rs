//! Taking the application layer, which costs nothing anybody is looking at.
//!
//! A small program, checked against the key the app is released with, put under
//! its version, started, and asked the next question. The one before it is let
//! go of rather than killed — see [`crate::app_layer`] — so a swap in the middle
//! of a directory being read is a directory that still gets read, and a swap
//! while eleven terminals are running is eleven terminals that never find out.

use std::sync::Arc;

use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, Runtime};

use crate::app_layer::Layers;
use crate::release::{self, Cycle};

use super::{Coming, Took};

/// The most of a layer that will be read off the network.
///
/// The layer is a program with no window in it, which is a small number of
/// megabytes. This is not a size anything is expected to reach — it is what
/// stops a URL that answers forever from filling memory, which is the one thing
/// an unbounded read of somebody else's server can be made to do before a
/// signature has been checked.
const MOST: usize = 64 * 1024 * 1024;

/// Takes the application layer of one release, or says why it is not this
/// copy's to take.
pub async fn take_layer<R: Runtime>(
    app: &AppHandle<R>,
    cycle: &Cycle,
    version: Option<&str>,
    coming: &Channel<Coming>,
) -> Result<Took, String> {
    let layers = Arc::clone(app.state::<Arc<Layers>>().inner());
    if !layers.keeps() {
        return Ok(Took::Held);
    }
    let (endpoint, key) = release::declared(app)?;

    let manifest = release::read(&endpoint, cycle, version).await?;
    if manifest.version == layers.version() {
        // This is the layer that is answering. Whether it was taken or is the
        // one built in, there is nothing here left to take.
        return Ok(Took::Current);
    }
    let Some(entry) = manifest.layers.get(&release::target()) else {
        // A release with no layer for this machine keeps its layer inside its
        // program, which is the row underneath.
        return Ok(Took::Held);
    };
    if entry.protocol != totex_layer::PROTOCOL {
        // A layer that speaks a different conversation is one this program
        // could start and then not be able to ask anything. Said before the
        // download rather than after it.
        return Ok(Took::Held);
    }

    let version = manifest.version.clone();
    let packed = release::fetch::along(&entry.url, MOST, |taken, length| {
        Coming::say(coming, taken, length);
    })
    .await?;
    let signature = entry.signature.clone();

    // Everything left is the disk and a program being started, and neither is
    // the event loop's to wait on.
    let put = tauri::async_runtime::spawn_blocking(move || {
        crate::front::take::ours(&packed, &signature, &key)?;
        layers.put(&version, &packed)
    })
    .await
    .map_err(|error| format!("the layer was not put in place: {error}"))??;

    Ok(put)
}
