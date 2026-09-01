//! Where the app goes, and getting it there while a copy of it is running.

use std::fs;
use std::os::windows::ffi::OsStrExt;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use windows_sys::Win32::Storage::FileSystem::{MOVEFILE_DELAY_UNTIL_REBOOT, MoveFileExW};

use super::{BINARY, PRODUCT, UNINSTALLER};

/// What a copy of the program that could not be deleted is renamed to.
///
/// The dot keeps it from being something Windows would run, and the rest is
/// only there to be recognised on the way past -- see [`scrub`].
const ASIDE: &str = "old";

/// Where the app goes.
///
/// Wherever the copy already here went, if there is one -- installing over a
/// copy has to be replacing it, and the per-version installer asks where the
/// app goes, so the folder it was told is not always the one this would pick.
///
/// Failing that, the folder that installer offers by default:
/// `$LOCALAPPDATA\totex`, one account's, asking nobody for anything. It is not
/// asked about here for the same reason it was not asked about before, when
/// this handed the question to that installer -- there is one sensible answer
/// and a second place to give it is a second place it can be given differently.
pub fn directory() -> Result<PathBuf, String> {
    if let Some(already) = super::entry::where_it_went() {
        return Ok(already);
    }
    let local = std::env::var_os("LOCALAPPDATA")
        .ok_or("Windows will not say where this account's application data is")?;
    Ok(PathBuf::from(local).join(PRODUCT))
}

/// Writes the program where the app lives.
///
/// A copy that is running cannot be written over, and one often is: the app
/// offers to bring itself forward, and somebody who would rather do it from
/// here does it with the window still open. So the copy that is there is moved
/// out of the way first -- which Windows allows for a file that is running,
/// unlike writing to it -- and the new one is written in its place. The old one
/// is deleted if it can be, and left to be swept up by the next install if it
/// cannot: a running program is a file that will be deletable a moment after it
/// is closed, and nothing here is worth making somebody close a window for.
pub fn write_program(directory: &Path, program: &[u8]) -> Result<(), String> {
    fs::create_dir_all(directory)
        .map_err(|error| format!("{} could not be made: {error}", directory.display()))?;
    scrub(directory);

    let target = directory.join(BINARY);
    move_aside(&target);
    fs::write(&target, program)
        .map_err(|error| format!("{} could not be written: {error}", target.display()))
}

/// Leaves this program where it can take the app back off the machine.
///
/// A copy of the thing that installed rather than a program of its own: it
/// carries the release page, the key and the window already, and one of the two
/// things it can be asked to do is undo what the other one did. Which is also
/// what makes the copy on disk worth keeping current -- the uninstaller of an
/// install is the installer that made it.
pub fn keep_uninstaller(directory: &Path) -> Result<(), String> {
    let me = std::env::current_exe()
        .map_err(|error| format!("this program cannot say where it is: {error}"))?;
    let target = directory.join(UNINSTALLER);
    if me == target {
        return Ok(());
    }
    move_aside(&target);
    fs::copy(&me, &target)
        .map(|_| ())
        .map_err(|error| format!("{} could not be written: {error}", target.display()))
}

/// Takes the program off the disk, and the folder with it if nothing is left in
/// it.
///
/// `uninstaller` is false for the one caller that is not taking the app away: a
/// per-version installer replacing this copy, which has run this to clear the
/// old files out and is about to write an uninstaller of its own over the one
/// still sitting there. Deleting it in that case would be deleting the file
/// this is running from, which Windows does not allow anyway -- and what would
/// be left is the renamed copy of it that nothing afterwards sweeps up.
pub fn take_away(directory: &Path, uninstaller: bool) {
    scrub(directory);
    let mut going = vec![BINARY];
    if uninstaller {
        going.push(UNINSTALLER);
    }
    for name in going {
        let file = directory.join(name);
        if fs::remove_file(&file).is_err() && file.exists() {
            move_aside(&file);
        }
    }
    // Only if it is empty. Anything else under it is somebody's, and a folder
    // named after the app is not a reason to believe otherwise.
    let _ = fs::remove_dir(directory);
}

/// Moves whatever is at this path out of the way, and gets rid of it if it can.
///
/// Nothing is reported. Every caller wants the path free rather than the old
/// file gone, and it is free either way: a rename is what Windows allows for an
/// open file, and what is left behind is swept by [`scrub`] at the next install.
fn move_aside(path: &Path) {
    if !path.exists() {
        return;
    }
    if fs::remove_file(path).is_ok() {
        return;
    }
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|since| since.subsec_nanos())
        .unwrap_or_default();
    let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
        return;
    };
    let aside = path.with_file_name(format!("{name}.{ASIDE}-{stamp:08x}"));
    if fs::rename(path, &aside).is_err() {
        return;
    }
    if fs::remove_file(&aside).is_ok() {
        return;
    }
    // The last thing there is to try, and the one that needs an administrator
    // to work. A per-user install is not run by one, so this ordinarily does
    // nothing at all -- which is why it is not what the sweep above relies on.
    let wide = wide(&aside);
    unsafe { MoveFileExW(wide.as_ptr(), std::ptr::null(), MOVEFILE_DELAY_UNTIL_REBOOT) };
}

/// Gets rid of the copies an earlier install could not delete.
///
/// The moment they are deletable is the moment the program that was holding
/// them open is closed, and an install is long after that.
fn scrub(directory: &Path) {
    let Ok(listing) = fs::read_dir(directory) else {
        return;
    };
    let aside = format!(".{ASIDE}-");
    for entry in listing.flatten() {
        if entry
            .file_name()
            .to_str()
            .is_some_and(|name| name.contains(&aside))
        {
            let _ = fs::remove_file(entry.path());
        }
    }
}

/// A path as the only kind of string the Windows calls take.
pub fn wide(path: &Path) -> Vec<u16> {
    path.as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect()
}
