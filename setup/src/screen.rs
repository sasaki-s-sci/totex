//! What the window shows: whatever a working thread last said, the releases
//! there are, and what was asked for.

use windows_sys::Win32::Foundation::HWND;
use windows_sys::Win32::UI::Controls::{PBM_SETPOS, PBM_SETRANGE32};
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
