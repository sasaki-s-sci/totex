//! Starting something and waiting for it, which two steps still need.
//!
//! Neither of them is the install: what is run here is Microsoft's webview
//! bootstrapper, and the per-version installer of a release too old to carry a
//! program of its own. Everything about installing totex itself is done without
//! any of this.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use windows_sys::Win32::Foundation::{CloseHandle, GetLastError};
use windows_sys::Win32::System::Threading::{
    CreateProcessW, GetCurrentProcessId, GetExitCodeProcess, INFINITE, PROCESS_INFORMATION,
    STARTUPINFOW, WaitForSingleObject,
};

use super::place::wide;

/// A download written where it can be run from, in a directory of its own that
/// goes when it does.
///
/// A directory rather than a file so that the name it came under can be kept
/// without anything already in the temporary folder being written over, and so
/// that clearing up is one call rather than a guess at what was left behind.
pub struct Kept {
    directory: PathBuf,
    pub file: PathBuf,
}

impl Drop for Kept {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.directory);
    }
}

/// Writes something where it can be run from.
pub fn keep(name: &str, bytes: &[u8]) -> Result<Kept, String> {
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|since| since.subsec_nanos())
        .unwrap_or_default();
    let directory = std::env::temp_dir().join(format!("totex-setup-{}-{unique:08x}", unsafe {
        GetCurrentProcessId()
    }));
    fs::create_dir_all(&directory)
        .map_err(|error| format!("{} could not be made: {error}", directory.display()))?;

    let kept = Kept {
        file: directory.join(name),
        directory,
    };
    fs::write(&kept.file, bytes)
        .map_err(|error| format!("{} could not be written: {error}", kept.file.display()))?;
    Ok(kept)
}

/// Runs a program and waits for it, answering with what it exited with.
///
/// `arguments` is what follows the program on its command line, or nothing at
/// all. The program is named twice on purpose -- once as the file to start and
/// once at the front of the line it reads -- which is what keeps a path with a
/// space in it from being read as two.
pub fn wait_for(program: &Path, arguments: &str) -> Result<u32, String> {
    let file = wide(program);
    let mut line: Vec<u16> = format!("\"{}\" {arguments}", program.display())
        .trim_end()
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect();

    let mut startup: STARTUPINFOW = unsafe { std::mem::zeroed() };
    startup.cb = size_of::<STARTUPINFOW>() as u32;
    let mut started: PROCESS_INFORMATION = unsafe { std::mem::zeroed() };

    let ok = unsafe {
        CreateProcessW(
            file.as_ptr(),
            line.as_mut_ptr(),
            std::ptr::null(),
            std::ptr::null(),
            0,
            0,
            std::ptr::null(),
            std::ptr::null(),
            &startup,
            &mut started,
        )
    };
    if ok == 0 {
        return Err(format!(
            "{} would not start (Windows says 0x{:x})",
            program.display(),
            unsafe { GetLastError() }
        ));
    }

    let mut code = 0u32;
    unsafe {
        WaitForSingleObject(started.hProcess, INFINITE);
        let asked = GetExitCodeProcess(started.hProcess, &mut code);
        CloseHandle(started.hThread);
        CloseHandle(started.hProcess);
        if asked == 0 {
            return Err(format!("{} finished without saying how", program.display()));
        }
    }
    Ok(code)
}

/// Starts something and does not wait for it.
///
/// The one caller is the uninstaller starting the copy of itself that will
/// delete it -- see [`super::remove`] -- where waiting would be waiting for
/// something that is waiting for this to end.
pub fn start(program: &Path, arguments: &str) -> Result<(), String> {
    let file = wide(program);
    let mut line: Vec<u16> = format!("\"{}\" {arguments}", program.display())
        .trim_end()
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect();

    let mut startup: STARTUPINFOW = unsafe { std::mem::zeroed() };
    startup.cb = size_of::<STARTUPINFOW>() as u32;
    let mut started: PROCESS_INFORMATION = unsafe { std::mem::zeroed() };

    let ok = unsafe {
        CreateProcessW(
            file.as_ptr(),
            line.as_mut_ptr(),
            std::ptr::null(),
            std::ptr::null(),
            0,
            0,
            std::ptr::null(),
            std::ptr::null(),
            &startup,
            &mut started,
        )
    };
    if ok == 0 {
        return Err(format!(
            "{} would not start (Windows says 0x{:x})",
            program.display(),
            unsafe { GetLastError() }
        ));
    }
    unsafe {
        CloseHandle(started.hThread);
        CloseHandle(started.hProcess);
    }
    Ok(())
}
