//! Signed ephemeral artifacts served by the persistent native host.
//!
//! A release contains rendering expressions and styles plus a bootstrap for a
//! fresh launch. Live updates load only the expressions and styles: the document,
//! React runtime, hooks, effects, module stores and CLI connections stay alive.
//! The exact host identity in ephemeral.json defines compatibility, so one host
//! can accept multiple view releases without relying on their version numbering.
//!
//! Downloads are staged until the live document confirms activation. A failure
//! restores the previous selection; an interrupted activation is recovered at
//! startup. Assets referenced by the existing host remain reachable after a swap.

mod assets;
mod serving;
pub mod take;
#[cfg(test)]
mod tests;

use std::path::PathBuf;

use semver::Version;
use serde::{Deserialize, Serialize};

/// Set in the environment, this run is drawn out of the binary whatever is on
/// disk — and what is on disk is deleted on the way past.
const BUILT_IN: &str = "TOTEX_BUILT_IN_FRONT";

/// What is written beside an unpacked front, saying what it is.
#[derive(Serialize, Deserialize)]
struct Taken {
    /// The release the front came out of.
    version: String,
    /// The agreement those pages were built against, which the program they
    /// are served by has to be at least at. Written down rather than checked
    /// once at the moment of taking, because the program underneath can move
    /// afterwards: taking an older release replaces it with one whose
    /// agreement is older too, and pages the run before this one was allowed
    /// to serve are not therefore pages this one is.
    ///
    /// Absent from a file written before this was, which is a front no run
    /// that reads this will serve anyway -- see [`serving::keep`], where a
    /// front has to be newer than the binary, and a binary carrying this is
    /// newer than any front taken without it.
    #[serde(default)]
    needs: u32,
    /// Whether these pages were asked for by name.
    ///
    /// The rule is that a front is served while it is newer than the program,
    /// which is what makes a front left lying about harmless: a copy that
    /// replaces itself the whole way arrives carrying newer pages, and the
    /// taken ones are overtaken and deleted rather than left standing in front
    /// of them.
    ///
    /// Pages somebody chose are the exception, and they are an exception on
    /// purpose: choosing the release you were on last week is the whole of what
    /// choosing is for. So they are held in place until something is chosen
    /// instead, or until the program under them is replaced -- see
    /// [`Serving::drop_front`], which is what a step in the program's own row
    /// does to a front pinned over the top of it.
    #[serde(default)]
    pinned: bool,
    /// Whether a window has ever finished drawing itself out of it.
    confirmed: bool,
}

/// The name that file is kept under.
const TAKEN: &str = "taken.json";
const PREVIOUS: &str = "previous.json";

/// A front on disk, and what it says it is.
#[derive(Clone)]
struct Unpacked {
    dir: PathBuf,
    version: Version,
    /// The agreement it was built against -- see [`Taken::needs`].
    needs: u32,
    /// Whether it was asked for by name -- see [`Taken::pinned`].
    pinned: bool,
}

/// What answers for a file the front being served has not got.
///
/// Only ever anything between a front arriving and a window being drawn out of
/// it: what the window on the screen was being served from, kept reachable for
/// as long as that window is the one on the screen. See the module docs.
#[derive(Clone)]
enum Behind {
    /// Nothing. What the front has is what there is.
    Nothing,
    /// The front built into the binary.
    BuiltIn,
    /// A front taken earlier, still lying under its own version.
    Taken(PathBuf),
}

/// The two together, so that pointing at a front and saying what it replaced
/// is one movement rather than two a page can be read between.
#[derive(Clone)]
struct Held {
    /// The taken front being served, or nothing for the built-in one.
    at: Option<Unpacked>,
    behind: Behind,
}

pub use assets::{Front, Nothing};
pub use serving::Serving;
