//! What a folder says can be run in it.
//!
//! The three runners that answer for themselves are only asked where they are
//! installed, so the tests that ask them skip themselves where they are not —
//! what they are for is that the words this app asks in are the words those
//! programs answer to, which nothing but the programs can say. The Makefile
//! reading is ours from end to end and is tested against text alone.

mod make;
mod runners;

use std::path::{Path, PathBuf};

/// A temporary directory that removes itself, so a failing test cannot leave a
/// fixture behind.
pub(super) struct TempDir(PathBuf);

impl TempDir {
    pub(super) fn new(tag: &str) -> Self {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|elapsed| elapsed.as_nanos())
            .unwrap_or_default();
        let path =
            std::env::temp_dir().join(format!("totex-tasks-{tag}-{}-{unique}", std::process::id()));
        std::fs::create_dir_all(&path).expect("create temp dir");
        Self(path)
    }

    pub(super) fn path(&self) -> &Path {
        &self.0
    }

    /// Writes one of the fixture's files, whatever it is a fixture for.
    pub(super) fn holding(&self, name: &str, text: &str) -> &Self {
        std::fs::write(self.0.join(name), text).expect("write the fixture");
        self
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

/// Whether a runner can actually be run here, asked the way this app asks
/// everything: through a login shell, which is where it would find one.
///
/// Run rather than looked for. A version manager leaves a shim on the path for
/// every tool it has ever heard of, and a shim with no version behind it is a
/// name that resolves and a program that is not there.
pub(super) fn installed(name: &str) -> bool {
    let temp = std::env::temp_dir();
    super::ask::say(&temp, &format!("{name} --version")).is_some()
}
