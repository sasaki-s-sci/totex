//! The one install this does not make: a release that carries no program.
//!
//! Every release cut since the program started being published beside the
//! installers is installed by [`super::put`]. The ones cut before it hold
//! nothing but their own installers, and the only way to put one of those on a
//! machine is to run it -- which is what this whole program used to do for
//! every version, and now does only where there is no alternative in the
//! release itself.
//!
//! It is said out loud in the window rather than done quietly, because it is a
//! different thing: the pages that installer shows ask where the app goes and
//! whether there is a desktop shortcut, and the answers given here are not the
//! ones it will use.

use super::{run, what_happened};

/// Runs one release's own installer and waits for it.
pub fn over(name: &str, installer: &[u8], version: &str) -> Result<String, String> {
    let kept = run::keep(name, installer)?;
    let code = run::wait_for(&kept.file, "")?;
    what_happened(version, code)
}
