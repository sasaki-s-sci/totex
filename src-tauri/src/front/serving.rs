//! Which front this run of the app is being drawn out of.

use std::fs;
use std::path::{Component, Path, PathBuf};
use std::sync::RwLock;

use semver::Version;
use tauri::utils::assets::AssetKey;

use super::take;
use super::{BUILT_IN, Behind, Held, TAKEN, Taken, Unpacked};

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
    pub(super) home: Option<PathBuf>,
    /// The version of the front built into this binary, which is the app's own.
    pub(super) built: Version,
    pub(super) held: RwLock<Held>,
}

impl Serving {
    /// Settles what this run is drawn out of, and clears away everything else.
    pub fn prepare(identifier: &str, built: Version) -> Self {
        let home = dirs::data_dir().map(|dir| dir.join(identifier).join("front"));
        let at = home
            .as_deref()
            .and_then(|home| keep(home, &built, take::contract()));
        Self {
            home,
            built,
            held: RwLock::new(Held {
                at,
                behind: Behind::Nothing,
            }),
        }
    }

    pub(super) fn held(&self) -> Held {
        self.held.read().map_or(
            Held {
                at: None,
                behind: Behind::Nothing,
            },
            |held| held.clone(),
        )
    }

    /// The taken front being served, if the built-in one is not.
    pub(super) fn at(&self) -> Option<Unpacked> {
        self.held().at
    }

    /// Whether this machine has anywhere to keep a front at all. Where it has
    /// not, the pages it was installed with are the only ones it can draw.
    pub(crate) fn keeps(&self) -> bool {
        self.home.is_some()
    }

    /// The version of the program, which is the version of the pages built
    /// into it.
    pub(crate) fn built(&self) -> &Version {
        &self.built
    }

    /// What the window is being drawn out of, as a version.
    pub(crate) fn version(&self) -> Version {
        self.at()
            .map_or_else(|| self.built.clone(), |at| at.version)
    }

    /// Says that the front on disk is not to be opened on again.
    ///
    /// Told when the program itself is being replaced. Whatever release that
    /// program comes out of carries its own pages, and they are the ones that
    /// release means -- a front taken over the top of the old program is not
    /// part of what was asked for, and after a step backwards it can be newer
    /// than the program that would be serving it.
    ///
    /// Written rather than deleted, and written unconfirmed, which is the same
    /// thing [`keep`] already throws a front away for. The window on the screen
    /// is still being drawn out of that directory and goes on asking it for
    /// pieces until the moment it closes; it is only the next start this has to
    /// reach, and by then the directory is one nothing is pointed at.
    pub(crate) fn drop_front(&self) {
        let (Some(home), Some(unpacked)) = (self.home.clone(), self.at()) else {
            return;
        };
        let dropped = Taken {
            version: unpacked.version.to_string(),
            needs: unpacked.needs,
            confirmed: false,
        };
        if let Ok(bytes) = serde_json::to_vec(&dropped) {
            let _ = fs::write(home.join(TAKEN), bytes);
        }
    }

    /// Hands the next window to be loaded a front that has just arrived, and
    /// leaves the one it replaced answering for the window already open.
    pub(super) fn point_at(&self, unpacked: Unpacked) {
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
    pub(super) fn drawn(&self) {
        if let Ok(mut held) = self.held.write() {
            held.behind = Behind::Nothing;
        }
    }
}

/// Reads what was taken last time and decides whether a window opens on it.
///
/// Anything that is not the answer is deleted rather than left. A front this
/// run will not serve is one no later run will serve either: it is older than
/// the binary, or it needs more of the binary than this one has, or it is one
/// that has had its chance to draw a window and did not take it.
///
/// `contract` is what this program answers to, and the reason it is asked here
/// rather than only at the moment of taking: a front is checked against the
/// program it was taken onto, and the program can be replaced with an older one
/// afterwards. Whichever run is about to serve a front is the one that has to
/// agree with it.
pub(super) fn keep(home: &Path, built: &Version, contract: u32) -> Option<Unpacked> {
    let unpacked = fs::read(home.join(TAKEN))
        .ok()
        .and_then(|bytes| serde_json::from_slice::<Taken>(&bytes).ok())
        .filter(|taken| taken.confirmed)
        .filter(|taken| taken.needs <= contract)
        .and_then(|taken| {
            Version::parse(&taken.version)
                .ok()
                .map(|version| (version, taken.needs))
        })
        .filter(|(version, _)| version > built)
        .map(|(version, needs)| Unpacked {
            dir: home.join(version.to_string()),
            version,
            needs,
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
pub(super) fn read_under(dir: &Path, key: &AssetKey) -> Option<Vec<u8>> {
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
