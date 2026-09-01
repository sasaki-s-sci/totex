//! Putting the release on the machine, which is the thing this does itself.
//!
//! It used to be the one thing it did not. What was downloaded was a
//! per-version installer and the install was that installer's -- which meant
//! two programs deciding where the app goes, only one of which had been asked,
//! and a window that could offer to install a version and then hand the whole
//! question of what installing means to something else. So the release now
//! carries its program beside its installers (see the `programs` key in
//! scripts/update-manifest.mjs) and what follows is the whole of an install:
//! the program written where the app lives, the shortcuts, and the line in
//! Add/Remove Programs that makes it a thing Windows knows is there.
//!
//! What it writes is what the per-version installer writes, value for value --
//! see [`entry`]. The two are alternatives rather than layers: a copy put here
//! can be replaced by the app updating itself, which runs a per-version
//! installer over the top of it, and that installer finds an install it
//! recognises rather than a second one it does not. That is the whole reason
//! for matching it.

use std::path::Path;

pub mod entry;
pub mod hand;
pub mod link;
pub mod place;
pub mod remove;
pub mod run;
pub mod webview;

/// What the app is called, everywhere Windows is told about it.
///
/// `productName` in src-tauri/tauri.conf.json, which is what the per-version
/// installer is built with and therefore what it writes. The two have to be the
/// same word or the two installs are two products as far as Windows is
/// concerned.
pub const PRODUCT: &str = "totex";

/// The program itself, under the name the per-version installer gives it.
pub const BINARY: &str = "totex.exe";

/// What this program is called once it is sitting in the install directory
/// waiting to be the thing that takes the app back off the machine.
pub const UNINSTALLER: &str = "uninstall.exe";

/// The whole of an install, in the order it has to happen in.
///
/// `say` is how each step names itself in the window. None of them is long
/// except the first, and the first is only long on a machine that has no
/// webview -- which is the one step that has to come before the program is
/// written, because it is the one that can send somebody away to answer a
/// prompt from Microsoft.
pub fn put(
    version: &str,
    program: &[u8],
    desktop: bool,
    say: &dyn Fn(&str),
) -> Result<String, String> {
    let directory = place::directory()?;

    say("Making sure this machine has a webview");
    webview::ensure(say)?;

    say(&format!("Installing totex {version}"));
    place::write_program(&directory, program)?;
    place::keep_uninstaller(&directory)?;
    entry::write(&directory, version)?;
    link::make(&directory, desktop)?;

    Ok(format!("totex {version} is installed"))
}

/// What one release's own installer did, in the words this window uses.
///
/// Only the releases that carry no program of their own reach this -- see
/// [`crate::release::Release::Installer`] -- and three of the codes are somebody saying no
/// rather than something going wrong: 1 is how NSIS says the installer was
/// closed, 1602 is how the msi says it, and 1223 is how Windows says the
/// prompt asking for administrator was turned down.
pub fn what_happened(version: &str, code: u32) -> Result<String, String> {
    match code {
        0 => Ok(format!("totex {version} is installed")),
        1 | 1223 | 1602 => Ok("The installer was closed before it finished".to_string()),
        code => Err(format!("The installer stopped with {code}")),
    }
}

/// Where the app goes, as the words that go into the registry and a shortcut.
pub fn program_path(directory: &Path) -> String {
    directory.join(BINARY).display().to_string()
}

/// Why a release is about to be installed by something other than this.
///
/// Said out loud because it is a different thing from what the window has just
/// offered to do: the pages that installer shows ask their own questions, and
/// the desktop shortcut ticked here is not one of the answers it will use.
pub fn handing_over(version: &str) -> String {
    format!("totex {version} carries no program to install, so its own installer is run")
}
