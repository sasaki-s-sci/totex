//! Everything asked of a session once it is running.

use std::io::Write;

use portable_pty::PtySize;

use totex_host::sync::lock;

use super::model::{Held, Running};
use super::{Event, Sessions};

impl Sessions {
    /// Every session that is still running — what a window asks for when it
    /// comes up in front of shells it does not know about. A session is a
    /// process, so this is the only place the truth about which of them exist
    /// has ever been.
    pub fn running(&self) -> Vec<Running> {
        let sessions = self.lock();
        sessions
            .iter()
            .map(|(id, session)| Running {
                id: id.clone(),
                cwd: session.cwd.clone(),
                rows: session.rows,
                cols: session.cols,
                meta: session.meta.clone(),
            })
            .collect()
    }

    /// Everything a session has said that is still kept, for a terminal just
    /// built for it. `None` when there is no such session.
    ///
    /// Read alongside the event: a terminal registers for the live output first
    /// and asks for this second, so a run that lands between the two arrives
    /// twice rather than not at all — and `upto` is how the terminal tells
    /// which.
    pub fn attach(&self, id: &str) -> Option<Held> {
        let sessions = self.lock();
        let session = sessions.get(id)?;
        let said = lock(&session.said);
        Some(Held {
            text: said.text.clone(),
            upto: said.said,
        })
    }

    /// Sends what was typed. Keystrokes, not lines: the shell does the editing.
    pub fn write(&self, id: &str, data: &str) -> Result<(), String> {
        let mut sessions = self.lock();
        let session = sessions.get_mut(id).ok_or("no-session")?;
        session
            .writer
            .write_all(data.as_bytes())
            .map_err(|error| error.to_string())?;
        session.writer.flush().map_err(|error| error.to_string())
    }

    /// Tells the shell how much room it has, so that anything full-screen draws
    /// to the right size. The screen a question is read off is the shell's own,
    /// so the followers are told too.
    pub fn resize(&self, id: &str, rows: u16, cols: u16) -> Result<(), String> {
        let rows = rows.max(1);
        let cols = cols.max(1);

        {
            let mut sessions = self.lock();
            let Some(session) = sessions.get_mut(id) else {
                // A resize arriving after the shell exited is not worth an error.
                return Ok(());
            };
            session
                .master
                .resize(PtySize {
                    rows,
                    cols,
                    pixel_width: 0,
                    pixel_height: 0,
                })
                .map_err(|error| error.to_string())?;
            session.rows = rows;
            session.cols = cols;
        }

        self.tell(id, Event::Resized { rows, cols });
        Ok(())
    }

    /// Ends a session. The reader thread stops on its own once the pty is
    /// dropped, and it is that thread — not this — which says the session has
    /// gone.
    pub fn close(&self, id: &str) {
        if let Some(mut session) = self.lock().remove(id) {
            let _ = session.child.kill();
            let _ = session.child.wait();
        }
    }

    /// Ends every session, which is what closing the app means.
    pub fn close_all(&self) {
        let ids: Vec<String> = self.lock().keys().cloned().collect();
        for id in ids {
            self.close(&id);
        }
    }
}
