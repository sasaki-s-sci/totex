//! The window procedure: every message Windows sends, and what it means here.

use windows_sys::Win32::Foundation::{COLORREF, HWND, LPARAM, LRESULT, RECT, WPARAM};
use windows_sys::Win32::Graphics::Gdi::{
    COLOR_BTNFACE, GetSysColor, GetSysColorBrush, HDC, SetBkColor,
};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    CREATESTRUCTW, DefWindowProcW, GWLP_USERDATA, GetWindowLongPtrW, PostQuitMessage, SWP_NOZORDER,
    SetWindowLongPtrW, SetWindowPos, WM_COMMAND, WM_CREATE, WM_CTLCOLORSTATIC, WM_DESTROY,
    WM_DPICHANGED, WM_NCCREATE,
};

use crate::screen::{draw, offer, start};
use crate::window::{build, centre, lay_out};
use crate::work::which_versions;
use crate::{App, DC_HASDEFID, DM_GETDEFID, ID_CLOSE, ID_INSTALL, Poke, WM_TOLD, WM_VERSIONS};

pub(crate) unsafe extern "system" fn handle(
    window: HWND,
    message: u32,
    the: WPARAM,
    parameter: LPARAM,
) -> LRESULT {
    unsafe {
        if message == WM_NCCREATE {
            let created = parameter as *const CREATESTRUCTW;
            let app = (*created).lpCreateParams as *mut App;
            (*app).window = window;
            SetWindowLongPtrW(window, GWLP_USERDATA, app as isize);
            return DefWindowProcW(window, message, the, parameter);
        }
        let app = GetWindowLongPtrW(window, GWLP_USERDATA) as *mut App;
        if app.is_null() {
            return DefWindowProcW(window, message, the, parameter);
        }
        let app = &mut *app;

        match message {
            WM_CREATE => {
                build(app);
                centre(window);
                let told = app.told.clone();
                let poke = Poke(window);
                std::thread::spawn(move || which_versions(poke, told));
                0
            }
            WM_COMMAND => {
                match (the & 0xffff) as i32 {
                    ID_INSTALL => start(app),
                    ID_CLOSE => PostQuitMessage(0),
                    _ => {}
                }
                0
            }
            WM_TOLD => {
                draw(app);
                0
            }
            WM_VERSIONS => {
                offer(app);
                0
            }
            // Every label and the checkbox sit on the window's own grey, which
            // is not the colour a static control paints behind itself unless
            // it is told.
            WM_CTLCOLORSTATIC => {
                SetBkColor(the as HDC, GetSysColor(COLOR_BTNFACE) as COLORREF);
                GetSysColorBrush(COLOR_BTNFACE) as LRESULT
            }
            WM_DPICHANGED => {
                let suggested = parameter as *const RECT;
                SetWindowPos(
                    window,
                    std::ptr::null_mut(),
                    (*suggested).left,
                    (*suggested).top,
                    (*suggested).right - (*suggested).left,
                    (*suggested).bottom - (*suggested).top,
                    SWP_NOZORDER,
                );
                lay_out(app);
                0
            }
            DM_GETDEFID => ((DC_HASDEFID as isize) << 16) | ID_INSTALL as isize,
            WM_DESTROY => {
                PostQuitMessage(0);
                0
            }
            _ => DefWindowProcW(window, message, the, parameter),
        }
    }
}
