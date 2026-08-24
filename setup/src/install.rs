//! Putting the download on the machine, which is the one thing this does not
//! do itself.
//!
//! What was downloaded is an installer, and it is the installer that installs.
//! Nothing here answers a question the pages of that installer ask -- where the
//! app goes, whether there is a desktop shortcut -- because a second place
//! those are answered is a second place they can be answered differently.

use std::fs;
use std::os::windows::ffi::OsStrExt;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use windows_sys::Win32::Foundation::{CloseHandle, GetLastError};
use windows_sys::Win32::System::SystemInformation::GetSystemDirectoryW;
use windows_sys::Win32::System::Threading::{
    CreateProcessW, GetCurrentProcessId, GetExitCodeProcess, INFINITE, PROCESS_INFORMATION,
    STARTUPINFOW, WaitForSingleObject,
};

/// The downloaded installer, in a directory of its own that goes when it does.
///
/// A directory rather than a file so that the name the release page chose can
/// be kept without anything already in the temporary folder being written
/// over, and so that clearing up is one call rather than a guess at what the
/// installer left behind.
pub struct Kept {
    directory: PathBuf,
    file: PathBuf,
}

impl Drop for Kept {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.directory);
    }
}

/// Writes the download where it can be run from.
pub fn keep(name: &str, bundle: &[u8]) -> Result<Kept, String> {
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
    fs::write(&kept.file, bundle)
        .map_err(|error| format!("{} could not be written: {error}", kept.file.display()))?;
    Ok(kept)
}

/// Runs the installer and waits for it, answering with what it exited with.
///
/// The `.exe` is started as itself and shows the two pages it has always
/// shown. The `.msi` answers to msiexec rather than to being run, and msiexec
/// is taken from the system directory rather than from the path, since what a
/// path lookup finds is not this installer's to decide.
pub fn run(kept: &Kept, msi: bool) -> Result<u32, String> {
    let (program, mut line) = if msi {
        let mut directory = vec![0u16; 260];
        let written =
            unsafe { GetSystemDirectoryW(directory.as_mut_ptr(), directory.len() as u32) };
        if written == 0 || written as usize >= directory.len() {
            return Err("Windows will not say where its own system folder is".to_string());
        }
        directory.truncate(written as usize);
        let msiexec = PathBuf::from(String::from_utf16_lossy(&directory)).join("msiexec.exe");
        let line = format!("\"{}\" /i \"{}\"", msiexec.display(), kept.file.display());
        (wide(&msiexec), wide_str(&line))
    } else {
        let line = format!("\"{}\"", kept.file.display());
        (wide(&kept.file), wide_str(&line))
    };

    let mut startup: STARTUPINFOW = unsafe { std::mem::zeroed() };
    startup.cb = size_of::<STARTUPINFOW>() as u32;
    let mut started: PROCESS_INFORMATION = unsafe { std::mem::zeroed() };

    let ok = unsafe {
        CreateProcessW(
            program.as_ptr(),
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
            "the installer would not start (Windows says 0x{:x})",
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
            return Err("the installer finished without saying how".to_string());
        }
    }
    Ok(code)
}

/// What an exit code means, in the words this window uses.
///
/// Three of them are somebody saying no rather than something going wrong: 1
/// is how NSIS says the installer was closed, 1602 is how the msi says it, and
/// 1223 is how Windows says the prompt asking for administrator was turned
/// down. None is a failure worth a red line.
pub fn what_happened(version: &str, code: u32) -> Result<String, String> {
    match code {
        0 => Ok(format!("totex {version} is installed")),
        1 | 1223 | 1602 => Ok("The installer was closed before it finished".to_string()),
        code => Err(format!("The installer stopped with {code}")),
    }
}

fn wide(path: &Path) -> Vec<u16> {
    path.as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect()
}

fn wide_str(text: &str) -> Vec<u16> {
    text.encode_utf16().chain(std::iter::once(0)).collect()
}
