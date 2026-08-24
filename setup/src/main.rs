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
mod release;
mod web;

use std::panic::AssertUnwindSafe;
use std::sync::{Arc, Mutex};

use windows_sys::Win32::Foundation::{COLORREF, HWND, LPARAM, LRESULT, RECT, WPARAM};
use windows_sys::Win32::Graphics::Gdi::{
    COLOR_BTNFACE, CreateFontIndirectW, DeleteObject, GetSysColor, GetSysColorBrush, HDC, HFONT,
    LOGFONTW, SetBkColor,
};
use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
use windows_sys::Win32::UI::Controls::{
    ICC_PROGRESS_CLASS, INITCOMMONCONTROLSEX, InitCommonControlsEx, PBM_SETPOS, PBM_SETRANGE32,
};
use windows_sys::Win32::UI::HiDpi::{AdjustWindowRectExForDpi, GetDpiForSystem, GetDpiForWindow};
use windows_sys::Win32::UI::Input::KeyboardAndMouse::EnableWindow;
use windows_sys::Win32::UI::WindowsAndMessaging::{
    BM_GETCHECK, BS_AUTOCHECKBOX, BS_DEFPUSHBUTTON, BS_MULTILINE, BS_PUSHBUTTON, CB_ADDSTRING,
    CB_SETCURSEL, CBS_AUTOHSCROLL, CBS_DROPDOWN, CREATESTRUCTW, CW_USEDEFAULT, CreateWindowExW,
    DefWindowProcW, DispatchMessageW, GWLP_USERDATA, GetMessageW, GetSystemMetrics,
    GetWindowLongPtrW, GetWindowRect, GetWindowTextW, IDC_ARROW, IDCANCEL, IDOK, IMAGE_ICON,
    IsDialogMessageW, LR_DEFAULTSIZE, LoadCursorW, LoadImageW, MSG, MoveWindow, NONCLIENTMETRICSW,
    PostMessageW, PostQuitMessage, RegisterClassW, SM_CXSCREEN, SM_CYSCREEN,
    SPI_GETNONCLIENTMETRICS, SW_SHOW, SWP_NOMOVE, SWP_NOSIZE, SWP_NOZORDER, SendMessageW,
    SetWindowLongPtrW, SetWindowPos, SetWindowTextW, ShowWindow, SystemParametersInfoW,
    TranslateMessage, WM_APP, WM_COMMAND, WM_CREATE, WM_CTLCOLORSTATIC, WM_DESTROY, WM_DPICHANGED,
    WM_NCCREATE, WM_SETFONT, WM_USER, WNDCLASSW, WS_CAPTION, WS_CHILD, WS_EX_CONTROLPARENT,
    WS_MINIMIZEBOX, WS_SYSMENU, WS_TABSTOP, WS_VISIBLE, WS_VSCROLL,
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
            lpfnWndProc: Some(handle),
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

unsafe extern "system" fn handle(
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

// --- the window ---------------------------------------------------------------

/// Makes the controls. Where they go is [`lay_out`]'s, which runs again every
/// time the window is dragged onto a screen of another density.
unsafe fn build(app: &mut App) {
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
unsafe fn lay_out(app: &mut App) {
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
unsafe fn centre(window: HWND) {
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
unsafe fn font(dpi: u32) -> HFONT {
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
unsafe fn control(parent: HWND, class: &str, text: &str, style: u32, id: i32) -> HWND {
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

/// Draws whatever a working thread last said.
unsafe fn draw(app: &App) {
    unsafe {
        let told = app.told.lock().unwrap_or_else(|held| held.into_inner());
        SetWindowTextW(app.status, wide(&told.status).as_ptr());
        match told.bar {
            // A download whose length the server would not say still moves the
            // window's words; there is just nothing honest to fill a bar with.
            Some((done, Some(total))) if total > 0 => {
                SendMessageW(app.bar, PBM_SETRANGE32, 0, 1000);
                SendMessageW(app.bar, PBM_SETPOS, done * 1000 / total, 0);
            }
            _ => {
                SendMessageW(app.bar, PBM_SETPOS, 0, 0);
            }
        }
        let asking = if told.working { 0 } else { 1 };
        EnableWindow(app.button, asking);
        EnableWindow(app.version, asking);
        EnableWindow(app.everyone, asking);
    }
}

/// Fills the box with the releases there are, once they are known.
unsafe fn offer(app: &App) {
    unsafe {
        let told = app.told.lock().unwrap_or_else(|held| held.into_inner());
        for version in &told.versions {
            SendMessageW(
                app.version,
                CB_ADDSTRING,
                0,
                wide(version).as_ptr() as isize,
            );
        }
    }
}

/// Reads what was asked for and sets a thread going.
unsafe fn start(app: &mut App) {
    unsafe {
        {
            let told = app.told.lock().unwrap_or_else(|held| held.into_inner());
            if told.working {
                return;
            }
        }

        let asked = match wanted(app.version) {
            Ok(asked) => asked,
            Err(complaint) => {
                say(&app.told, Poke(app.window), &complaint);
                return;
            }
        };
        let msi = SendMessageW(app.everyone, BM_GETCHECK, 0, 0) == 1;

        {
            let mut told = app.told.lock().unwrap_or_else(|held| held.into_inner());
            told.working = true;
            told.status = "Reading the release page".to_string();
            told.bar = None;
        }
        draw(app);

        let told = app.told.clone();
        let poke = Poke(app.window);
        std::thread::spawn(move || do_it(poke, told, asked, msi));
    }
}

/// Which version the box is asking for, or why it is not asking for one.
///
/// The box can be typed into as well as chosen from, so that a release older
/// than the thirty this offers is still a release this installs.
unsafe fn wanted(box_: HWND) -> Result<Option<String>, String> {
    let mut text = [0u16; 64];
    let written = unsafe { GetWindowTextW(box_, text.as_mut_ptr(), text.len() as i32) };
    let text = String::from_utf16_lossy(&text[..written.max(0) as usize]);
    let text = text.trim();
    if text.is_empty() || text == NEWEST {
        return Ok(None);
    }
    let version = text.strip_prefix('v').unwrap_or(text);
    if !release::is_version(version) {
        return Err(format!("{text} is not a version"));
    }
    Ok(Some(version.to_string()))
}

// --- the work -------------------------------------------------------------

/// Says a thing, and pokes the window into drawing it.
fn say(told: &Arc<Mutex<Told>>, poke: Poke, what: &str) {
    told.lock().unwrap_or_else(|held| held.into_inner()).status = what.to_string();
    poke.tell(WM_TOLD);
}

/// The whole of an install, on a thread of its own so that the window keeps
/// answering while it happens.
fn do_it(poke: Poke, told: Arc<Mutex<Told>>, asked: Option<String>, msi: bool) {
    let ending = match std::panic::catch_unwind(AssertUnwindSafe(|| {
        fetch(poke, &told, asked.as_deref(), msi)
    })) {
        Ok(Ok(said)) | Ok(Err(said)) => said,
        Err(_) => "The installer stopped in a way it cannot explain".to_string(),
    };
    {
        let mut told = told.lock().unwrap_or_else(|held| held.into_inner());
        told.status = ending;
        told.working = false;
        told.bar = None;
    }
    poke.tell(WM_TOLD);
}

fn fetch(
    poke: Poke,
    told: &Arc<Mutex<Told>>,
    asked: Option<&str>,
    msi: bool,
) -> Result<String, String> {
    let kind = if msi {
        release::Kind::Msi
    } else {
        release::Kind::Exe
    };

    say(told, poke, "Reading the release page");
    let manifest = web::get(
        &release::manifest_url(asked),
        release::MANIFEST_MOST,
        None,
        |_, _| {},
    )
    .map_err(|why| match asked {
        Some(version) => format!("There is no totex {version} to install — {why}"),
        None => why,
    })?;
    let bundle = release::bundle(&manifest, asked, kind)?;

    say(told, poke, &format!("Downloading totex {}", bundle.version));
    let downloaded = web::get(&bundle.url, release::BUNDLE_MOST, None, |done, total| {
        told.lock().unwrap_or_else(|held| held.into_inner()).bar = Some((done, total));
        poke.tell(WM_TOLD);
    })?;

    say(told, poke, "Checking the signature");
    release::ours(&downloaded, &bundle.signature)?;

    say(told, poke, "Handing over to the installer");
    let kept = install::keep(&bundle.file_name(), &downloaded)?;
    let code = install::run(&kept, msi)?;
    install::what_happened(&bundle.version, code)
}

/// Asks the release page what there is, so the box can offer it.
///
/// Nothing waits on this and nothing fails without it: the box takes a typed
/// version whether this answers or not, which is what keeps a rate limit on an
/// address anybody can read from being something that stops an install.
fn which_versions(poke: Poke, told: Arc<Mutex<Told>>) {
    let Ok(listing) = web::get(
        &release::listing_url(),
        release::LISTING_MOST,
        Some("Accept: application/vnd.github+json\r\n"),
        |_, _| {},
    ) else {
        return;
    };
    let versions = release::versions(&listing);
    if versions.is_empty() {
        return;
    }
    told.lock()
        .unwrap_or_else(|held| held.into_inner())
        .versions = versions;
    poke.tell(WM_VERSIONS);
}

/// UTF-16 with a nul on the end, which is what every one of these takes.
fn wide(text: &str) -> Vec<u16> {
    text.encode_utf16().chain(std::iter::once(0)).collect()
}
