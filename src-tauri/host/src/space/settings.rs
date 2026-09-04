//! What a space says about the terminals opened in it.

use std::path::Path;

use serde::{Deserialize, Serialize};

use super::DIR;
use crate::host::Host;

/// What the settings of a space are written in.
const FILE: &str = "settings.json";

/// What a space says, as the file says it.
///
/// Every field has a default and the whole file is optional, so a space that
/// says one thing is a file with one line in it. What is absent is not a gap to
/// fill in but a question nobody there has been asked — which is why the
/// defaults are the behaviour this window had before spaces existed at all.
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    /// Whether a session started here is handed this window's own door.
    ///
    /// On unless it is turned off, because the switch that opens the door at
    /// all is already off until somebody asks for it — see `mcp::serve`. Asking
    /// twice, once for the machine and again for every folder on it, would mean
    /// a server somebody turned on that nothing could reach. So a space is
    /// where the answer is narrowed rather than where it is given: `.totex`
    /// appears here to say *not this one*.
    pub mcp: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self { mcp: true }
    }
}

/// What the space around `path` says, or what every space says by default.
///
/// Never an error. A file that will not parse, a folder that cannot be read, a
/// space that was never made: each of them is a space that has said nothing,
/// and a terminal is opened either way. The alternative would be a window that
/// refuses to start a shell because of a stray comma in a settings file.
pub fn settings(path: &Path) -> Settings {
    let Some(space) = super::find(path) else {
        return Settings::default();
    };
    read(&space).unwrap_or_default()
}

pub fn read(space: &Path) -> Option<Settings> {
    let host = Host::of(space);
    let file = host.join(&host.join(space, DIR), FILE);
    serde_json::from_slice(&host.read(&file).ok()?).ok()
}

/// Writes what a space is to be told, making the space where there is none.
///
/// Answers with the folder it wrote in. The caller asked about a folder and the
/// answer is about a space, and those are the same place only until the first
/// time somebody presses this in a pane opened halfway down a checkout — see
/// `home`.
pub fn tell(path: &Path, settings: Settings) -> Result<String, String> {
    let space = super::holding(path);
    let host = Host::of(&space);
    let dir = host.join(&space, DIR);
    let file = host.join(&dir, FILE);

    // Pretty, and with the newline a text file ends with. This is a file people
    // open in an editor and add lines to by hand; what this window writes has
    // to look like what they would have written.
    let mut text = serde_json::to_string_pretty(&settings).map_err(|error| error.to_string())?;
    text.push('\n');

    host.create_dir_all(&dir)?;
    match host.stat(&file) {
        // Written over what is there, told how long that was: the write refuses
        // where the file has changed underneath, which is the same guard every
        // other write in this app goes through.
        Some(stat) => host.write(&file, &text, stat.size).map(|_| ())?,
        None => host.write_new(&file, text.as_bytes())?,
    }

    Ok(space.to_string_lossy().into_owned())
}
