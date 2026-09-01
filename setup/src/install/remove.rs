//! Taking it back off, which is the other thing this program is asked to do.
//!
//! The copy of this left in the install directory is what `UninstallString`
//! points at, so a person pressing Uninstall in Windows' own list starts this
//! program with the switches below rather than the window. The switches are
//! not ours: they are what the per-version installer's uninstaller takes, and
//! they are taken here because that installer is what runs this one. When the
//! app brings its program forward it runs a per-version installer over the top
//! of itself, and the first thing that installer does with an install it finds
//! is run its `UninstallString` with `/UPDATE`, `/P` and `_?=<folder>` appended
//! -- see `reinst_uninstall` in src-tauri/installer/installer.nsi. An
//! uninstaller that did not understand those would fail that update.
//!
//! `_?=<folder>` also carries the one rule that is not about what to remove: it
//! means run where you are and do not delete yourself, because the caller is
//! waiting on this process and will clear up after it. Started without it -- by
//! a person, out of Windows' list -- there is nobody to do that, so this copies
//! itself somewhere it can delete the original from and starts that copy with
//! the folder named.

use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use windows_sys::Win32::UI::WindowsAndMessaging::{IDYES, MB_ICONQUESTION, MB_YESNO, MessageBoxW};

use super::{PRODUCT, UNINSTALLER, entry, link, place, run};
use crate::wide;

/// What this program was started to do.
pub enum Asked {
    /// Show the window and install something.
    Install,
    /// Take an install away, from wherever the switches say it is.
    Remove(Removal),
}

/// One uninstall, as its switches describe it.
pub struct Removal {
    /// The folder the app was put in.
    from: PathBuf,
    /// Whether the caller is waiting on this process and will clear up after
    /// it, which is what `_?=` means.
    in_place: bool,
    /// Whether this is a copy being replaced rather than an app being removed,
    /// which is what `/UPDATE` means: what is about to write the shortcuts and
    /// the registry line again is the installer that asked for this.
    updating: bool,
    /// Whether anything at all may be drawn, which is what `/P` turns off.
    quiet: bool,
}

/// Reads the command line, and the name this program is running under.
///
/// The name is what tells an uninstall from an install without a switch. There
/// is one program here and two things it does, and which one it is doing is
/// decided by which of the two files it was started from -- the copy somebody
/// downloaded, or the copy that install left behind.
pub fn asked() -> Asked {
    let arguments: Vec<String> = std::env::args().skip(1).collect();
    let named = std::env::current_exe()
        .ok()
        .and_then(|me| {
            me.file_name()
                .map(|name| name.eq_ignore_ascii_case(UNINSTALLER))
        })
        .unwrap_or(false);
    let switched = arguments
        .iter()
        .any(|argument| argument.eq_ignore_ascii_case("/uninstall"));
    if !named && !switched {
        return Asked::Install;
    }

    let told = arguments
        .iter()
        .find_map(|argument| argument.strip_prefix("_?="))
        .filter(|folder| !folder.is_empty())
        .map(PathBuf::from);
    // Where this is running from, which is inside the install unless the copy
    // in the temporary folder is what is running -- and that copy is only ever
    // started with the folder named.
    let here = std::env::current_exe()
        .ok()
        .and_then(|me| me.parent().map(Path::to_path_buf));

    Asked::Remove(Removal {
        in_place: told.is_some(),
        from: told.or(here).unwrap_or_default(),
        updating: has(&arguments, "/UPDATE"),
        quiet: has(&arguments, "/P"),
    })
}

fn has(arguments: &[String], switch: &str) -> bool {
    arguments
        .iter()
        .any(|argument| argument.eq_ignore_ascii_case(switch))
}

/// Does it, and answers with what to exit with.
///
/// Zero is done. One is somebody saying no, which is the number the per-version
/// installer reads as exactly that and goes back a page for.
pub fn go(removal: Removal) -> u32 {
    if removal.from.as_os_str().is_empty() {
        return 2;
    }
    if !removal.in_place {
        return match step_aside(&removal) {
            Ok(()) => 0,
            Err(_) => 2,
        };
    }
    if !removal.updating && !removal.quiet && !agreed() {
        return 1;
    }

    // An update is the same files going back in a moment. Taking the shortcuts
    // and the line in Windows' list away and letting the installer write them
    // again would be a gap somebody could be looking at the list during, and
    // the desktop shortcut would come back only if it was asked for a second
    // time -- which nobody would be there to do. The uninstaller is left for
    // the same reason and one more: it is the file this is running from.
    place::take_away(&removal.from, !removal.updating);
    if !removal.updating {
        link::unmake();
        entry::remove();
    }
    0
}

/// Whether somebody meant it.
///
/// Only asked where a person started this by hand. The two callers that are not
/// a person -- an installer replacing this copy, and the same one running
/// passively -- both say so on the command line.
fn agreed() -> bool {
    let asked = wide(&format!("Remove {PRODUCT} from this machine?"));
    let title = wide(&format!("Uninstall {PRODUCT}"));
    let answer = unsafe {
        MessageBoxW(
            std::ptr::null_mut(),
            asked.as_ptr(),
            title.as_ptr(),
            MB_YESNO | MB_ICONQUESTION,
        )
    };
    answer == IDYES
}

/// Runs this from somewhere the install can be deleted out from under it.
///
/// A program cannot delete the file it is running from, and the file this is
/// running from is one of the two files being removed. So a copy is made
/// outside the install and started with the folder named, which is what puts it
/// on the other side of that rule -- and this process ends immediately, because
/// what starts it is Windows' own list and there is nothing for it to wait for.
///
/// The copy is left in the temporary folder. It is the last thing on the
/// machine that knows the app was ever here, and it is a few hundred kilobytes
/// in the one directory Windows already clears out on its own.
fn step_aside(removal: &Removal) -> Result<(), String> {
    let me = std::env::current_exe()
        .map_err(|error| format!("this program cannot say where it is: {error}"))?;
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|since| since.subsec_nanos())
        .unwrap_or_default();
    let directory = std::env::temp_dir().join(format!("totex-uninstall-{stamp:08x}"));
    std::fs::create_dir_all(&directory)
        .map_err(|error| format!("{} could not be made: {error}", directory.display()))?;
    let copy = directory.join(UNINSTALLER);
    std::fs::copy(&me, &copy)
        .map_err(|error| format!("{} could not be written: {error}", copy.display()))?;

    let mut line = format!("_?={}", removal.from.display());
    if removal.updating {
        line.push_str(" /UPDATE");
    }
    if removal.quiet {
        line.push_str(" /P");
    }
    run::start(&copy, &line)
}
