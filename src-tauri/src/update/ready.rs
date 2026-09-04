//! The release that is down and is not yet the one running.
//!
//! What came down is on the persistent half's disk and how it goes in is its to do
//! — see `totex_persistent::update`. What is held here is only which release it is
//! and what it replaces, so that the restart the pages ask for a moment later
//! asks for the right thing, and so that a row moved to another version lets
//! go of a release nothing is pointed at any more.

use std::sync::Mutex;

use totex_persistent::update::Install;

/// A release that has come down, waiting for the restart that puts it in.
struct Held {
    version: String,
    install: Install,
}

/// The one release waiting, if any.
#[derive(Default)]
pub struct Ready {
    held: Mutex<Option<Held>>,
}

impl Ready {
    /// Keeps a release that has come down until this window leaves.
    pub fn hold(&self, version: &str, install: Install) {
        if let Ok(mut held) = self.held.lock() {
            *held = Some(Held {
                version: version.to_string(),
                install,
            });
        }
    }

    /// Lets go of a release the row has stopped being pointed at.
    ///
    /// Somebody who moves the row to another version has said what they want,
    /// and what came down is not it. `None` is `latest`, which is a row that
    /// has not been pointed anywhere in particular and is as good as pointed
    /// at what is already down. Asked on every pick rather than only on the
    /// ones that moved, because a pick that named the same version again is a
    /// person saying the same thing twice and is no reason to throw away
    /// eighty megabytes.
    pub fn let_go_unless(&self, version: Option<&str>) {
        let Ok(mut held) = self.held.lock() else {
            return;
        };
        if version.is_none_or(|version| held.as_ref().is_some_and(|held| held.version == version)) {
            return;
        }
        *held = None;
    }

    /// What is waiting to go in, taken out for the restart that puts it in.
    pub fn take(&self) -> Option<Install> {
        self.held
            .lock()
            .ok()
            .and_then(|mut held| held.take())
            .map(|held| held.install)
    }

    /// Whether a release is waiting, and which.
    #[cfg(test)]
    pub fn waiting(&self) -> Option<String> {
        self.held
            .lock()
            .ok()
            .and_then(|held| held.as_ref().map(|held| held.version.clone()))
    }
}
