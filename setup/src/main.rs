//! The installer somebody downloads once and keeps.
//!
//! Nothing in this file names a version of totex. What it installs is decided
//! by the release page it reads when the button is pressed, which is what makes
//! it worth keeping: the copy downloaded today installs whatever is newest a
//! year from now, and the copy downloaded a year from now still installs the
//! version asked for by name here. That is what the two install scripts have
//! always been, and this is the same thing for somebody who would rather click
//! than paste — released on its own cycle, because it moves when the installer
//! moves rather than when the app does.
//!
//! What it does not do is skip the check. The scripts turn down anything not
//! signed with the key totex is released with, and so does this — but without
//! sending anybody off to install a verifier first, because the one thing a
//! person who came here to click will not do is that.

#![windows_subsystem = "windows"]

mod install;
mod proc;
mod release;
mod screen;
mod web;
mod window;
mod work;

use std::sync::{Arc, Mutex};

use windows_sys::Win32::Foundation::HWND;
use windows_sys::Win32::Graphics::Gdi::{COLOR_BTNFACE, GetSysColorBrush, HFONT};
use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
use windows_sys::Win32::UI::Controls::{
    ICC_PROGRESS_CLASS, INITCOMMONCONTROLSEX, InitCommonControlsEx,
};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    CW_USEDEFAULT, CreateWindowExW, DispatchMessageW, GetMessageW, IDC_ARROW, IDCANCEL, IDOK,
    IMAGE_ICON, IsDialogMessageW, LR_DEFAULTSIZE, LoadCursorW, LoadImageW, MSG, PostMessageW,
    RegisterClassW, SW_SHOW, ShowWindow, TranslateMessage, WM_APP, WM_USER, WNDCLASSW, WS_CAPTION,
    WS_EX_CONTROLPARENT, WS_MINIMIZEBOX, WS_SYSMENU,
};

/// The window's own strings, in one place because they are half of what this
/// program is.
const TITLE: &str = "Install totex";
const HEADING: &str = "Which totex to put on this machine";
const NEWEST: &str = "The newest release";
const EVERYONE: &str = "For every account on this machine — the .msi, which asks for administrator";
const HINT: &str = "Any released version can be asked for by name.";

/// What the controls answer to. The first two are the dialog manager's own
/// numbers, so that Enter presses Install and Escape presses Close without
/// either being wired up.
const ID_INSTALL: i32 = IDOK;
const ID_CLOSE: i32 = IDCANCEL;
const ID_VERSION: i32 = 100;
const ID_EVERYONE: i32 = 101;
const ID_HEADING: i32 = 102;
const ID_STATUS: i32 = 103;
const ID_BAR: i32 = 104;

/// Something a working thread has changed, and the list of releases arriving.
const WM_TOLD: u32 = WM_APP + 1;
const WM_VERSIONS: u32 = WM_APP + 2;

/// Which button Enter presses. A real dialog answers this for itself; a plain
/// window has to be told to, and these two numbers are the whole of what
/// telling it looks like.
const DM_GETDEFID: u32 = WM_USER;
const DC_HASDEFID: i32 = 0x534B;

/// Everything a working thread says, read by the window when it is poked.
///
/// A lock rather than a message carrying the words: a download says how far it
/// has got several hundred times, and what the window wants at any moment is
/// the last of those rather than all of them.
#[derive(Default)]
struct Told {
    status: String,
    bar: Option<(usize, Option<usize>)>,
    working: bool,
    versions: Vec<String>,
}

/// A window handle a thread is allowed to poke.
///
/// Poking is the only thing done with it. Everything the window then draws it
/// reads from the lock above, on its own thread, which is the only thread any
/// of these controls is touched from.
#[derive(Clone, Copy)]
struct Poke(HWND);

unsafe impl Send for Poke {}

impl Poke {
    fn tell(self, what: u32) {
        unsafe { PostMessageW(self.0, what, 0, 0) };
    }
}

/// The window and the handful of controls on it.
struct App {
    window: HWND,
    heading: HWND,
    version: HWND,
    everyone: HWND,
    status: HWND,
    bar: HWND,
    button: HWND,
    close: HWND,
    font: HFONT,
    told: Arc<Mutex<Told>>,
}

fn main() {
    unsafe {
        let common = INITCOMMONCONTROLSEX {
            dwSize: size_of::<INITCOMMONCONTROLSEX>() as u32,
            dwICC: ICC_PROGRESS_CLASS,
        };
        InitCommonControlsEx(&common);

        let instance = GetModuleHandleW(std::ptr::null());
        let class_name = wide("totex-setup");
        let class = WNDCLASSW {
            style: 0,
            lpfnWndProc: Some(proc::handle),
            cbClsExtra: 0,
            cbWndExtra: 0,
            hInstance: instance,
            // The icon is compiled in as resource one, and a resource is
            // asked for by number by handing over an address that is the
            // number. A build made where no resource compiler could be found
            // has no icon, and a window with the default one is still a
            // window.
            hIcon: LoadImageW(
                instance,
                std::ptr::without_provenance(1),
                IMAGE_ICON,
                0,
                0,
                LR_DEFAULTSIZE,
            )
            .cast(),
            hCursor: LoadCursorW(std::ptr::null_mut(), IDC_ARROW),
            hbrBackground: GetSysColorBrush(COLOR_BTNFACE),
            lpszMenuName: std::ptr::null(),
            lpszClassName: class_name.as_ptr(),
        };
        RegisterClassW(&class);

        let app = Box::into_raw(Box::new(App {
            window: std::ptr::null_mut(),
            heading: std::ptr::null_mut(),
            version: std::ptr::null_mut(),
            everyone: std::ptr::null_mut(),
            status: std::ptr::null_mut(),
            bar: std::ptr::null_mut(),
            button: std::ptr::null_mut(),
            close: std::ptr::null_mut(),
            font: std::ptr::null_mut(),
            told: Arc::new(Mutex::new(Told {
                status: HINT.to_string(),
                ..Told::default()
            })),
        }));

        let window = CreateWindowExW(
            WS_EX_CONTROLPARENT,
            class_name.as_ptr(),
            wide(TITLE).as_ptr(),
            // No sizing border and no maximise: there is nothing on this
            // window that a second row of pixels would show more of.
            WS_CAPTION | WS_SYSMENU | WS_MINIMIZEBOX,
            CW_USEDEFAULT,
            CW_USEDEFAULT,
            CW_USEDEFAULT,
            CW_USEDEFAULT,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            instance,
            app.cast(),
        );
        if window.is_null() {
            return;
        }
        ShowWindow(window, SW_SHOW);

        let mut message: MSG = std::mem::zeroed();
        while GetMessageW(&mut message, std::ptr::null_mut(), 0, 0) > 0 {
            // What gives a plain window Tab between its controls, a space that
            // presses the one with focus, and Enter and Escape.
            if IsDialogMessageW(window, &message) == 0 {
                TranslateMessage(&message);
                DispatchMessageW(&message);
            }
        }
    }
}

/// UTF-16 with a nul on the end, which is what every one of these takes.
pub(crate) fn wide(text: &str) -> Vec<u16> {
    text.encode_utf16().chain(std::iter::once(0)).collect()
}
