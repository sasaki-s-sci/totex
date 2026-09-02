//! The colours the window is drawn in, and which half of them this machine
//! asked for.
//!
//! totex's own rather than Windows' greys. The window this puts on the screen
//! is the first thing anybody sees of the app, and a machine set to dark that
//! is handed a white box has been told the app was written for somebody else's
//! Windows -- so the ground, the ink and the bar are the app's own, in the half
//! the machine is set to.
//!
//! What it will not do is argue with a machine set to high contrast. That is
//! not a preference about colours, it is a requirement about them, said once
//! for every program on the machine -- so where it has been said, this window
//! is drawn in the colours it names and totex's are left out of it.
//!
//! What it cannot do is ask the app. Nothing is installed yet, and the person's
//! chosen preset is in a browser's storage inside a copy of totex that does not
//! exist on this machine. So the colours here are the preset totex opens in,
//! written down a second time -- see [`Scheme`], which is where that is said
//! out loud.

use std::ptr::{null, null_mut};

use windows_sys::Wdk::System::SystemServices::RtlGetVersion;
use windows_sys::Win32::Foundation::{COLORREF, ERROR_SUCCESS, HWND, S_OK};
use windows_sys::Win32::Graphics::Dwm::{DWMWA_USE_IMMERSIVE_DARK_MODE, DwmSetWindowAttribute};
use windows_sys::Win32::Graphics::Gdi::{
    COLOR_BTNFACE, COLOR_BTNSHADOW, COLOR_BTNTEXT, COLOR_GRAYTEXT, COLOR_HIGHLIGHT, COLOR_WINDOW,
    CreateSolidBrush, GetSysColor, HBRUSH,
};
use windows_sys::Win32::System::LibraryLoader::{GetProcAddress, LoadLibraryW};
use windows_sys::Win32::System::Registry::{HKEY_CURRENT_USER, RRF_RT_REG_DWORD, RegGetValueW};
use windows_sys::Win32::System::SystemInformation::OSVERSIONINFOW;
use windows_sys::Win32::UI::Accessibility::{HCF_HIGHCONTRASTON, HIGHCONTRASTW};
use windows_sys::Win32::UI::Controls::SetWindowTheme;
use windows_sys::Win32::UI::WindowsAndMessaging::{SPI_GETHIGHCONTRAST, SystemParametersInfoW};

use crate::wide;

/// Six names and a colour apiece: a scheme, cut to what a window of eight
/// controls can actually spend.
///
/// The values are the two halves of Neon, the preset totex opens in --
/// src/theme/presets.ts, where they are written in CSS's order and this file's
/// [`hex`] turns them round. The names are that file's names, so that the two
/// can be read against each other.
///
/// They are a copy, and nothing can catch it going stale: the app's are
/// TypeScript a browser reads, and these are compiled into a program that runs
/// before there is an app on the machine to read anything. Whoever revises Neon
/// revises this beside it.
#[derive(Clone, Copy)]
pub(crate) struct Scheme {
    /// What the window is laid out on.
    pub(crate) ground: COLORREF,
    /// What stands on it: the box that is typed into and the list it drops.
    pub(crate) surface: COLORREF,
    /// The run the bar has yet to cover.
    edge: COLORREF,
    /// What the eye is meant to land on: the heading, the choice, the answer.
    pub(crate) ink: COLORREF,
    /// The line that says what is happening rather than what to do.
    pub(crate) ink_muted: COLORREF,
    /// How far the install has got.
    accent: COLORREF,
}

/// A colour written the way CSS writes one, as the order Windows reads.
const fn hex(rgb: u32) -> COLORREF {
    (rgb & 0xff) << 16 | (rgb & 0xff00) | (rgb >> 16)
}

/// Neon's light half.
const LIGHT: Scheme = Scheme {
    ground: hex(0xeef1f7),
    surface: hex(0xffffff),
    edge: hex(0xd5dcea),
    ink: hex(0x111826),
    ink_muted: hex(0x5a6885),
    accent: hex(0x1f8bff),
};

/// Neon's dark half. Not the light one turned over -- see the app's own note.
const DARK: Scheme = Scheme {
    ground: hex(0x070a11),
    surface: hex(0x141a28),
    edge: hex(0x242e44),
    ink: hex(0xe8edf7),
    ink_muted: hex(0x8d9bb5),
    accent: hex(0x43a5ff),
};

/// Where Windows keeps the answer to which of the two this account asked for.
const PERSONALIZE: &str = "Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize";

/// 1809, where an ordinary program was first allowed to act on that answer.
/// Everything this file does about dark is gated on it: the calls that make a
/// check box dark are exports that did not exist before that build.
const FIRST_DARK_BUILD: u32 = 17763;

/// The colours in use, and the brushes that are those colours.
///
/// Made once, before the window. A brush is a handle Windows holds for as long
/// as anything points at one, and what points at these is the window class
/// itself and every message asking what a control sits on -- which is to say
/// for as long as the program runs. Nothing deletes them, because the thing
/// that would is the program ending, which frees them anyway.
pub(crate) struct Paint {
    pub(crate) scheme: Scheme,
    /// Which half this came out as, for the handful of decisions that are not
    /// simply a colour: the title bar, and the controls that draw their own.
    pub(crate) dark: bool,
    pub(crate) ground: HBRUSH,
    pub(crate) surface: HBRUSH,
    pub(crate) edge: HBRUSH,
    pub(crate) accent: HBRUSH,
}

impl Paint {
    /// Reads the machine and makes the brushes for whichever answer it gave.
    ///
    /// Three answers, in the order they are allowed to win: the colours high
    /// contrast names, then whichever half of totex's own this account is set
    /// to.
    pub(crate) fn chosen() -> Paint {
        if let Some(named) = contrast() {
            return Paint::of(named, false);
        }
        let dark = dark();
        Paint::of(if dark { DARK } else { LIGHT }, dark)
    }

    fn of(scheme: Scheme, dark: bool) -> Paint {
        unsafe {
            Paint {
                scheme,
                dark,
                ground: CreateSolidBrush(scheme.ground),
                surface: CreateSolidBrush(scheme.surface),
                edge: CreateSolidBrush(scheme.edge),
                accent: CreateSolidBrush(scheme.accent),
            }
        }
    }
}

/// The colours a high-contrast machine has named, if it has named any.
///
/// Six of Windows' own, under the names it keeps them by. They are what this
/// window was drawn in before it had colours of its own, so a machine set this
/// way is one nothing here has changed.
fn contrast() -> Option<Scheme> {
    let mut asked = HIGHCONTRASTW {
        cbSize: size_of::<HIGHCONTRASTW>() as u32,
        dwFlags: 0,
        lpszDefaultScheme: null_mut(),
    };
    let told = unsafe {
        SystemParametersInfoW(
            SPI_GETHIGHCONTRAST,
            asked.cbSize,
            (&raw mut asked).cast(),
            0,
        )
    };
    if told == 0 || asked.dwFlags & HCF_HIGHCONTRASTON == 0 {
        return None;
    }
    unsafe {
        Some(Scheme {
            ground: GetSysColor(COLOR_BTNFACE),
            surface: GetSysColor(COLOR_WINDOW),
            edge: GetSysColor(COLOR_BTNSHADOW),
            ink: GetSysColor(COLOR_BTNTEXT),
            ink_muted: GetSysColor(COLOR_GRAYTEXT),
            accent: GetSysColor(COLOR_HIGHLIGHT),
        })
    }
}

/// Whether this machine is set to dark and is new enough to be drawn that way.
///
/// The setting is the one the Settings app writes and every dark program reads.
/// A machine that has never been told has no value there at all, which is the
/// light it shipped in.
fn dark() -> bool {
    build() >= FIRST_DARK_BUILD && setting("AppsUseLightTheme") == Some(0)
}

/// One number out of this account's colour settings, if it is there.
fn setting(name: &str) -> Option<u32> {
    let path = wide(PERSONALIZE);
    let name = wide(name);
    let mut value = 0u32;
    let mut room = size_of::<u32>() as u32;
    let asked = unsafe {
        RegGetValueW(
            HKEY_CURRENT_USER,
            path.as_ptr(),
            name.as_ptr(),
            RRF_RT_REG_DWORD,
            null_mut(),
            (&raw mut value).cast(),
            &mut room,
        )
    };
    (asked == ERROR_SUCCESS).then_some(value)
}

/// Which Windows this actually is.
///
/// Asked of the kernel rather than of `GetVersionEx`, which answers with the
/// newest Windows the program's manifest claims to have been written for. That
/// would be a true answer here and a false one in a build made where no
/// resource compiler could put the manifest in -- which is exactly the build
/// somebody looks at this window in.
fn build() -> u32 {
    unsafe {
        let mut version: OSVERSIONINFOW = std::mem::zeroed();
        version.dwOSVersionInfoSize = size_of::<OSVERSIONINFOW>() as u32;
        if RtlGetVersion(&mut version) != 0 {
            return 0;
        }
        version.dwBuildNumber
    }
}

/// Says this program is one of the ones that draws itself dark.
///
/// There is no documented way to say it. What the shell itself calls is
/// uxtheme's 135th export, which is exported by number and under no name at
/// all, so a number is the only way to ask for it -- and it is only asked for
/// on the builds known to have one, with a machine that answers with nothing
/// left as it was.
///
/// Two functions have stood there. 1809 had `AllowDarkModeForApp`, which takes
/// a yes or a no; 1903 replaced it with `SetPreferredAppMode`, which takes one
/// of four modes. Two means force on the newer one and yes on the older, which
/// is why two is what is passed. Forcing rather than allowing is what saves a
/// second undocumented call per control: allowing leaves each window to be told
/// separately, and every control on this one wants the same answer.
///
/// What it buys is the tick in the check box, the arrow on the drop-down and
/// the scrollbar down the list it drops. Those are drawn by the theme rather
/// than by any colour set below, and without this the theme has only the light
/// set to draw them from.
pub(crate) unsafe fn allow_dark() {
    unsafe {
        let uxtheme = LoadLibraryW(wide("uxtheme.dll").as_ptr());
        if uxtheme.is_null() {
            return;
        }
        if let Some(mode) = GetProcAddress(uxtheme, std::ptr::without_provenance(135)) {
            let mode: unsafe extern "system" fn(i32) -> i32 = std::mem::transmute(mode);
            mode(2);
        }
        // What reads the setting again now that the answer above has changed.
        if let Some(refresh) = GetProcAddress(uxtheme, std::ptr::without_provenance(104)) {
            let refresh: unsafe extern "system" fn() = std::mem::transmute(refresh);
            refresh();
        }
    }
}

/// Makes the title bar dark, which is the one part of the window that is not
/// this program's to paint.
///
/// Two numbers name the same thing: 20 is what it was documented as, and 19 is
/// where it sat on the two builds that had it before that. Asking for the
/// documented one first and the other only if it is turned down is the whole of
/// telling those apart.
pub(crate) unsafe fn dress_window(window: HWND) {
    unsafe {
        let on = 1i32;
        let told = |attribute| {
            DwmSetWindowAttribute(
                window,
                attribute,
                (&raw const on).cast(),
                size_of::<i32>() as u32,
            )
        };
        if told(DWMWA_USE_IMMERSIVE_DARK_MODE as u32) != S_OK {
            told(DWMWA_USE_IMMERSIVE_DARK_MODE as u32 - 1);
        }
    }
}

/// Puts a control on the dark set of the parts it draws for itself.
///
/// The names are the shell's own -- `DarkMode_CFD` is what a file dialog dresses
/// its boxes in, `DarkMode_Explorer` what the window around it dresses its
/// buttons in. A theme without them leaves the control looking exactly as it
/// looked before, which is why this is safe to say to any of them.
pub(crate) unsafe fn dress_control(control: HWND, class: &str) {
    unsafe { SetWindowTheme(control, wide(class).as_ptr(), null()) };
}
