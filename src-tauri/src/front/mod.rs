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
//! into the binary, and only after a window has finished drawing itself out of
//! it once.
//!
//! The first half is what makes it safe to leave lying about. A copy that
//! replaces itself the whole way, or one a package manager brings forward,
//! arrives carrying its own newer pages — and the taken ones, older now, are
//! deleted rather than left standing in front of them. Nothing has to remember
//! to clean up after a version; being overtaken is what deletes it.
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

pub mod take;
#[cfg(test)]
mod tests;

use std::borrow::Cow;
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, RwLock};

use semver::Version;
use serde::{Deserialize, Serialize};
use tauri::utils::assets::{AssetKey, AssetsIter, CspHash};
use tauri::{Assets, Runtime};

/// Set in the environment, this run is drawn out of the binary whatever is on
/// disk — and what is on disk is deleted on the way past.
const BUILT_IN: &str = "TOTEX_BUILT_IN_FRONT";

/// What is written beside an unpacked front, saying what it is.
#[derive(Serialize, Deserialize)]
struct Taken {
    /// The release the front came out of.
    version: String,
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

/// Which front this run of the app is being drawn out of.
///
/// Settled before the window opens and moved only by a press on the update
/// mark, so what a page asks for and what it gets are always the same build —
/// a window does not change front underneath itself, it is loaded again onto a
/// new one.
pub struct Serving {
    /// Where taken fronts are kept, or nothing on a machine with no data
    /// directory to keep them in — which is a machine that can only ever run
    /// the front it was installed with.
    home: Option<PathBuf>,
    /// The version of the front built into this binary, which is the app's own.
    built: Version,
    held: RwLock<Held>,
}

impl Serving {
    /// Settles what this run is drawn out of, and clears away everything else.
    pub fn prepare(identifier: &str, built: Version) -> Self {
        let home = dirs::data_dir().map(|dir| dir.join(identifier).join("front"));
        let at = home.as_deref().and_then(|home| keep(home, &built));
        Self {
            home,
            built,
            held: RwLock::new(Held {
                at,
                behind: Behind::Nothing,
            }),
        }
    }

    fn held(&self) -> Held {
        self.held.read().map_or(
            Held {
                at: None,
                behind: Behind::Nothing,
            },
            |held| held.clone(),
        )
    }

    /// The taken front being served, if the built-in one is not.
    fn at(&self) -> Option<Unpacked> {
        self.held().at
    }

    /// What the window is being drawn out of, as a version.
    fn version(&self) -> Version {
        self.at()
            .map_or_else(|| self.built.clone(), |at| at.version)
    }

    /// Hands the next window to be loaded a front that has just arrived, and
    /// leaves the one it replaced answering for the window already open.
    fn point_at(&self, unpacked: Unpacked) {
        if let Ok(mut held) = self.held.write() {
            held.behind = match &held.at {
                None => Behind::BuiltIn,
                Some(at) => Behind::Taken(at.dir.clone()),
            };
            held.at = Some(unpacked);
        }
    }

    /// Told when a window has been drawn out of the front being served, which
    /// is the moment nothing is left asking for the one before it.
    fn drawn(&self) {
        if let Ok(mut held) = self.held.write() {
            held.behind = Behind::Nothing;
        }
    }
}

/// Reads what was taken last time and decides whether a window opens on it.
///
/// Anything that is not the answer is deleted rather than left. A front this
/// run will not serve is one no later run will serve either: it is either older
/// than the binary, which only goes one way, or it is one that has had its
/// chance to draw a window and did not take it.
fn keep(home: &Path, built: &Version) -> Option<Unpacked> {
    let unpacked = fs::read(home.join(TAKEN))
        .ok()
        .and_then(|bytes| serde_json::from_slice::<Taken>(&bytes).ok())
        .filter(|taken| taken.confirmed)
        .and_then(|taken| Version::parse(&taken.version).ok())
        .filter(|version| version > built)
        .map(|version| Unpacked {
            dir: home.join(version.to_string()),
            version,
        })
        .filter(|unpacked| unpacked.dir.is_dir())
        .filter(|_| std::env::var_os(BUILT_IN).is_none());

    match &unpacked {
        None => {
            let _ = fs::remove_dir_all(home);
        }
        // One front is kept and it is this one. The rest are releases it has
        // overtaken, left behind by the run that took this one -- a swap does
        // not delete what it replaces, because the window still on the screen
        // at that moment is still being served out of it.
        Some(unpacked) => {
            for entry in fs::read_dir(home).into_iter().flatten().flatten() {
                let path = entry.path();
                if path == unpacked.dir || path.file_name().is_some_and(|name| name == TAKEN) {
                    continue;
                }
                let _ = match entry.file_type() {
                    Ok(kind) if kind.is_dir() => fs::remove_dir_all(&path),
                    _ => fs::remove_file(&path),
                };
            }
        }
    }
    unpacked
}

/// The file a page is asking for, read out of one front on disk.
///
/// A key is a URL path, and the only parts of one that name a file here are the
/// ordinary ones. `..` is not something any page this app builds writes a link
/// to; it is somebody asking for a file outside the front, and the answer to
/// that is no file at all rather than a file from further up the disk.
fn read_under(dir: &Path, key: &AssetKey) -> Option<Vec<u8>> {
    let mut path = dir.to_path_buf();
    for part in Path::new(key.as_ref()).components() {
        match part {
            Component::Normal(name) => path.push(name),
            Component::RootDir | Component::CurDir => {}
            Component::ParentDir | Component::Prefix(_) => return None,
        }
    }
    fs::read(path).ok()
}

/// The front built into the binary, with whatever has been taken since in
/// front of it.
pub struct Front<R: Runtime> {
    serving: Arc<Serving>,
    built_in: Box<dyn Assets<R>>,
}

impl<R: Runtime> Front<R> {
    pub fn new(serving: Arc<Serving>, built_in: Box<dyn Assets<R>>) -> Self {
        Self { serving, built_in }
    }
}

impl<R: Runtime> Assets<R> for Front<R> {
    fn get(&self, key: &AssetKey) -> Option<Cow<'_, [u8]>> {
        let held = self.serving.held();
        let Some(at) = held.at else {
            return self.built_in.get(key);
        };
        if let Some(bytes) = read_under(&at.dir, key) {
            return Some(Cow::Owned(bytes));
        }
        match held.behind {
            Behind::Nothing => None,
            Behind::BuiltIn => self.built_in.get(key),
            Behind::Taken(dir) => read_under(&dir, key).map(Cow::Owned),
        }
    }

    fn iter(&self) -> Box<AssetsIter<'_>> {
        // What shipped inside the binary, whichever front is being served.
        // This is a list of what was built, nothing in the app asks for it,
        // and walking a directory on every call would be a worse answer to a
        // question nobody has.
        self.built_in.iter()
    }

    fn csp_hashes(&self, html_path: &AssetKey) -> Box<dyn Iterator<Item = CspHash<'_>> + '_> {
        match self.serving.at() {
            // These are hashes of the scripts written inside a page, which the
            // policy is then widened by exactly enough to allow. They are read
            // off the page at build time, and a page from a later release is
            // one this build has never read: none is the only honest answer,
            // and it is the right one — the page this app builds carries a
            // stylesheet the config already allows and no script of its own.
            Some(_) => Box::new(std::iter::empty()),
            None => self.built_in.csp_hashes(html_path),
        }
    }
}

/// No pages at all, for the one moment the context is holding none.
///
/// [`tauri::Context::set_assets`] hands back what it replaced, which is the
/// only way to take the built-in front out of a context by value — and the
/// thing that stands in front of it cannot be built until it has it. So the
/// swap is done twice: this goes in, the built-in comes out, and what is meant
/// to be there goes in after it. Nothing is ever loaded while it is in place.
pub struct Nothing;

impl<R: Runtime> Assets<R> for Nothing {
    fn get(&self, _key: &AssetKey) -> Option<Cow<'_, [u8]>> {
        None
    }

    fn iter(&self) -> Box<AssetsIter<'_>> {
        Box::new(std::iter::empty())
    }

    fn csp_hashes(&self, _html_path: &AssetKey) -> Box<dyn Iterator<Item = CspHash<'_>> + '_> {
        Box::new(std::iter::empty())
    }
}
