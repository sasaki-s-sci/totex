//! Whether this copy of the app is one that can replace itself.
//!
//! The updater swaps the thing it is running from, so what it can do depends
//! entirely on how the copy got onto the machine. An AppImage is one file and
//! is overwritten; a `.app` is a directory and is unpacked over; the two
//! Windows installers are re-run over themselves. A `.deb` or an `.rpm` is
//! none of those — the files belong to the package manager, the app is not
//! running as root, and replacing them behind the manager's back would leave
//! it describing a version that is no longer there. The same is true of a
//! binary run straight out of `target/`, which was never installed at all.
//!
//! So the answer is asked for before the button is drawn rather than found out
//! by pressing it. The bundler patches the answer into each bundle it makes —
//! the same binary comes out of the Windows job twice, once saying NSIS and
//! once saying MSI — so this is what the running copy actually is, not what the
//! platform usually is.

use tauri::utils::config::BundleType;
use tauri::utils::platform::bundle_type;

/// Whether the updater can replace this copy in place.
#[tauri::command]
pub fn self_update_supported() -> bool {
    matches!(
        bundle_type(),
        Some(BundleType::App | BundleType::AppImage | BundleType::Msi | BundleType::Nsis)
    )
}
