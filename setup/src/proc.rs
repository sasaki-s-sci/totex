//! The window procedure: every message Windows sends, and what it means here.

use windows_sys::Win32::Foundation::{HWND, LPARAM, LRESULT, RECT, WPARAM};
use windows_sys::Win32::Graphics::Gdi::{HDC, SetBkColor, SetTextColor};
use windows_sys::Win32::UI::Controls::DRAWITEMSTRUCT;
use windows_sys::Win32::UI::WindowsAndMessaging::{
    CREATESTRUCTW, DefWindowProcW, GWLP_USERDATA, GetWindowLongPtrW, PostQuitMessage, SWP_NOZORDER,
    SetWindowLongPtrW, SetWindowPos, WM_COMMAND, WM_CREATE, WM_CTLCOLORBTN, WM_CTLCOLOREDIT,
    WM_CTLCOLORLISTBOX, WM_CTLCOLORSTATIC, WM_DESTROY, WM_DPICHANGED, WM_DRAWITEM, WM_NCCREATE,
};

use crate::paint::dress_window;
use crate::screen::{bar, draw, offer, start};
use crate::window::{build, centre, lay_out};
use crate::work::which_versions;
use crate::{
    App, DC_HASDEFID, DM_GETDEFID, ID_BAR, ID_CLOSE, ID_INSTALL, Poke, WM_TOLD, WM_VERSIONS,
};

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
                // The one part of a window a program does not paint. Said
                // before it is shown, so that a dark window is not a light
                // title bar for the frame it takes to be told.
                if app.paint.dark {
                    dress_window(window);
                }
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
            // Every label and the check box sit on the window's own ground,
            // which is not the colour a control paints behind itself unless it
            // is told. The status line is given the quieter of the two inks: it
            // says what is happening rather than what there is to decide.
            WM_CTLCOLORSTATIC | WM_CTLCOLORBTN => {
                let ink = if parameter as HWND == app.status {
                    app.paint.scheme.ink_muted
                } else {
                    app.paint.scheme.ink
                };
                SetTextColor(the as HDC, ink);
                SetBkColor(the as HDC, app.paint.scheme.ground);
                app.paint.ground as LRESULT
            }
            // The box a version is typed into, and the list it drops, stand on
            // the ground rather than being part of it.
            WM_CTLCOLOREDIT | WM_CTLCOLORLISTBOX => {
                SetTextColor(the as HDC, app.paint.scheme.ink);
                SetBkColor(the as HDC, app.paint.scheme.surface);
                app.paint.surface as LRESULT
            }
            // The progress bar is drawn here rather than by comctl32, which
            // draws one in its own green on its own near-white however the
            // window around it is painted. See `screen::bar`.
            WM_DRAWITEM if the as i32 == ID_BAR => {
                bar(app, &*(parameter as *const DRAWITEMSTRUCT));
                1
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
