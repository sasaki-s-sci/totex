//! What the app remembers about updating itself.
//!
//! Which release each layer is pointed at, and which cycle each of them
//! follows. Small, and kept by this program rather than by the window on
//! purpose: two of the three layers are replaced while the app is running, and
//! neither of them is a place anything can be kept. The pages are thrown away
//! and drawn again; the application layer is a program that is started and let
//! go of. So everything either of them would want remembered is remembered
//! here, by the one layer that is still there afterwards.
//!
//! That is also why it is a file rather than something in the window's own
//! storage: a window drawn out of a front that was rolled back is a window that
//! would find whatever the newer pages had written, in whatever shape those
//! pages wrote it.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::RwLock;

use serde::{Deserialize, Serialize};

use crate::release::Cycles;

use super::Layer;

/// The name it is kept under, beside the front and the layer.
const KEPT: &str = "update.json";

/// What was remembered, as it is written down.
#[derive(Default, Deserialize, Serialize)]
struct Written {
    /// Which cycle each layer follows. A layer that is not in here follows the
    /// app's own, which is what every layer does until it is told otherwise.
    #[serde(default)]
    cycles: HashMap<Layer, Cycles>,
    /// Which version each layer is pointed at, where one was named by hand.
    #[serde(default)]
    picked: HashMap<Layer, String>,
}

/// The same, in memory, with somewhere to write it.
pub struct Kept {
    at: Option<PathBuf>,
    written: RwLock<Written>,
}

impl Kept {
    /// Reads back what the last run was left pointed at.
    ///
    /// A file that will not read is one that is started again from nothing:
    /// what is in it is three versions and three names, and there is nothing in
    /// there worth refusing to open a window over.
    pub fn prepare(identifier: &str) -> Self {
        Self::at(dirs::data_dir().map(|dir| dir.join(identifier).join(KEPT)))
    }

    /// The same, told where to keep it.
    pub fn at(at: Option<PathBuf>) -> Self {
        let written = at
            .as_ref()
            .and_then(|at| std::fs::read(at).ok())
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or_default();
        Self {
            at,
            written: RwLock::new(written),
        }
    }

    /// Which cycle one layer follows.
    pub fn cycle(&self, layer: Layer) -> Cycles {
        self.written
            .read()
            .ok()
            .and_then(|written| written.cycles.get(&layer).copied())
            .unwrap_or(Cycles::Release)
    }

    /// Which version one layer is pointed at, if one was named.
    pub fn picked(&self, layer: Layer) -> Option<String> {
        self.written
            .read()
            .ok()
            .and_then(|written| written.picked.get(&layer).cloned())
    }

    /// Points one layer at a version, or at whatever is newest.
    pub fn pick(&self, layer: Layer, version: Option<String>) {
        self.change(|written| match version {
            Some(version) => {
                written.picked.insert(layer, version);
            }
            None => {
                written.picked.remove(&layer);
            }
        });
    }

    /// Points one layer at a cycle of releases.
    ///
    /// Whatever it was pointed at goes with it: a version of one cycle is not a
    /// version of another, and a row left naming one while looking at the other
    /// is a row that would take something nobody asked for.
    pub fn follow(&self, layer: Layer, cycle: Cycles) {
        self.change(|written| {
            written.cycles.insert(layer, cycle);
            written.picked.remove(&layer);
        });
    }

    /// Changes it and writes it down.
    ///
    /// Written every time rather than on the way out: what closes this app is
    /// as often the restart at the end of an update as anything else, and a
    /// choice that only survives a graceful ending is not one that survives the
    /// thing it is for.
    fn change(&self, change: impl FnOnce(&mut Written)) {
        let Ok(mut written) = self.written.write() else {
            return;
        };
        change(&mut written);
        let Some(at) = &self.at else {
            return;
        };
        let Ok(bytes) = serde_json::to_vec(&*written) else {
            return;
        };
        if let Some(home) = at.parent() {
            let _ = std::fs::create_dir_all(home);
        }
        let _ = std::fs::write(at, bytes);
    }
}
