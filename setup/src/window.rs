//! The window itself: the controls, where they go, and how big they are on a
//! screen of whatever density this one is.

use windows_sys::Win32::Foundation::{HWND, RECT};
use windows_sys::Win32::Graphics::Gdi::{CreateFontIndirectW, DeleteObject, HFONT, LOGFONTW};
use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
use windows_sys::Win32::UI::HiDpi::{AdjustWindowRectExForDpi, GetDpiForSystem, GetDpiForWindow};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    BS_AUTOCHECKBOX, BS_DEFPUSHBUTTON, BS_MULTILINE, BS_PUSHBUTTON, CB_ADDSTRING, CB_SETCURSEL,
    CBS_AUTOHSCROLL, CBS_DROPDOWN, CreateWindowExW, GetSystemMetrics, GetWindowRect, MoveWindow,
    NONCLIENTMETRICSW, SM_CXSCREEN, SM_CYSCREEN, SPI_GETNONCLIENTMETRICS, SWP_NOMOVE, SWP_NOSIZE,
    SWP_NOZORDER, SendMessageW, SetWindowPos, SystemParametersInfoW, WM_SETFONT, WS_CAPTION,
    WS_CHILD, WS_EX_CONTROLPARENT, WS_MINIMIZEBOX, WS_SYSMENU, WS_TABSTOP, WS_VISIBLE, WS_VSCROLL,
};

use crate::{
    App, EVERYONE, HEADING, HINT, ID_BAR, ID_CLOSE, ID_EVERYONE, ID_HEADING, ID_INSTALL, ID_STATUS,
    ID_VERSION, NEWEST, wide,
};

/// Makes the controls. Where they go is [`lay_out`]'s, which runs again every
/// time the window is dragged onto a screen of another density.
pub(crate) unsafe fn build(app: &mut App) {
    unsafe {
        let child = WS_CHILD | WS_VISIBLE;
        app.heading = control(app.window, "STATIC", HEADING, child, ID_HEADING);
        app.version = control(
            app.window,
            "COMBOBOX",
            "",
            child | WS_TABSTOP | WS_VSCROLL | CBS_DROPDOWN as u32 | CBS_AUTOHSCROLL as u32,
            ID_VERSION,
        );
        app.everyone = control(
            app.window,
            "BUTTON",
            EVERYONE,
            child | WS_TABSTOP | BS_AUTOCHECKBOX as u32 | BS_MULTILINE as u32,
            ID_EVERYONE,
        );
        app.status = control(app.window, "STATIC", HINT, child, ID_STATUS);
        app.bar = control(app.window, "msctls_progress32", "", child, ID_BAR);
        app.button = control(
            app.window,
            "BUTTON",
            "Install",
            child | WS_TABSTOP | BS_DEFPUSHBUTTON as u32,
            ID_INSTALL,
        );
        app.close = control(
            app.window,
            "BUTTON",
            "Close",
            child | WS_TABSTOP | BS_PUSHBUTTON as u32,
            ID_CLOSE,
        );

        SendMessageW(app.version, CB_ADDSTRING, 0, wide(NEWEST).as_ptr() as isize);
        SendMessageW(app.version, CB_SETCURSEL, 0, 0);
        lay_out(app);
    }
}

/// Where everything goes, in the units the window is drawn in rather than in
/// pixels: a screen at twice the density gets the same window twice the size,
/// which is the whole of what a per-monitor installer has to do.
pub(crate) unsafe fn lay_out(app: &mut App) {
    unsafe {
        let dpi = GetDpiForWindow(app.window).max(96);
        let at = |logical: i32| logical * dpi as i32 / 96;

        let worn_out = app.font;
        app.font = font(dpi);

        // Logical, at 96 to the inch: a margin, a row of controls down the
        // middle of it, and two buttons on the bottom right.
        const WIDE: i32 = 452;
        const TALL: i32 = 240;
        const EDGE: i32 = 18;
        const INNER: i32 = WIDE - EDGE * 2;
        const BUTTON: i32 = 104;

        let place = |control: HWND, x: i32, y: i32, width: i32, height: i32| {
            SendMessageW(control, WM_SETFONT, app.font as usize, 1);
            MoveWindow(control, at(x), at(y), at(width), at(height), 1);
        };
        place(app.heading, EDGE, 16, INNER, 20);
        // A combo box is told the height of the list it drops as well as the
        // height of the box, and is the one control here that is given both.
        place(app.version, EDGE, 42, INNER, 240);
        // Both of these are given the room a sentence takes when it wraps,
        // which is more than it takes here in English on this screen.
        place(app.everyone, EDGE, 80, INNER, 34);
        place(app.status, EDGE, 120, INNER, 48);
        place(app.bar, EDGE, 174, INNER, 8);
        place(app.button, WIDE - EDGE - BUTTON * 2 - 10, 194, BUTTON, 28);
        place(app.close, WIDE - EDGE - BUTTON, 194, BUTTON, 28);
        if !worn_out.is_null() {
            DeleteObject(worn_out.cast());
        }

        // The window is sized around that rather than the other way round: a
        // title bar is not the same height on every screen either. Where it
        // sits is left alone, because one of the two times this runs is a
        // window being dragged onto a second screen, and a window that jumps
        // out from under the pointer is worse than one that resizes under it.
        let mut wanted = RECT {
            left: 0,
            top: 0,
            right: at(WIDE),
            bottom: at(TALL),
        };
        AdjustWindowRectExForDpi(
            &mut wanted,
            WS_CAPTION | WS_SYSMENU | WS_MINIMIZEBOX,
            0,
            WS_EX_CONTROLPARENT,
            dpi,
        );
        SetWindowPos(
            app.window,
            std::ptr::null_mut(),
            0,
            0,
            wanted.right - wanted.left,
            wanted.bottom - wanted.top,
            SWP_NOZORDER | SWP_NOMOVE,
        );
    }
}

/// Puts the window in the middle of the screen, once, before it is shown.
pub(crate) unsafe fn centre(window: HWND) {
    unsafe {
        let mut here = RECT {
            left: 0,
            top: 0,
            right: 0,
            bottom: 0,
        };
        GetWindowRect(window, &mut here);
        let (width, height) = (here.right - here.left, here.bottom - here.top);
        SetWindowPos(
            window,
            std::ptr::null_mut(),
            (GetSystemMetrics(SM_CXSCREEN) - width) / 2,
            (GetSystemMetrics(SM_CYSCREEN) - height) / 2,
            0,
            0,
            SWP_NOZORDER | SWP_NOSIZE,
        );
    }
}

/// The font the rest of Windows is written in, at this window's density.
pub(crate) unsafe fn font(dpi: u32) -> HFONT {
    unsafe {
        let mut metrics: NONCLIENTMETRICSW = std::mem::zeroed();
        metrics.cbSize = size_of::<NONCLIENTMETRICSW>() as u32;
        if SystemParametersInfoW(
            SPI_GETNONCLIENTMETRICS,
            metrics.cbSize,
            (&raw mut metrics).cast(),
            0,
        ) == 0
        {
            return std::ptr::null_mut();
        }
        let mut face: LOGFONTW = metrics.lfMessageFont;
        // What the system says is already in the density the system runs at,
        // which is not this window's if it has been dragged onto another
        // screen.
        face.lfHeight = face.lfHeight * dpi as i32 / GetDpiForSystem().max(96) as i32;
        CreateFontIndirectW(&face)
    }
}

/// One control, made and left where [`lay_out`] will put it.
pub(crate) unsafe fn control(parent: HWND, class: &str, text: &str, style: u32, id: i32) -> HWND {
    unsafe {
        CreateWindowExW(
            0,
            wide(class).as_ptr(),
            wide(text).as_ptr(),
            style,
            0,
            0,
            0,
            0,
            parent,
            id as isize as *mut core::ffi::c_void,
            GetModuleHandleW(std::ptr::null()),
            std::ptr::null(),
        )
    }
}
