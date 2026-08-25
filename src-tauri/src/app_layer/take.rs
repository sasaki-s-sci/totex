//! Where a taken layer is kept, and putting one there.
//!
//! The layer keeps nothing about itself: which one was taken, and what it
//! speaks, are written down here — by the half of the app that is allowed to
//! remember things. That is not an accident of the arrangement, it is the
//! arrangement: everything the app has after a restart was written by this
//! program, so a layer can be replaced, dropped or rolled back without anything
//! it was in the middle of having been the only copy of something.

use std::fs;
use std::path::PathBuf;
use std::sync::Arc;

use totex_layer::Running;

use crate::update::Took;

use super::{Layers, PROGRAM, TAKEN, Taken};

impl Layers {
    /// Where the layer of one version is kept.
    pub(super) fn under(&self, version: &str) -> Option<PathBuf> {
        self.home.as_ref().map(|home| home.join(version))
    }

    /// What the last run took, if it is still there.
    pub(super) fn kept(&self) -> Option<Taken> {
        let home = self.home.as_ref()?;
        let taken: Taken = fs::read(home.join(TAKEN))
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())?;
        // A layer that speaks a conversation this program does not is one this
        // program cannot start -- which is what naming an older version of the
        // program leaves behind, and what a newer one is asked to clear away.
        if taken.protocol != totex_layer::PROTOCOL {
            return None;
        }
        self.under(&taken.version)
            .filter(|dir| dir.join(PROGRAM).is_file())
            .map(|_| taken)
    }

    /// Starts the layer of one version and puts it in front of the built-in
    /// copy, or says why it is not one that can be run here.
    pub(super) fn start(&self, version: &str) -> Result<(), String> {
        let program = self
            .under(version)
            .ok_or_else(|| "nowhere to keep a layer".to_string())?
            .join(PROGRAM);
        let running = Running::start(&program, version)?;
        self.point_at(Arc::new(running));
        Ok(())
    }

    /// Writes down which layer was taken, so the next start of the app opens on
    /// the same one.
    pub(super) fn remember(&self, version: &str) -> Result<(), String> {
        let home = self
            .home
            .as_ref()
            .ok_or_else(|| "nowhere to keep a layer".to_string())?;
        let taken = Taken {
            version: version.to_string(),
            protocol: totex_layer::PROTOCOL,
        };
        let bytes = serde_json::to_vec(&taken).map_err(|error| error.to_string())?;
        fs::create_dir_all(home).map_err(|error| format!("{}: {error}", home.display()))?;
        fs::write(home.join(TAKEN), bytes).map_err(|error| format!("{}: {error}", home.display()))
    }

    /// Puts a layer in place and starts asking it things.
    ///
    /// Unpacked beside where it is going and moved into place in one step, so
    /// that what the name of a version points at is either the whole of that
    /// program or nothing — and started before it is written down, because a
    /// layer that will not start is not one the next run of the app should open
    /// on either.
    ///
    /// What it replaces is left where it is. It may be finishing a question
    /// this second, and on Windows it is a file the machine is holding open
    /// while it does; the next start of the app is what clears away every layer
    /// but the one it opens on.
    pub(crate) fn put(&self, version: &str, packed: &[u8]) -> Result<Took, String> {
        let home = self
            .home
            .as_ref()
            .ok_or_else(|| "nowhere to keep a layer".to_string())?;
        let dir = home.join(version);
        let taking = home.join(format!("{version}.taking"));
        fs::create_dir_all(&taking).map_err(|error| format!("{}: {error}", taking.display()))?;

        let program = taking.join(PROGRAM);
        let put = || -> Result<(), String> {
            let mut file = fs::File::create(&program)
                .map_err(|error| format!("{}: {error}", program.display()))?;
            let mut unpacking = flate2::read::GzDecoder::new(packed);
            std::io::copy(&mut unpacking, &mut file)
                .map_err(|error| format!("the layer would not unpack: {error}"))?;
            // A program has to be one before it can be run, and an archive's
            // idea of that is not something worth trusting to be right.
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                file.set_permissions(fs::Permissions::from_mode(0o755))
                    .map_err(|error| format!("{}: {error}", program.display()))?;
            }
            file.sync_all()
                .map_err(|error| format!("{}: {error}", program.display()))
        };
        if let Err(error) = put() {
            let _ = fs::remove_dir_all(&taking);
            return Err(error);
        }

        let _ = fs::remove_dir_all(&dir);
        fs::rename(&taking, &dir).map_err(|error| format!("{}: {error}", dir.display()))?;

        // Started before anything is written down, so that a layer which will
        // not run is one press that failed rather than a copy of the app that
        // opens on it from now on.
        if let Err(error) = self.start(version) {
            let _ = fs::remove_dir_all(&dir);
            return Err(error);
        }
        self.remember(version)?;
        Ok(Took::Taken)
    }

    /// Goes back to the copy this program carries, and clears away what was
    /// taken.
    ///
    pub(super) fn forget(&self) {
        self.drop_front();
        let Some(home) = self.home.as_ref() else {
            return;
        };
        let _ = fs::remove_file(home.join(TAKEN));
        self.clear_away(None);
    }

    /// Deletes every layer but one.
    ///
    /// Called on the way up rather than on the way down: what a swap replaces
    /// may still be finishing a question, and on Windows its program is a file
    /// the machine is holding open until it has. By the next start, nothing is
    /// pointed at any of them but the one being opened on.
    pub(super) fn clear_away(&self, keeping: Option<&str>) {
        let Some(home) = self.home.as_ref() else {
            return;
        };
        for entry in fs::read_dir(home).into_iter().flatten().flatten() {
            let path = entry.path();
            let name = entry.file_name();
            if name == TAKEN || keeping.is_some_and(|keeping| name == keeping) {
                continue;
            }
            let _ = match entry.file_type() {
                Ok(kind) if kind.is_dir() => fs::remove_dir_all(&path),
                _ => fs::remove_file(&path),
            };
        }
    }
}
