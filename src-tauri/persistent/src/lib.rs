//! The CLI service within the persistent runtime.
//!
//! It owns running shells, their output, agent reports and stored documents.
//! Ephemeral rendering updates leave both this service and the native window
//! host alive. Persistent updates install a bundle and restart totex with its
//! matching service and views. `LINE` describes the socket protocol; view
//! compatibility is determined by the frontend host identity, not that number.

pub mod door;
pub mod serve;
pub mod session;
pub mod store;
mod stream;
pub mod talk;
#[cfg(test)]
mod tests;
pub mod update;
pub mod wire;

use std::path::PathBuf;
use std::sync::Arc;

pub use door::Door;
pub use session::Sessions;
pub use store::Store;

/// The version of this program, which is the app's own.
pub const VERSION: &str = env!("CARGO_PKG_VERSION");

/// The line this program is on: `major.minor` of [`VERSION`], as one number.
///
/// What the two ends of the socket have to agree on. A window and a program
/// on the same line ask and answer the same questions, whatever the patch
/// number of either — that is what a patch release promises, and what
/// `.github/workflows/release.yml` refuses to cut one that breaks. A window
/// that finds a program on another line cannot ask it anything, and replaces
/// it at the cost of what it holds — which is the one cost this arrangement
/// exists to avoid, paid once per minor release and never otherwise.
///
/// Said on the wire under the name the line before this one gave it — see
/// [`wire::hello`] — so that a window from earlier in the line reads it as the
/// same number it always read.
pub const LINE: u32 =
    number(env!("CARGO_PKG_VERSION_MAJOR")) * 1000 + number(env!("CARGO_PKG_VERSION_MINOR"));

/// A decimal number out of a string cargo wrote, at compile time.
const fn number(text: &str) -> u32 {
    let bytes = text.as_bytes();
    let mut found = 0u32;
    let mut at = 0;
    while at < bytes.len() {
        found = found * 10 + (bytes[at] - b'0') as u32;
        at += 1;
    }
    found
}

/// The line a version is on, read the same way as [`LINE`] at runtime, or
/// nothing for a string that is not a version.
pub fn line_of(version: &str) -> Option<u32> {
    let mut parts = version.split('.');
    let major: u32 = parts.next()?.parse().ok()?;
    let minor: u32 = parts.next()?.parse().ok()?;
    Some(major * 1000 + minor)
}

/// Everything this program holds.
pub struct Persistent {
    pub sessions: Arc<Sessions>,
    pub door: Arc<Door>,
    pub store: Store,
    /// Where the store keeps its documents, or nothing on a machine with no
    /// data directory — which is a machine where nothing is remembered past
    /// this run.
    pub home: Option<PathBuf>,
}

impl Persistent {
    /// Everything, empty, and joined together.
    pub fn new(home: Option<PathBuf>) -> Arc<Self> {
        let sessions = Arc::new(Sessions::default());
        let door = Door::new(Arc::clone(&sessions));
        let store = Store::at(home.as_ref().map(|home| home.join("store")));
        Arc::new(Self {
            sessions,
            door,
            store,
            home,
        })
    }
}

/// A whole-runtime installation must start the bundled session service even on the same protocol line.
pub const RESTART_RUNTIME: &str = "--totex-update-runtime";

#[cfg(test)]
mod line {
    use super::*;

    #[test]
    fn the_line_is_the_major_and_the_minor_and_not_the_patch() {
        assert_eq!(line_of("0.1.30"), Some(1));
        assert_eq!(line_of("0.1.31"), Some(1));
        assert_eq!(line_of("0.2.0"), Some(2));
        assert_eq!(line_of("1.0.0"), Some(1000));
        assert_eq!(line_of("nonsense"), None);
        assert_eq!(line_of(VERSION), Some(LINE));
    }
}
