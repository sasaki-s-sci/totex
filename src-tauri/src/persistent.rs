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

use std::path::{Path, PathBuf};
use std::sync::Arc;

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

/// Where the program keeps its things, for one identifier.
///
/// Under the name the line was started with. This is where a window looks for
/// the address of a program an earlier window started, and a window of one
/// patch has to find the program of another -- see `totex_persistent::LINE` --
/// so the name stays what it was until the minor turns over.
pub fn home(identifier: &str) -> Option<PathBuf> {
    dirs::data_dir().map(|dir| dir.join(identifier).join("keep"))
}

/// Finds the program or starts it, and hands back the link to it.
///
/// A machine with nowhere to keep things is a machine this window cannot open
/// a terminal on: the program writes where it is into that directory, and
/// without it there is nowhere for a window to look.
pub fn reach(identifier: &str) -> Result<Arc<Link>, String> {
    let home = home(identifier).ok_or_else(|| "this machine has no data directory".to_string())?;
    let program = placed(&home)?;
    Link::reach(&home, &program).map(Arc::new)
}

/// The program, copied out under its version and ready to run.
///
/// `TOTEX_PERSISTENT` in the environment names one to run instead, as it is, for
/// somebody working on the program itself.
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

/// Joins the link to the pages: what the sessions say and what the agents in
/// them report are sent on to the window as they arrive.
///
/// Registered after everything in this program that follows the sessions, so
/// that a reading of a run of output has been taken before the run is drawn.
pub fn deliver<R: Runtime>(app: &AppHandle<R>) {
    let link = app.state::<Arc<Link>>();

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
    Arc::clone(&app.state::<Arc<Link>>())
}

/// A document the pages asked the persistent half to remember, or nothing
/// under that name.
///
/// What is in it is the pages' business and nobody else's — see
/// `totex_persistent::store`, which is the whole of why the pages have somewhere to
/// keep things that is not the webview's own storage: it is written by one
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
