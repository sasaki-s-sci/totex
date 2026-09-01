//! The release that is down and is not yet the one running.
//!
//! The program is the one layer that cannot be replaced underneath a window
//! that is open. On Windows the installers are run over the top of a closed
//! app: the updater starts one, this process ends inside the call, and the
//! installer opens the new copy afterwards. Read from the window that is what
//! it looks like — the window goes away in the middle of whatever was being
//! done in it, and every terminal in it goes with the window.
//!
//! So the two halves of it are pulled apart. A press downloads the release and
//! stops there; what puts it in is the app being closed, which is a moment the
//! person picked and one where there is nothing left in the window to lose. The
//! next start is on the new release, and nothing in between is asked of
//! anybody.
//!
//! Where an installer does not end this process — a `.app` unpacked over, an
//! AppImage written through — there is nothing to wait for and the release goes
//! in at the moment it is taken. Both endings read the same way from the
//! window: the release is in, this copy goes on as it was, and the next start
//! is the one on it.

use std::path::PathBuf;
use std::sync::Mutex;

use tauri_plugin_updater::Update;

/// What one release waiting for the way out is kept under.
const WAITING: &str = "waiting";

/// A release that has come down, and the way back to what it came out of.
///
/// Kept in two places on purpose. The bytes are the whole program and are put
/// on disk, because a session is as long as somebody leaves it and eighty
/// megabytes held for the length of one is eighty megabytes of nothing. What
/// knows how to put them in is the updater's own [`Update`], which is small,
/// and which is the only thing that knows the shape of the archive it handed
/// back.
pub struct Waiting {
    at: PathBuf,
    held: Mutex<Option<Box<Update>>>,
}

impl Waiting {
    /// Somewhere to put one.
    ///
    /// The cache directory rather than the data one the front and the update
    /// declarations are kept in, which is the difference between the two: this
    /// is a file that exists to be used once and deleted, and on Windows the
    /// data directory is the roaming one.
    pub fn prepare(identifier: &str) -> Self {
        Self::at(
            dirs::cache_dir()
                .unwrap_or_else(std::env::temp_dir)
                .join(identifier)
                .join(WAITING),
        )
    }

    /// The same, told where.
    ///
    /// Whatever was there is thrown away first. A release still sitting here is
    /// one from a run that was killed rather than closed, and an installer
    /// nothing is pointed at any more is only the size of it.
    pub fn at(at: PathBuf) -> Self {
        let _ = std::fs::remove_file(&at);
        Self {
            at,
            held: Mutex::new(None),
        }
    }

    /// Keeps a release that has come down until this app is closed.
    pub fn hold(&self, update: Update, release: &[u8]) -> Result<(), String> {
        if let Some(home) = self.at.parent() {
            std::fs::create_dir_all(home)
                .map_err(|error| format!("there is nowhere to keep the release: {error}"))?;
        }
        std::fs::write(&self.at, release)
            .map_err(|error| format!("the release could not be kept: {error}"))?;
        if let Ok(mut held) = self.held.lock() {
            *held = Some(Box::new(update));
        }
        Ok(())
    }

    /// Lets go of a release the row has stopped being pointed at.
    ///
    /// Somebody who moves the ephemeral row to another version has said what
    /// they want, and what came down is not it. Left alone it would go in on
    /// the way out regardless, out of a row that had gone back to drawing a
    /// tick — the one arrangement here where the page says one thing and the
    /// next start is another.
    ///
    /// `None` is `latest`, which is a row that has not been pointed anywhere in
    /// particular and is as good as pointed at what is already down. Asked on
    /// every pick rather than only on the ones that moved, because a pick that
    /// named the same version again is a person saying the same thing twice and
    /// is no reason to throw away eighty megabytes.
    pub fn let_go_unless(&self, version: Option<&str>) {
        let Ok(mut held) = self.held.lock() else {
            return;
        };
        let Some(update) = held.as_ref() else {
            return;
        };
        if version.is_none_or(|version| version == update.version) {
            return;
        }
        *held = None;
        let _ = std::fs::remove_file(&self.at);
    }

    /// Puts in whatever was waiting, which is the last thing this process does.
    ///
    /// Nothing is said about a release that would not go in, because there is
    /// nobody left to say it to: this is the app already on its way out, and
    /// what a failure here leaves behind is the copy that was running a moment
    /// ago, which is the copy that opens next. The row offers the release
    /// again from there, exactly as it would after any other press that did not
    /// finish.
    pub fn go_in(&self) {
        let Some(update) = self.held.lock().ok().and_then(|mut held| held.take()) else {
            return;
        };
        let Ok(release) = std::fs::read(&self.at) else {
            return;
        };
        // Which does not come back: the only releases that are ever held here
        // are the ones whose install ends this process, and that is the whole
        // of why they were held. The line under it is what would tidy up after
        // one that did return.
        let _ = update.install(release);
        let _ = std::fs::remove_file(&self.at);
    }
}
