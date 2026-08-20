//! Which display server the window is opened against.
//!
//! GTK tries X11 first and takes the first server that answers, so under WSLg —
//! where both an X server and a Wayland compositor answer — the window is opened
//! against X11. X11 there is served by Weston's window manager, and that manager
//! ignores `_MOTIF_WM_HINTS`: an undecorated window is framed exactly like a
//! decorated one, keeping 38px of frame on three sides and a 59px band on the
//! fourth. None of that band belongs to the page, nothing can be drawn into it,
//! and the title bar this window went without is what the band is for.
//!
//! Against the Wayland compositor the same window is what it asked to be: no
//! frame, no shadow, and a maximised window exactly the size of the screen. So
//! the backend is pinned to Wayland wherever there is a compositor to talk to,
//! and left alone — X11, or whatever the caller asked for — where there is not.

#[cfg(target_os = "linux")]
use std::path::{Path, PathBuf};

/// Where WSLg puts its sockets.
///
/// A distribution running systemd has `XDG_RUNTIME_DIR` pointed at
/// `/run/user/<uid>`, which is not where WSLg put the socket — and that mismatch
/// is the whole reason the Wayland backend gets skipped there: GTK looks in the
/// runtime directory, finds nothing, and falls back to X11.
#[cfg(target_os = "linux")]
const WSLG_RUNTIME_DIR: &str = "/mnt/wslg/runtime-dir";

/// The socket a Wayland client connects to when nothing names another.
#[cfg(target_os = "linux")]
const DEFAULT_DISPLAY: &str = "wayland-0";

/// Points GTK at the Wayland compositor, when one can be reached.
///
/// Call this first thing, before the window is built: GTK reads both variables
/// when it opens the display and never looks again.
#[cfg(target_os = "linux")]
pub fn prefer_wayland() {
    // A backend that was asked for is a backend that was chosen. Only an unset
    // one is worth guessing at, and `GDK_BACKEND=x11` stays a way back out.
    if std::env::var_os("GDK_BACKEND").is_some() {
        return;
    }

    let name = std::env::var("WAYLAND_DISPLAY").unwrap_or_else(|_| DEFAULT_DISPLAY.to_owned());
    let runtime = std::env::var("XDG_RUNTIME_DIR").ok();
    let Some(socket) = wayland_socket(&name, runtime.as_deref(), |path| path.exists()) else {
        return;
    };

    // SAFETY: `run` is the first thing `main` does and this is the first thing
    // `run` does, so the process is still the single thread it started as and
    // nothing else can be reading the environment while it is written.
    unsafe {
        // Named as a full path rather than by moving `XDG_RUNTIME_DIR`, which
        // is also where dbus and pulse are looked for and which is right about
        // both — the socket is the only thing that is somewhere else.
        std::env::set_var("WAYLAND_DISPLAY", &socket);
        std::env::set_var("GDK_BACKEND", "wayland");
    }
}

#[cfg(not(target_os = "linux"))]
pub fn prefer_wayland() {}

/// The Wayland socket `name` stands for, as a path that exists, or `None` when
/// it stands for nothing that is there.
///
/// A name that is already a path is taken as one — that is what libwayland does
/// with it — and any other name is looked for in the runtime directory first and
/// under WSLg's second, because a session that has both is a session where only
/// one of them is the compositor this window can reach.
#[cfg(target_os = "linux")]
fn wayland_socket(
    name: &str,
    runtime_dir: Option<&str>,
    exists: impl Fn(&Path) -> bool,
) -> Option<PathBuf> {
    let named = Path::new(name);
    if named.is_absolute() {
        return exists(named).then(|| named.to_path_buf());
    }
    runtime_dir
        .into_iter()
        .chain(std::iter::once(WSLG_RUNTIME_DIR))
        .map(|dir| Path::new(dir).join(name))
        .find(|path| exists(path))
}

#[cfg(all(test, target_os = "linux"))]
mod tests {
    use super::*;

    /// Only the listed paths are there, which is the whole of what the lookup
    /// is allowed to know.
    fn only(paths: &'static [&'static str]) -> impl Fn(&Path) -> bool {
        move |path| paths.iter().any(|there| Path::new(there) == path)
    }

    #[test]
    fn the_runtime_directory_is_looked_in_first() {
        let found = wayland_socket(
            "wayland-0",
            Some("/run/user/1000"),
            only(&[
                "/run/user/1000/wayland-0",
                "/mnt/wslg/runtime-dir/wayland-0",
            ]),
        );
        assert_eq!(found, Some(PathBuf::from("/run/user/1000/wayland-0")));
    }

    #[test]
    fn wslg_answers_for_a_runtime_directory_that_has_no_socket() {
        let found = wayland_socket(
            "wayland-0",
            Some("/run/user/1000"),
            only(&["/mnt/wslg/runtime-dir/wayland-0"]),
        );
        assert_eq!(
            found,
            Some(PathBuf::from("/mnt/wslg/runtime-dir/wayland-0"))
        );
    }

    #[test]
    fn a_name_that_is_a_path_is_taken_as_one() {
        assert_eq!(
            wayland_socket("/tmp/wl-1", Some("/run/user/1000"), only(&["/tmp/wl-1"])),
            Some(PathBuf::from("/tmp/wl-1"))
        );
        assert_eq!(
            wayland_socket("/tmp/wl-1", Some("/run/user/1000"), only(&[])),
            None
        );
    }

    #[test]
    fn no_socket_anywhere_is_no_answer() {
        assert_eq!(
            wayland_socket("wayland-0", Some("/run/user/1000"), only(&[])),
            None
        );
        assert_eq!(wayland_socket("wayland-0", None, only(&[])), None);
    }

    #[test]
    fn a_session_without_a_runtime_directory_still_reaches_wslg() {
        assert_eq!(
            wayland_socket(
                "wayland-0",
                None,
                only(&["/mnt/wslg/runtime-dir/wayland-0"])
            ),
            Some(PathBuf::from("/mnt/wslg/runtime-dir/wayland-0"))
        );
    }
}
