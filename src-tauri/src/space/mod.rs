//! The folder a command line stands in, and what somebody keeps there.
//!
//! A terminal is opened somewhere and everything run in it is run there. That
//! somewhere is a space: it is where an agent registered against this window
//! starts, it is what a line from the task list is typed into, and — because it
//! is a folder on somebody's disk rather than a row in this window's storage —
//! it is the one place a fact about it can be written down where it will still
//! be true the next time anybody stands there, in another window or on another
//! machine.
//!
//! `.totex` is that place, and it is found the way `.git` is found: by walking
//! up from wherever the shell is until one turns up. A terminal opened in `src`
//! is standing in the same space as one opened at the checkout's root, which is
//! what makes a space a place rather than a path.
//!
//! Nothing here makes one. A folder that has never been told anything holds
//! nothing, which is what a folder somebody only browsed ought to hold — the
//! directory appears the first time something is actually said, and `home` is
//! where it appears.

mod settings;

#[cfg(test)]
mod tests;

pub use settings::{Settings, settings};

use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::host::Host;

/// What a space keeps its things under.
pub const DIR: &str = ".totex";

/// How far up a walk goes before it gives up.
///
/// A walk ends at the root on its own — every rung is a shorter path than the
/// one below it — so this is not what stops it. It is what stops a path that
/// does not shorten: `parent` crosses into another machine's spelling for a
/// folder inside a distribution, and a bound is cheaper than trusting that
/// round trip to always come back one step nearer the top.
const RUNGS: usize = 64;

/// The space `from` is standing in, or nothing where it is standing in none.
///
/// Read afresh every time rather than remembered. The two things that ask are a
/// terminal being opened and a person pressing the key that lists what can be
/// run, and both of those are already slower than this walk — while a `.totex`
/// somebody has just written by hand in their editor is exactly the one this
/// has to find. A cache here would buy nothing and would lose that.
pub fn find(from: &Path) -> Option<PathBuf> {
    let host = Host::of(from);
    let mut at = from.to_path_buf();

    for _ in 0..RUNGS {
        if host.is_dir(&host.join(&at, DIR)) {
            return Some(at);
        }
        at = host.parent(&at)?;
    }

    None
}

/// Where a space for `from` would be made: the checkout it is in, or `from`
/// itself where it is in none.
///
/// The checkout, because a setting about a space is a setting about the work
/// going on in it, and the thing that says where one piece of work ends and the
/// next begins is already there in the folder. `.git` as a name rather than as
/// a directory: a worktree and a submodule each keep a file under that name,
/// and somebody standing in one of those is as much in a checkout as anybody.
///
/// Only ever asked of a folder somebody pressed something on, so the walk
/// starting above the folder they pressed is the point — a pane opened at `src`
/// puts the setting where the rest of the project's settings already are.
pub fn home(from: &Path) -> PathBuf {
    let host = Host::of(from);
    let mut at = from.to_path_buf();

    for _ in 0..RUNGS {
        if host.exists(&host.join(&at, ".git")) {
            return at;
        }
        let Some(above) = host.parent(&at) else { break };
        at = above;
    }

    from.to_path_buf()
}

/// The space `from` would be told through: the one it is standing in, and
/// otherwise the one that would be made for it.
pub fn holding(from: &Path) -> PathBuf {
    find(from).unwrap_or_else(|| home(from))
}

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
            settings: settings::read(&space).unwrap_or_default(),
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
    let space = settings::tell(Path::new(&path), settings)?;
    Ok(Standing {
        space,
        told: true,
        settings,
    })
}
