//! The shortcuts: one in the Start menu always, one on the desktop if asked.
//!
//! A `.lnk` is a COM object that is told what it points at and then saved, and
//! the two interfaces that takes are the two declared below. windows-sys is
//! bindings to functions rather than to interfaces, so the vtables are written
//! out here -- which is a small thing to carry compared with a second crate in
//! a program whose whole argument is that it uses what the machine already has.
//!
//! One difference from the per-version installer worth writing down: it also
//! stamps each shortcut with an application user model id, which is what makes
//! a pinned taskbar button group with the window it opened. That takes a third
//! interface and it is not done here.

use std::ffi::c_void;
use std::path::{Path, PathBuf};

use windows_sys::Win32::System::Com::{
    CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED, CoCreateInstance, CoInitializeEx,
    CoTaskMemFree, CoUninitialize,
};
use windows_sys::Win32::UI::Shell::{FOLDERID_Desktop, FOLDERID_Programs, SHGetKnownFolderPath};
use windows_sys::core::{GUID, HRESULT, PCWSTR, PWSTR};

use super::{BINARY, PRODUCT};
use crate::install::place::wide;

/// The shell's own link object, and the two ways of talking to it.
const CLSID_SHELL_LINK: GUID = GUID::from_u128(0x00021401_0000_0000_c000_000000000046);
const IID_SHELL_LINK_W: GUID = GUID::from_u128(0x000214f9_0000_0000_c000_000000000046);
const IID_PERSIST_FILE: GUID = GUID::from_u128(0x0000010b_0000_0000_c000_000000000046);

/// What the file is called in both places it is written.
fn link_name() -> String {
    format!("{PRODUCT}.lnk")
}

/// Writes the shortcuts for this install.
///
/// The Start menu one is not optional: an app that is installed and cannot be
/// found by name is one somebody has to go looking for the folder of. The
/// desktop one is the only thing this window asks about, which is the same
/// question the per-version installer asks on its second page.
pub fn make(directory: &Path, desktop: bool) -> Result<(), String> {
    let _com = Com::up();
    let program = directory.join(BINARY);
    let mut wanted = vec![folder(&FOLDERID_Programs)?];
    if desktop {
        wanted.push(folder(&FOLDERID_Desktop)?);
    }
    for at in wanted {
        write(&at.join(link_name()), &program, directory)?;
    }
    Ok(())
}

/// Takes them away again.
///
/// Both are this account's own -- the shared desktop and the shared Start menu
/// are different folders and nothing here has ever written to them -- and both
/// are named after the app, in the place this install put one. Nothing is
/// reported: a shortcut somebody has already deleted is the state this is
/// trying to reach.
pub fn unmake() {
    let name = link_name();
    for known in [FOLDERID_Programs, FOLDERID_Desktop] {
        if let Ok(at) = folder(&known) {
            let _ = std::fs::remove_file(at.join(&name));
        }
    }
}

/// One shortcut, pointed at the program and saved.
fn write(link: &Path, program: &Path, working: &Path) -> Result<(), String> {
    unsafe {
        let mut object: *mut c_void = std::ptr::null_mut();
        let made = CoCreateInstance(
            &CLSID_SHELL_LINK,
            std::ptr::null_mut(),
            CLSCTX_INPROC_SERVER,
            &IID_SHELL_LINK_W,
            &mut object,
        );
        if made < 0 || object.is_null() {
            return Err(format!(
                "Windows will not make a shortcut (it says 0x{made:x})"
            ));
        }
        let shell = Object(object);
        let table = *object.cast::<*const ShellLinkVtbl>();

        let program = wide(program);
        let working = wide(working);
        let described = crate::wide(PRODUCT);
        let mut set = ((*table).set_path)(object, program.as_ptr());
        if set >= 0 {
            set = ((*table).set_working_directory)(object, working.as_ptr());
        }
        if set >= 0 {
            set = ((*table).set_description)(object, described.as_ptr());
        }
        if set < 0 {
            return Err(format!(
                "the shortcut would not be pointed at totex (Windows says 0x{set:x})"
            ));
        }

        let mut file: *mut c_void = std::ptr::null_mut();
        let asked = ((*table).query)(object, &IID_PERSIST_FILE, &mut file);
        if asked < 0 || file.is_null() {
            return Err(format!(
                "the shortcut cannot be written (Windows says 0x{asked:x})"
            ));
        }
        let file = Object(file);
        let persist = *file.0.cast::<*const PersistFileVtbl>();
        let at = wide(link);
        let saved = ((*persist).save)(file.0, at.as_ptr(), 1);
        drop(file);
        drop(shell);
        if saved < 0 {
            return Err(format!(
                "{} could not be written (Windows says 0x{saved:x})",
                link.display()
            ));
        }
        Ok(())
    }
}

/// One of the folders Windows keeps for this account, as a path.
fn folder(known: &GUID) -> Result<PathBuf, String> {
    unsafe {
        let mut path: PWSTR = std::ptr::null_mut();
        let asked = SHGetKnownFolderPath(known, 0, std::ptr::null_mut(), &mut path);
        if asked < 0 || path.is_null() {
            return Err("Windows will not say where this account's folders are".to_string());
        }
        let mut length = 0;
        while *path.add(length) != 0 {
            length += 1;
        }
        let text = String::from_utf16_lossy(std::slice::from_raw_parts(path, length));
        CoTaskMemFree(path.cast());
        Ok(PathBuf::from(text))
    }
}

/// A COM object, released when it goes.
struct Object(*mut c_void);

impl Drop for Object {
    fn drop(&mut self) {
        // Both interfaces are `IUnknown` first, and `Release` is its third
        // slot in either of them -- which is the whole of what this needs to
        // know about which one it is holding.
        unsafe {
            let table = *self.0.cast::<*const ShellLinkVtbl>();
            ((*table).release)(self.0);
        }
    }
}

/// COM, started for as long as a shortcut is being written.
///
/// Somebody may have started it already on this thread, in which case starting
/// it again is a count rather than a second COM -- and stopping it is the same
/// count going back down. The one answer that is not either of those is a
/// thread that is already in another kind of apartment, which is a thread that
/// can still make a shell link; it is only not ours to shut down.
struct Com(bool);

impl Com {
    fn up() -> Self {
        let started =
            unsafe { CoInitializeEx(std::ptr::null(), COINIT_APARTMENTTHREADED as u32) } >= 0;
        Com(started)
    }
}

impl Drop for Com {
    fn drop(&mut self) {
        if self.0 {
            unsafe { CoUninitialize() };
        }
    }
}

/// `IShellLinkW`, in the order its methods are laid out.
///
/// The ones this does not call are left as addresses. Naming their arguments
/// would be describing calls nobody makes, and getting one of those
/// descriptions wrong would be a way of calling the wrong method.
#[repr(C)]
struct ShellLinkVtbl {
    query: unsafe extern "system" fn(*mut c_void, *const GUID, *mut *mut c_void) -> HRESULT,
    add_ref: *const c_void,
    release: unsafe extern "system" fn(*mut c_void) -> u32,
    get_path: *const c_void,
    get_id_list: *const c_void,
    set_id_list: *const c_void,
    get_description: *const c_void,
    set_description: unsafe extern "system" fn(*mut c_void, PCWSTR) -> HRESULT,
    get_working_directory: *const c_void,
    set_working_directory: unsafe extern "system" fn(*mut c_void, PCWSTR) -> HRESULT,
    get_arguments: *const c_void,
    set_arguments: *const c_void,
    get_hotkey: *const c_void,
    set_hotkey: *const c_void,
    get_show_cmd: *const c_void,
    set_show_cmd: *const c_void,
    get_icon_location: *const c_void,
    set_icon_location: *const c_void,
    set_relative_path: *const c_void,
    resolve: *const c_void,
    set_path: unsafe extern "system" fn(*mut c_void, PCWSTR) -> HRESULT,
}

/// `IPersistFile`, which is `IPersist` with four more on the end.
#[repr(C)]
struct PersistFileVtbl {
    query: *const c_void,
    add_ref: *const c_void,
    release: *const c_void,
    get_class_id: *const c_void,
    is_dirty: *const c_void,
    load: *const c_void,
    save: unsafe extern "system" fn(*mut c_void, PCWSTR, i32) -> HRESULT,
    save_completed: *const c_void,
    get_cur_file: *const c_void,
}
