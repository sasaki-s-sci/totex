//! How much of this copy of the app can be replaced from a release page.
//!
//! Two questions, and the same fact answers both: how the copy got onto the
//! machine. The updater swaps the thing it is running from, so what it can do
//! depends entirely on what that thing is. An AppImage is one file and is
//! overwritten; a `.app` is a directory and is unpacked over; the two Windows
//! installers are re-run over themselves. A `.deb` or an `.rpm` is none of
//! those — the files belong to the package manager, the app is not running as
//! root, and replacing them behind the manager's back would leave it describing
//! a version that is no longer there.
//!
//! That is the whole answer for the program. It is not the whole answer for the
//! app: the pages the window is drawn out of are the app's too, and those are
//! replaced without touching a file anything else owns — see [`crate::front`].
//! So a `.deb` and an `.rpm` are copies that can be brought forward halfway,
//! and are offered that.
//!
//! A binary run straight out of `target/` is the one copy neither is offered
//! to. It was never installed, so there is nothing to overwrite; and the pages
//! it draws are the ones somebody just built, which taking a release's over
//! would quietly undo.
//!
//! So the answer is asked for before the button is drawn rather than found out
//! by pressing it. The bundler patches the answer into each bundle it makes —
//! the same binary comes out of the Windows job twice, once saying NSIS and
//! once saying MSI — so this is what the running copy actually is, not what the
//! platform usually is.

use tauri::utils::config::BundleType;
use tauri::utils::platform::bundle_type;

/// Whether there is anything at all a release page can do for this copy.
///
/// Where this is false there is no update mark, because every press of it would
/// end in the same answer: this is not a copy anybody installed.
#[tauri::command]
pub fn update_supported() -> bool {
    bundle_type().is_some()
}

/// Whether the updater can replace the whole of this copy in place.
pub fn whole_update_supported() -> bool {
    matches!(
        bundle_type(),
        Some(BundleType::App | BundleType::AppImage | BundleType::Msi | BundleType::Nsis)
    )
}
