//! The persistent half, found or started beside this window.
//!
//! This window is the ephemeral half and owns nothing that cannot be worked
//! out again — see `derived`. What cannot be is held by `totex-persistent`, a
//! program of its own that this window starts if it is not already running,
//! and talks to down a loopback socket. See `totex_persistent` for the whole
//! of why; what is here is the window's side of it: where the program is,
//! where it keeps its things, and how what it says reaches the pages.
//!
//! ## Where the program is
//!
//! Beside this one, as the bundle put it — and copied out from there before it
//! is run, under its own version, into the app's data directory. The copy is
//! not fussiness. On Windows an installer cannot write over a program that is
//! running, and the whole point of this program is that it is still running
//! when the installer comes; and an AppImage is a filesystem that goes away
//! when the app that mounted it does.
//!
//! The copies add up, one per version this machine has had, and that is what
//! the persistent row on the settings page offers: the versions of the program
//! this machine holds and could start, on this window's line. Left alone the
//! row follows the one this window brought; pointed at another, that is the
//! one started instead — see [`reach`] — and the press that puts either in
//! place of what is running is [`persistent_restart`], which ends every
//! terminal, and says so first.

use std::path::{Path, PathBuf};
use std::sync::{Arc, RwLock};

use semver::Version;
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager, Runtime};

use totex_persistent::door::Reported;
use totex_persistent::session::Event;
use totex_persistent::talk::Link;

use crate::mcp::REPORT_EVENT;
use crate::pty::{DATA_EVENT, EXIT_EVENT, Said};

/// The name of the program, as cargo leaves it.
#[cfg(windows)]
const PROGRAM: &str = "totex-persistent.exe";
#[cfg(not(windows))]
const PROGRAM: &str = "totex-persistent";

/// The name it had before it was called that, which is what a copy placed by
/// a release from earlier in the line is called -- and is still a program
/// this window can start, because within a line the wire is the same.
#[cfg(windows)]
const PROGRAM_BEFORE: &str = "totex-keep.exe";
#[cfg(not(windows))]
const PROGRAM_BEFORE: &str = "totex-keep";

/// Where the program keeps its things, for one identifier.
///
/// Under the name the line was started with. This is where a window looks for
/// the address of a program an earlier window started, and a window of one
/// patch has to find the program of another -- see `totex_persistent::LINE` --
/// so the name stays what it was until the minor turns over.
pub fn home(identifier: &str) -> Option<PathBuf> {
    dirs::data_dir().map(|dir| dir.join(identifier).join("keep"))
}

/// The link to the program, held so that it can be swapped for a link to
/// another -- see [`persistent_restart`] -- underneath every command that asks
/// through it.
pub struct Reached {
    link: RwLock<Arc<Link>>,
}

impl Reached {
    /// A link already made, held so that it can be swapped.
    pub fn holding(link: Arc<Link>) -> Arc<Self> {
        Arc::new(Self {
            link: RwLock::new(link),
        })
    }

    /// The link as it stands.
    pub fn link(&self) -> Arc<Link> {
        Arc::clone(
            &self
                .link
                .read()
                .unwrap_or_else(|poisoned| poisoned.into_inner()),
        )
    }

    fn swap(&self, link: Arc<Link>) {
        *self
            .link
            .write()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = link;
    }
}

/// Finds the program or starts it, and hands back the link to it.
///
/// `pinned` is the version the persistent row was left pointed at, if any: a
/// program under that version this machine holds is the one started, in place
/// of the one beside this window. A version this machine does not hold, or on
/// another line, is a row pointed at nothing and is read as `latest`.
///
/// A machine with nowhere to keep things is a machine this window cannot open
/// a terminal on: the program writes where it is into that directory, and
/// without it there is nowhere for a window to look.
pub fn reach(identifier: &str, pinned: Option<&str>) -> Result<Arc<Reached>, String> {
    let home = home(identifier).ok_or_else(|| "this machine has no data directory".to_string())?;
    let (program, version) = chosen(&home, pinned)?;
    let link = Link::reach_version(&home, &program, &version)?;
    Ok(Reached::holding(Arc::new(link)))
}

/// The program to start: the one pinned, where this machine holds it, and
/// otherwise the one this window brought.
fn chosen(home: &Path, pinned: Option<&str>) -> Result<(PathBuf, String), String> {
    if let Some(version) = pinned
        && let Some(program) = held_at(home, version)
    {
        return Ok((program, version.to_string()));
    }
    Ok((placed(home)?, totex_persistent::VERSION.to_string()))
}

/// The program this window brought, copied out under its version and ready
/// to run.
///
/// `TOTEX_PERSISTENT` in the environment names one to run instead, as it is,
/// for somebody working on the program itself.
fn placed(home: &Path) -> Result<PathBuf, String> {
    if let Some(named) = std::env::var_os("TOTEX_PERSISTENT") {
        return Ok(PathBuf::from(named));
    }
    let beside = std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(|dir| dir.join(PROGRAM)))
        .filter(|program| program.is_file())
        .ok_or_else(|| format!("{PROGRAM} is not beside this program"))?;

    let dir = home.join(totex_persistent::VERSION);
    let placed = dir.join(PROGRAM);
    if !placed.is_file() {
        std::fs::create_dir_all(&dir).map_err(|error| format!("{}: {error}", dir.display()))?;
        // Written beside where it goes and moved into place, so that a copy is
        // either the whole program or not there.
        let placing = dir.join(format!("{PROGRAM}.placing"));
        std::fs::copy(&beside, &placing)
            .map_err(|error| format!("{}: {error}", placing.display()))?;
        std::fs::rename(&placing, &placed)
            .map_err(|error| format!("{}: {error}", placed.display()))?;
    }
    Ok(placed)
}

/// The program of one version, where this machine holds it and it is on this
/// window's line.
fn held_at(home: &Path, version: &str) -> Option<PathBuf> {
    if totex_persistent::line_of(version) != Some(totex_persistent::LINE) {
        return None;
    }
    let dir = home.join(version);
    [PROGRAM, PROGRAM_BEFORE]
        .into_iter()
        .map(|name| dir.join(name))
        .find(|program| program.is_file())
}

/// The versions of the program this machine holds and this window could
/// start, newest first.
///
/// Read off the directory the copies are placed in: one directory per version,
/// named by it, holding the program under either of the names it has had.
/// Only the ones on this window's line, because the others are programs this
/// window could not ask anything.
pub fn held(home: &Path) -> Vec<String> {
    let mut found: Vec<Version> = std::fs::read_dir(home)
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|entry| entry.file_name().into_string().ok())
        .filter(|name| held_at(home, name).is_some())
        .filter_map(|name| Version::parse(&name).ok())
        .collect();
    found.sort();
    found.reverse();
    found
        .into_iter()
        .map(|version| version.to_string())
        .collect()
}

/// The same, for the app as it is configured.
pub fn held_versions(identifier: &str) -> Vec<String> {
    home(identifier).map(|home| held(&home)).unwrap_or_default()
}

/// Joins the link to the pages: what the sessions say and what the agents in
/// them report are sent on to the window as they arrive.
///
/// Registered after everything in this program that follows the sessions, so
/// that a reading of a run of output has been taken before the run is drawn.
/// Registered again on every link -- see [`persistent_restart`] -- because a
/// follower belongs to the link it was given to.
pub fn deliver<R: Runtime>(app: &AppHandle<R>) {
    let link = link(app);

    let saying = app.clone();
    link.follow(Arc::new(move |id, event| match event {
        Event::Said { data, at } => {
            let _ = saying.emit(
                DATA_EVENT,
                Said {
                    id: id.to_string(),
                    data: data.to_string(),
                    seq: at,
                },
            );
        }
        Event::Ended => {
            let _ = saying.emit(EXIT_EVENT, id.to_string());
        }
        Event::Opened { .. } | Event::Resized { .. } => {}
    }));

    let reporting = app.clone();
    link.report_to(Arc::new(move |reported: &Reported| {
        let _ = reporting.emit(REPORT_EVENT, reported.clone());
    }));
}

/// The link, for the commands that forward through it.
pub fn link<R: Runtime>(app: &AppHandle<R>) -> Arc<Link> {
    app.state::<Arc<Reached>>().link()
}

/// Stops the program and starts one in its place, which ends every terminal.
///
/// `version` names one of the programs this machine holds -- see [`held`] --
/// or nothing for the one this window brought. What is running is stopped
/// whatever it holds: that is the whole of what this press is, and the page
/// says so beside it before it is pressed. The pages are then told to draw
/// themselves again, because everything they were showing of the sessions is
/// gone, and a fresh drawing is the honest one.
#[tauri::command(async)]
pub fn persistent_restart<R: Runtime>(
    app: AppHandle<R>,
    version: Option<String>,
) -> Result<(), String> {
    let identifier = app.config().identifier.clone();
    let home = home(&identifier).ok_or_else(|| "this machine has no data directory".to_string())?;
    let program = match version.as_deref() {
        Some(version) => held_at(&home, version)
            .ok_or_else(|| format!("this machine holds no {version} of the program"))?,
        None => placed(&home)?,
    };
    let link = Link::restart(&home, &program)?;
    app.state::<Arc<Reached>>().swap(Arc::new(link));

    // Everything that followed the sessions followed them on the link that
    // has gone. The same arrangement again, on this one, in the same order
    // as at the start -- see `run` in lib.rs.
    crate::ask::watch::attend(&app);
    deliver(&app);
    crate::ask::watch::rederive(&app);
    Ok(())
}

/// A document the pages asked the persistent half to remember, or nothing
/// under that name.
///
/// What is in it is the pages' business and nobody else's — see
/// `totex_persistent::store`, which is the whole of why the pages have somewhere
/// to keep things that is not the webview's own storage: it is written by one
/// program rather than by whichever window happens to be closing, and it is
/// still there when the webview's storage is not.
#[tauri::command(async)]
pub fn persistent_get<R: Runtime>(
    app: AppHandle<R>,
    name: String,
) -> Result<Option<Value>, String> {
    link(&app).asked("store_get", serde_json::json!({ "name": name }))
}

/// Keeps a document under a name, replacing whatever was there.
#[tauri::command(async)]
pub fn persistent_put<R: Runtime>(
    app: AppHandle<R>,
    name: String,
    value: Value,
) -> Result<(), String> {
    link(&app)
        .ask(
            "store_put",
            serde_json::json!({ "name": name, "value": value }),
        )
        .map(|_| ())
}

/// What is left to do on the way out: end the shells, unless this window is
/// leaving so that another can take its place.
pub fn leaving<R: Runtime>(app: &AppHandle<R>) {
    let link = link(app);
    if !link.relaunching() {
        link.stop();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A version on this window's line, and one off it.
    fn on_line(patch: u32) -> String {
        format!(
            "{}.{}.{patch}",
            env!("CARGO_PKG_VERSION_MAJOR"),
            env!("CARGO_PKG_VERSION_MINOR")
        )
    }

    fn off_line() -> String {
        let minor: u32 = env!("CARGO_PKG_VERSION_MINOR").parse().expect("a number");
        format!("{}.{}.0", env!("CARGO_PKG_VERSION_MAJOR"), minor + 1)
    }

    fn temp() -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "totex-held-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|elapsed| elapsed.as_nanos())
                .unwrap_or_default()
        ));
        std::fs::create_dir_all(&dir).expect("temp dir");
        dir
    }

    #[test]
    fn the_programs_this_machine_holds_are_the_ones_on_this_line_newest_first() {
        let home = temp();
        for (version, name) in [
            (on_line(2), PROGRAM),
            (on_line(10), PROGRAM),
            // Placed by a release from before the program was called that.
            (on_line(1), PROGRAM_BEFORE),
            // Another line: a program this window could not ask anything.
            (off_line(), PROGRAM),
        ] {
            let dir = home.join(version);
            std::fs::create_dir_all(&dir).expect("a version");
            std::fs::write(dir.join(name), b"a program").expect("the program");
        }
        // Not versions at all, and a version with nothing in it.
        std::fs::create_dir_all(home.join("store")).expect("the store");
        std::fs::create_dir_all(home.join(on_line(3))).expect("an empty version");
        std::fs::write(home.join("address.json"), b"{}").expect("the address");

        assert_eq!(held(&home), vec![on_line(10), on_line(2), on_line(1)]);
        assert!(held_at(&home, &on_line(1)).is_some());
        assert!(held_at(&home, &off_line()).is_none());
        assert!(held_at(&home, &on_line(3)).is_none());
        let _ = std::fs::remove_dir_all(&home);
    }
}
