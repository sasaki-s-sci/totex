//! What a press on the pages row decides, and what a front on disk is allowed
//! to be.
//!
//! The parts that can be run without a window: the choice a press makes, which
//! is arithmetic on four versions and a contract, and the reading of what an
//! earlier run left behind, which is a directory and a small file beside it.

mod keep;
pub(super) mod serve;
mod take;

use std::fs;
use std::path::{Path, PathBuf};

use semver::Version;

use super::{TAKEN, Taken};

pub(super) fn at(version: &str) -> Version {
    Version::parse(version).expect("a version")
}

/// A temporary directory that removes itself, so a failing test cannot leave a
/// front behind.
pub(super) struct TempDir(PathBuf);

impl TempDir {
    pub(super) fn new(tag: &str) -> Self {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|elapsed| elapsed.as_nanos())
            .unwrap_or_default();
        let path =
            std::env::temp_dir().join(format!("totex-front-{tag}-{}-{unique}", std::process::id()));
        std::fs::create_dir_all(&path).expect("create temp dir");
        Self(path)
    }

    pub(super) fn path(&self) -> &Path {
        &self.0
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

/// A front lying under `home` the way a run that took one leaves it.
pub(super) fn lay(home: &Path, version: &str, confirmed: bool) {
    needing(home, version, 1, confirmed);
}

/// The same, for a front that says which program it has to be served by.
pub(super) fn needing(home: &Path, version: &str, needs: u32, confirmed: bool) {
    let dir = home.join(version);
    fs::create_dir_all(&dir).expect("lay a front");
    fs::write(dir.join("index.html"), b"<!doctype html>").expect("lay a page");
    let taken = Taken {
        version: version.to_string(),
        needs,
        confirmed,
    };
    fs::write(
        home.join(TAKEN),
        serde_json::to_vec(&taken).expect("write what was taken"),
    )
    .expect("write what was taken");
}

/// A front as the release job packs one: the contents of `dist`, at the root.
pub(super) fn packed(files: &[(&str, &[u8])]) -> Vec<u8> {
    let mut builder = tar::Builder::new(flate2::write::GzEncoder::new(
        Vec::new(),
        flate2::Compression::fast(),
    ));
    for (name, body) in files {
        let mut header = tar::Header::new_gnu();
        header.set_size(body.len() as u64);
        header.set_mode(0o644);
        builder
            .append_data(&mut header, name, *body)
            .expect("pack a file");
    }
    builder
        .into_inner()
        .expect("finish the archive")
        .finish()
        .expect("finish the compression")
}
