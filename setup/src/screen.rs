//! What the window shows: whatever a working thread last said, the releases
//! there are, and what was asked for.

use windows_sys::Win32::Foundation::{HWND, RECT};
use windows_sys::Win32::Graphics::Gdi::{FillRect, InvalidateRect};
use windows_sys::Win32::UI::Controls::DRAWITEMSTRUCT;
use windows_sys::Win32::UI::Input::KeyboardAndMouse::EnableWindow;
use windows_sys::Win32::UI::WindowsAndMessaging::{
    BM_GETCHECK, CB_ADDSTRING, GetWindowTextW, SendMessageW, SetWindowTextW,
};

use crate::work::{do_it, say};
use crate::{App, NEWEST, Poke, release, wide};

/// Draws whatever a working thread last said.
pub(crate) unsafe fn draw(app: &App) {
    unsafe {
        let told = app.told.lock().unwrap_or_else(|held| held.into_inner());
        SetWindowTextW(app.status, wide(&told.status).as_ptr());
        // Asked for rather than drawn: `bar` reads the same lock this is
        // holding, and the window paints it once this has let go.
        InvalidateRect(app.bar, std::ptr::null(), 0);
        let asking = if told.working { 0 } else { 1 };
        EnableWindow(app.button, asking);
        EnableWindow(app.version, asking);
        EnableWindow(app.desktop, asking);
    }
}

/// Draws the bar: how far the install has got, and how far there is to go.
///
/// Two rectangles and no more. What makes it worth drawing rather than asking
/// comctl32 for is the colours -- see `window::build`, which is where this
/// stopped being a progress bar and became a static that is painted.
pub(crate) unsafe fn bar(app: &App, item: &DRAWITEMSTRUCT) {
    unsafe {
        let told = app.told.lock().unwrap_or_else(|held| held.into_inner());
        let width = item.rcItem.right - item.rcItem.left;
        let done = match told.bar {
            // A download whose length the server would not say still moves the
            // window's words; there is just nothing honest to fill a bar with.
            Some((done, Some(total))) if total > 0 => {
                (width as i64 * done as i64 / total as i64).clamp(0, width as i64) as i32
            }
            _ => 0,
        };
        FillRect(item.hDC, &item.rcItem, app.paint.edge);
        FillRect(
            item.hDC,
            &RECT {
                right: item.rcItem.left + done,
                ..item.rcItem
            },
            app.paint.accent,
        );
    }
}

/// Fills the box with the releases there are, once they are known.
pub(crate) unsafe fn offer(app: &App) {
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
pub(crate) unsafe fn start(app: &mut App) {
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
        let desktop = SendMessageW(app.desktop, BM_GETCHECK, 0, 0) == 1;

        {
            let mut told = app.told.lock().unwrap_or_else(|held| held.into_inner());
            told.working = true;
            told.status = "Reading the release page".to_string();
            told.bar = None;
        }
        draw(app);

        let told = app.told.clone();
        let poke = Poke(app.window);
        std::thread::spawn(move || do_it(poke, told, asked, desktop));
    }
}

/// Which version the box is asking for, or why it is not asking for one.
///
/// The box can be typed into as well as chosen from, so that a release older
/// than the thirty this offers is still a release this installs.
pub(crate) unsafe fn wanted(box_: HWND) -> Result<Option<String>, String> {
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
