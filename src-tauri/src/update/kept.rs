//! What the app remembers about updating itself.
//!
//! Which release the update row is pointed at, where one was named. Small, and kept
//! by this program rather than by the pages on purpose: the pages are thrown
//! away and drawn again, and a window drawn out of pages that were rolled back
//! is a window that would find whatever the newer pages had written, in
//! whatever shape those pages wrote it. A file of this program's own is read
//! the same way by every version of it.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::RwLock;

use serde::{Deserialize, Serialize};

use super::Layer;

/// The name it is kept under, in the app's data directory.
const KEPT: &str = "update.json";

/// What was remembered, as it is written down.
#[derive(Default, Deserialize, Serialize)]
struct Written {
    /// The one version the row is pointed at, where one was named by hand. A
    /// release is a patch or a minor by its number alone, so there is one row
    /// and one pin: the release named is the pages, and the program too where
    /// its line differs from the one running.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    version: Option<String>,
    /// What copies from before the rows were one row wrote: a version per
    /// layer. Read, never written again -- see [`Kept::picked`].
    #[serde(default, deserialize_with = "known", skip_serializing)]
    picked: HashMap<Layer, String>,
}

/// Reads the map above, leaving out every entry this build has no name for.
///
/// The file outlives the builds that write it. A row that an older copy kept
/// and a newer one no longer draws is an entry under a name nothing here
/// answers to, and the choice is between reading the rest of the file and
/// reading none of it — which would be every row somebody set, forgotten for
/// the sake of one that is not there any more. The same goes for keys an
/// older copy wrote beside this one, which serde reads past.
fn known<'de, D, V>(deserializer: D) -> Result<HashMap<Layer, V>, D::Error>
where
    D: serde::Deserializer<'de>,
    V: serde::de::DeserializeOwned,
{
    let written: HashMap<String, serde_json::Value> = HashMap::deserialize(deserializer)?;
    Ok(written
        .into_iter()
        .filter_map(|(layer, value)| {
            let layer = serde_json::from_value(serde_json::Value::String(layer)).ok()?;
            let value = serde_json::from_value(value).ok()?;
            Some((layer, value))
        })
        .collect())
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
    /// what is in it is a version or two, and there is nothing in there worth
    /// refusing to open a window over.
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

    /// Which version the row is pointed at, if one was named.
    ///
    /// A file from before the rows were one row named a version per layer.
    /// The pages' pin is the one read out of it, since that is the row that
    /// moved most and the one whose version is what is drawn; the program's
    /// pin stands in where there was no other.
    pub fn picked(&self) -> Option<String> {
        self.written.read().ok().and_then(|written| {
            written.version.clone().or_else(|| {
                [Layer::Ephemeral, Layer::Front, Layer::Persistent]
                    .iter()
                    .find_map(|layer| written.picked.get(layer).cloned())
            })
        })
    }

    /// Points the row at a version, or at whatever is newest.
    pub fn pick(&self, version: Option<String>) {
        self.change(|written| {
            written.version = version;
            // Named once, under one name: what an older copy wrote per layer
            // is not read past this pin again.
            written.picked.clear();
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
