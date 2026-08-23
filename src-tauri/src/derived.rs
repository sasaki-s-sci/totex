//! Everything the app is holding that it could work out again.
//!
//! Two kinds of thing are kept while a window is open. One is a running shell:
//! a process with a history nobody else has a copy of, gone for good if this
//! program stops. The other is all the rest — the snapshot a folder was scanned
//! into, the watches on the few places git writes, the screen a session has
//! drawn and the question standing on it — and none of that is a possession. It
//! is a saving. Throw it away and it comes back, out of what is on disk and out
//! of what the sessions have already said.
//!
//! The line between the two is the point of the arrangement. It is what would
//! let the part of the app that owns the shells carry on running while the part
//! that reads them is replaced underneath — an update that does not end
//! anybody's agent halfway through what it was doing. A line like that is worth
//! nothing unless it is true, so it is written down here as something the app
//! actually does rather than as a note about how it is arranged, and the tests
//! beside the two halves are what say it still holds.
//!
//! What comes back by itself and what does not is worth being exact about. The
//! readings come back here, because everything they are made of is still in the
//! sessions. The folders do not: which of them a window has put on the graph is
//! the window's own business, and is asked for again the way it was asked for
//! the first time.

use tauri::{AppHandle, Manager, Runtime};

use crate::ask;
use crate::fs_watch::BrowseWatch;
use crate::git;

/// Drops everything that can be worked out again, and leaves the sessions
/// alone.
///
/// The window is what calls this, and it has one thing to do afterwards: scan
/// its folders again. Everything else is either already back or was never gone.
#[tauri::command]
pub fn rederive<R: Runtime>(app: AppHandle<R>) {
    git::session::forget_all(&app);
    app.state::<BrowseWatch>().clear();
    ask::watch::rederive(&app);
}
