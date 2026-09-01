//! The webview the window is drawn in, which is not this app's to ship.
//!
//! totex draws itself in the webview Windows carries, and a machine without one
//! is a machine where an installed copy opens nothing. Windows 11 has it and so
//! does any Windows 10 that has had Edge brought forward, which is nearly all of
//! them -- so this is nearly always a registry read and nothing else. Where it
//! is not, Microsoft's bootstrapper is fetched and run, which is exactly what
//! the per-version installer does with the copy of it built in (see
//! `webviewInstallMode` in src-tauri/tauri.conf.json). Built in is not something
//! this file can be: it is published once and installs releases cut years after
//! it, and a bootstrapper frozen into it would age the way nothing else here
//! does.

use windows_sys::Win32::System::Registry::{HKEY, HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};

use super::{entry, run};
use crate::web;

/// Microsoft's own name for the evergreen runtime, which is what its version is
/// filed under in both places it can be installed.
const RUNTIME: &str = "{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}";

/// Where the bootstrapper is. One address that has outlived several names for
/// the thing it downloads, which is the reason it is the one written down.
const BOOTSTRAPPER: &str = "https://go.microsoft.com/fwlink/p/?LinkId=2124703";

/// How much the bootstrapper is allowed to weigh. It is a downloader, not a
/// runtime: the runtime is what it then fetches.
const BOOTSTRAPPER_MOST: usize = 16 * 1024 * 1024;

/// Puts a webview on the machine if there is not one already.
pub fn ensure(say: &dyn Fn(&str)) -> Result<(), String> {
    if installed() {
        return Ok(());
    }

    say("Getting the webview totex draws itself in");
    let bootstrapper = web::get(BOOTSTRAPPER, BOOTSTRAPPER_MOST, None, |_, _| {})
        .map_err(|why| format!("this machine has no webview and one cannot be fetched — {why}"))?;
    // Not checked against totex's key, because it is not totex's file. What
    // makes it Microsoft's is the address it came from and the certificate that
    // address answered under, which is the same thing that makes it Microsoft's
    // when the per-version installer downloads it.
    let kept = run::keep("MicrosoftEdgeWebview2Setup.exe", &bootstrapper)?;

    say("Installing the webview");
    let code = run::wait_for(&kept.file, "/silent /install")?;
    if code != 0 {
        return Err(format!("the webview installer stopped with {code}"));
    }
    if !installed() {
        return Err("the webview installer finished without leaving a webview".to_string());
    }
    Ok(())
}

/// Whether a runtime is already there, in either of the two places one goes.
///
/// A machine-wide install is written under the 32-bit view whichever kind of
/// machine it is, which is Microsoft's arrangement and not something to argue
/// with -- so the path is spelled out rather than left to which view this
/// program happens to be reading through.
fn installed() -> bool {
    let places = [
        (
            HKEY_LOCAL_MACHINE,
            "SOFTWARE\\WOW6432Node\\Microsoft\\EdgeUpdate\\Clients",
        ),
        (
            HKEY_LOCAL_MACHINE,
            "SOFTWARE\\Microsoft\\EdgeUpdate\\Clients",
        ),
        (
            HKEY_CURRENT_USER,
            "Software\\Microsoft\\EdgeUpdate\\Clients",
        ),
    ];
    places
        .into_iter()
        .any(|(root, under)| version(root, &format!("{under}\\{RUNTIME}")).is_some())
}

/// What one of those keys says the runtime's version is, if it says anything.
///
/// A key that is there with `pv` set to `0.0.0.0` is what Edge leaves behind
/// when the runtime has been removed, so it is read as nothing rather than as a
/// version.
fn version(root: HKEY, path: &str) -> Option<String> {
    entry::at(root, path, "pv").filter(|said| said != "0.0.0.0")
}
