//! The folder a command line stands in, as the window asks about it.
//!
//! What a space is and where one is found is the machine's business — see
//! `totex_host::space`, which is what the program holding the terminals reads
//! when it dresses a shell. What is here is the window's two questions about
//! one: what the space around a folder says, and telling it something.

use std::path::Path;

use serde::Serialize;

pub use totex_host::space::{DIR, Settings, find, home, read, tell};

/// What a folder's space says, and where the space saying it is.
///
/// Where, because it is rarely the folder that was asked about: a pane opened
/// halfway down a checkout is standing in the space at its root, and a window
/// that drew a switch without saying which folder it was for would be a window
/// quietly setting something somebody else's pane is also showing.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Standing {
    /// The folder holding `.totex`, or the one that would come to hold it.
    pub space: String,
    /// Whether it is there yet. A space that has said nothing is drawn as
    /// saying nothing rather than as agreeing with the defaults.
    pub told: bool,
    pub settings: Settings,
}

/// What the space around a folder says, for the window to draw.
#[tauri::command(async)]
pub fn space_standing(path: String) -> Standing {
    let path = Path::new(&path);
    match find(path) {
        Some(space) => Standing {
            told: true,
            settings: read(&space).unwrap_or_default(),
            space: space.to_string_lossy().into_owned(),
        },
        None => Standing {
            space: home(path).to_string_lossy().into_owned(),
            told: false,
            settings: Settings::default(),
        },
    }
}

/// Tells the space around a folder something, and says what it says afterwards.
#[tauri::command(async)]
pub fn space_tell(path: String, settings: Settings) -> Result<Standing, String> {
    let space = tell(Path::new(&path), settings)?;
    Ok(Standing {
        space,
        told: true,
        settings,
    })
}
