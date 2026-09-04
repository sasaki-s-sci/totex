//! Everything this window is holding, which is everything it could work out
//! again.
//!
//! Two kinds of thing are kept while a window is open. One is a running shell:
//! a process with a history nobody else has a copy of, gone for good if
//! whatever holds it stops. The other is all the rest — the snapshot a folder
//! was scanned into, the watches on the few places git writes, the screen a
//! session has drawn and the question standing on it — and none of that is a
//! possession. It is a saving. Throw it away and it comes back, out of what is
//! on disk and out of what the sessions have already said.
//!
//! The line between the two is a process boundary. The shells are held by the
//! program beside this one — see `persistent` — and this window holds only the
//! second kind, which is what lets it be replaced underneath a running agent
//! without ending the agent: an update, a crash, a reload that went wrong. A
//! line like that is worth nothing unless it is true, so it is written down
//! here as something the window actually does rather than as a note about how
//! it is arranged, and the tests beside the two halves are what say it still
//! holds: every one of the window's is run against a program at the other end
//! of a real socket.
//!
//! What comes back by itself and what does not is worth being exact about. The
//! readings come back here, because everything they are made of is still in the
//! sessions. The folders do not: which of them a window has put on the graph is
//! the window's own business, and is asked for again the way it was asked for
//! the first time.
//!
//! And one thing is on the other side of the line without being a process. What
//! an agent says it is working on — see `mcp` — arrives through a door of its
//! own rather than out of anything a session drew, so there is nothing to work
//! it out from: it is a thing that was said once, the same as the session's own
//! backlog, and dropping it would not lose a reading but the report itself. So
//! it is the persistent half's too. It goes when the session it belongs to goes, and not
//! before.

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
    // Nothing about the door is touched. It is held open by the persistent half and the
    // reports behind it were said rather than read, so there is no version of
    // either that could be taken again from what is on disk or from what the
    // sessions have said.
}
