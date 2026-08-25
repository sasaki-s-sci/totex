//! The pages the window is drawn out of, and replacing those on their own.
//!
//! A Tauri app is one file. The program and the pages it draws are built into
//! the same binary, so replacing either normally means replacing both — an
//! installer, and a restart that takes every terminal in the window with it.
//! The restart is the expensive half, and it is expensive for this app in
//! particular: the terminals hold agents that have been working for as long as
//! they have been left to, and a newer drawing of a button is not worth ending
//! one of those.
//!
//! So the pages are taken out from behind the program. Tauri asks whatever the
//! context is holding for every file the window loads, and it will hand that
//! over ([`tauri::Context::set_assets`]) — so [`Front`] stands in front of what
//! was built in and answers out of a directory instead, when there is a newer
//! one on disk. Nothing else about the window changes: the same address, the
//! same IPC, the same content policy the config declares, the same everything
//! that is drawn — because the only thing that has moved is where the bytes of
//! a page are read from.
//!
//! ## Which front a window opens on
//!
//! One rule: a taken front is served only while it is newer than the one built
//! into the binary and no further ahead of it than the two agreed on, and only
//! after a window has finished drawing itself out of it once.
//!
//! The first half is what makes it safe to leave lying about. A copy that
//! replaces itself the whole way, or one a package manager brings forward,
//! arrives carrying its own newer pages — and the taken ones, older now, are
//! deleted rather than left standing in front of them. Nothing has to remember
//! to clean up after a version; being overtaken is what deletes it.
//!
//! The agreement is the same half read from the other side. A front is checked
//! against the program it is being taken onto, and the program underneath it
//! can move afterwards: a version can be named, so the next program to start
//! here can be an older one, with an older agreement. So what a front needs is
//! written down beside it and read again by whichever run is about to serve it
//! — and taking a program says so outright, which is what leaves the release
//! that was asked for standing on its own. See [`Serving::drop_front`].
//!
//! The second is the way back out. A front that cannot draw the window cannot
//! draw the mark that would replace it either, so it is not allowed to be what
//! greets the next start until it has been seen to work: [`take::confirm_front`] is a
//! window saying it got as far as its first paint, and a front that has never
//! said it is dropped on the way up. One restart is the whole of the recovery.
//! `TOTEX_BUILT_IN_FRONT` set in the environment is the same recovery for
//! somebody who would rather not have to guess.
//!
//! ## All of one front or none of it
//!
//! [`Front::get`] does not fall back to the built-in file when the front being
//! served has not got one. Half of one build and half of another is a window
//! nobody has ever run: the names under `assets/` carry a hash of what is in
//! them, so a page asking for a file its own build does not have is a front
//! that did not arrive whole — and a blank window, gone again on the next
//! start, is a better answer than a working one nobody can account for.
//!
//! There is one interval where the opposite is true, and it is [`Behind`]. A
//! front that has just been taken is pointed at while the window it is for has
//! not been loaded yet — the one on the screen is still the old one, and it
//! goes on asking for its own pieces as the person clicks around parts of it
//! they have not opened before. Those are answered out of what it was being
//! served from until it is replaced, which is safe for exactly the reason the
//! rule above exists: a name under `assets/` is a hash of its contents, so the
//! same name in two builds is the same file, and a name in only one of them is
//! only ever asked for by that one.

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
    /// that reads this will serve anyway -- see [`keep`], where a front has to
    /// be newer than the binary, and a binary carrying this is newer than any
    /// front taken without it.
    #[serde(default)]
    needs: u32,
    /// Whether a window has ever finished drawing itself out of it.
    confirmed: bool,
}

/// The name that file is kept under.
const TAKEN: &str = "taken.json";

/// A front on disk, and what it says it is.
#[derive(Clone)]
struct Unpacked {
    dir: PathBuf,
    version: Version,
    /// The agreement it was built against -- see [`Taken::needs`].
    needs: u32,
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
