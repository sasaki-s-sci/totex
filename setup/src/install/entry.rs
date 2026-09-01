//! The line in Add/Remove Programs, and the folder the next install looks for.
//!
//! Every value here is one the per-version installer writes, spelled the way it
//! spells it -- see `Section Install` in src-tauri/installer/installer.nsi. That
//! is not tidiness. The app brings its program forward by running a per-version
//! installer over the top of itself, and the first thing that installer does is
//! read these to find out what is already here: an install described in another
//! vocabulary is one it would take for no install at all, and it would put a
//! second copy beside this one rather than replacing it.

use std::path::{Path, PathBuf};

use windows_sys::Win32::Foundation::ERROR_SUCCESS;
use windows_sys::Win32::System::Registry::{
    HKEY, HKEY_CURRENT_USER, KEY_WRITE, REG_DWORD, REG_OPTION_NON_VOLATILE, REG_SZ, RRF_RT_REG_SZ,
    RegCloseKey, RegCreateKeyExW, RegDeleteTreeW, RegGetValueW, RegSetValueExW,
};

use super::{BINARY, PRODUCT, UNINSTALLER, program_path};
use crate::wide;

/// Where Windows keeps what it will offer to uninstall.
const UNINSTALL_KEY: &str = "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\totex";

/// Where the installer keeps the folder it put the app in, for the next one to
/// find.
///
/// `Software\<manufacturer>\<product>`, and the manufacturer of a bundle with no
/// publisher set is the middle word of its identifier -- `com.totex.app`. So
/// both halves are the same word here, which reads like a mistake and is not.
const PRODUCT_KEY: &str = "Software\\totex\\totex";

/// Writes what Windows and the next installer read.
pub fn write(directory: &Path, version: &str) -> Result<(), String> {
    let program = program_path(directory);
    let uninstaller = directory.join(UNINSTALLER).display().to_string();
    let folder = directory.display().to_string();

    // Quoted exactly where the per-version installer quotes them. These are
    // read back as command lines and as paths respectively, and a path that
    // gains or loses its quotes between two installs is one of them describing
    // something that is not there.
    let key = open(UNINSTALL_KEY)?;
    let written = (|| {
        text(key, "DisplayName", PRODUCT)?;
        text(key, "DisplayIcon", &format!("\"{program}\""))?;
        text(key, "DisplayVersion", version)?;
        text(key, "Publisher", PRODUCT)?;
        text(key, "InstallLocation", &format!("\"{folder}\""))?;
        text(key, "UninstallString", &format!("\"{uninstaller}\""))?;
        text(key, "MainBinaryName", BINARY)?;
        number(key, "NoModify", 1)?;
        number(key, "NoRepair", 1)?;
        number(key, "EstimatedSize", weight(directory))
    })();
    unsafe { RegCloseKey(key) };
    written?;

    let key = open(PRODUCT_KEY)?;
    // The default value, which is what the per-version installer reads to find
    // out where the copy it is replacing was put.
    let written = text(key, "", &folder);
    unsafe { RegCloseKey(key) };
    written
}

/// Where a copy already here was put, if there is one.
///
/// Asked before an install decides where to write, so that installing over a
/// copy is replacing it rather than putting a second one somewhere else and
/// pointing Windows' list at that -- which is what would happen otherwise, and
/// the copy left behind would be one nothing on the machine any longer mentions.
///
/// The per-version installer asks where the app goes, so the answer here is not
/// always the folder this would have chosen. Both places it records the answer
/// are read: its own, and the one Windows shows.
pub fn where_it_went() -> Option<PathBuf> {
    let recorded = read(PRODUCT_KEY, "").or_else(|| {
        // Written with quotes around it, and they are not part of the path.
        read(UNINSTALL_KEY, "InstallLocation").map(|folder| folder.trim_matches('"').to_string())
    })?;
    let folder = PathBuf::from(recorded.trim());
    // A folder that is not there is a copy that was taken off the machine
    // without the registry being told, which is no reason to install into it.
    folder.is_dir().then_some(folder)
}

/// One string value out of this account's registry, if it is there.
pub fn read(path: &str, name: &str) -> Option<String> {
    at(HKEY_CURRENT_USER, path, name)
}

/// The same, out of whichever half of the registry is named.
pub fn at(root: HKEY, path: &str, name: &str) -> Option<String> {
    let path = wide(path);
    let name = wide(name);
    let mut bytes = 0u32;
    let asked = unsafe {
        RegGetValueW(
            root,
            path.as_ptr(),
            name.as_ptr(),
            RRF_RT_REG_SZ,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            &mut bytes,
        )
    };
    if asked != ERROR_SUCCESS || bytes == 0 {
        return None;
    }

    let mut held = vec![0u16; bytes as usize / 2 + 1];
    let mut room = bytes;
    let got = unsafe {
        RegGetValueW(
            root,
            path.as_ptr(),
            name.as_ptr(),
            RRF_RT_REG_SZ,
            std::ptr::null_mut(),
            held.as_mut_ptr().cast(),
            &mut room,
        )
    };
    if got != ERROR_SUCCESS {
        return None;
    }
    let text = String::from_utf16_lossy(&held)
        .trim_end_matches('\0')
        .to_string();
    (!text.is_empty()).then_some(text)
}

/// Takes both of them away again.
///
/// Nothing is reported for a key that was not there. This runs on the way to
/// the app being gone, and a registry that already agrees with that is not a
/// failure to make it agree.
pub fn remove() {
    for path in [UNINSTALL_KEY, PRODUCT_KEY] {
        let path = wide(path);
        unsafe { RegDeleteTreeW(HKEY_CURRENT_USER, path.as_ptr()) };
    }
}

/// How big Windows is told the install is, in the kilobytes it asks for.
///
/// Read off the disk rather than written down, because the one number that is
/// certainly right is the one the files actually come to. A directory that
/// cannot be read says nothing rather than a number that is wrong.
fn weight(directory: &Path) -> u32 {
    let Ok(listing) = std::fs::read_dir(directory) else {
        return 0;
    };
    let bytes: u64 = listing
        .flatten()
        .filter_map(|entry| entry.metadata().ok())
        .filter(|about| about.is_file())
        .map(|about| about.len())
        .sum();
    (bytes / 1024).try_into().unwrap_or(u32::MAX)
}

/// One key under this account's own half of the registry, made if it is not
/// there.
///
/// This account's and not the machine's, because the install is this account's:
/// the app goes under `$LOCALAPPDATA` and nothing about putting it there needs
/// an administrator, so nothing about describing it should either.
fn open(path: &str) -> Result<HKEY, String> {
    let path = wide(path);
    let mut key: HKEY = std::ptr::null_mut();
    let opened = unsafe {
        RegCreateKeyExW(
            HKEY_CURRENT_USER,
            path.as_ptr(),
            0,
            std::ptr::null(),
            REG_OPTION_NON_VOLATILE,
            KEY_WRITE,
            std::ptr::null(),
            &mut key,
            std::ptr::null_mut(),
        )
    };
    if opened != ERROR_SUCCESS {
        return Err(format!(
            "this account's registry will not be written to (Windows says {opened})"
        ));
    }
    Ok(key)
}

/// One string value. The nul goes in with it, which is what a `REG_SZ` is.
fn text(key: HKEY, name: &str, value: &str) -> Result<(), String> {
    let value = wide(value);
    let bytes = std::mem::size_of_val(value.as_slice());
    set(key, name, REG_SZ, value.as_ptr().cast(), bytes)
}

/// One number, which is what Windows wants for the three flags it reads.
fn number(key: HKEY, name: &str, value: u32) -> Result<(), String> {
    set(
        key,
        name,
        REG_DWORD,
        (&raw const value).cast(),
        size_of::<u32>(),
    )
}

fn set(
    key: HKEY,
    name: &str,
    kind: windows_sys::Win32::System::Registry::REG_VALUE_TYPE,
    data: *const u8,
    bytes: usize,
) -> Result<(), String> {
    let name = wide(name);
    let written = unsafe {
        RegSetValueExW(
            key,
            name.as_ptr(),
            0,
            kind,
            data,
            bytes.try_into().unwrap_or(0),
        )
    };
    if written != ERROR_SUCCESS {
        return Err(format!(
            "the install could not be described to Windows (writing it says {written})"
        ));
    }
    Ok(())
}
