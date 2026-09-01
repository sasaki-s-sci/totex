//! Where the releases are, and what each of them says about itself.
//!
//! One document decides both halves. Every release carries a `latest.json`: the
//! updater plugin reads it for the installer that replaces the program, and
//! [`crate::front`] reads it for the pages that can be taken without one. What
//! a release is, is one fact, and two files saying it are two files that can
//! disagree — so there is one file, and this is the reading of it.
//!
//! ## Naming a version
//!
//! The app is pointed at one address and it is the newest release's copy of
//! that document: GitHub keeps `releases/latest/download/<name>` aimed at
//! whatever the newest release is. Every release also carries the same file
//! under its own tag, at an address that stops moving the moment it is cut. So
//! naming a version is the same address with the moving part taken out of it,
//! and nothing has to be configured twice for it.
//!
//! A release page is not trusted to say which release it is. A manifest under
//! `v0.1.6` that says 0.1.7 is a page somebody has been at, and taking what it
//! offers anyway would make naming a version mean nothing — so the two are
//! compared, which is the same check `setup/src/release` makes for the same
//! reason.
//!
//! That file is the version-selectable installer's half of all this, and the
//! resemblance is deliberate rather than shared code: it is a crate of its own,
//! released on a cycle of its own, and it has to install a version of the app
//! onto a machine that has none. What is common to the two is what a release
//! page is, which is a shape neither of them owns.
//!
//! ## And which versions there are to name
//!
//! A manifest says what one release is; it does not say which releases exist.
//! That is the repository's own listing, and it is the one thing here that is
//! read without a version being selected — see [`fetch::update_choices`], which
//! is asked on a slow loop and reads each listed release's compatibility terms
//! before offering it. It is therefore also allowed to fail in silence: a rate
//! limit leaves the declarations with the choices they already had.

use std::time::Duration;

use serde::Deserialize;
use tauri::{AppHandle, Runtime};

/// How long the release page is given to answer, and to hand over a front.
pub const PATIENCE: Duration = Duration::from_secs(30);

/// The most a manifest or a listing is allowed to weigh.
///
/// One is four platforms and a date; the other is thirty releases and what
/// GitHub says about each of them. Neither is a size to be reached — this is
/// what stops a URL that answers forever from filling memory, which is the one
/// thing an unbounded read of somebody else's server can be made to do.
pub const SMALL: usize = 4 * 1024 * 1024;

/// How many releases back the listing is asked for.
///
/// Enough that the versions worth going back to are all in it, and few enough
/// to be one page: what is wanted is a pull-down somebody can read, not the
/// whole history of the repository.
const BACK: usize = 30;

/// As much of the release manifest as anything here reads.
///
/// The same document the updater plugin reads, from the same URL. The plugin
/// ignores a key that is not part of its own shape, and everything here ignores
/// `platforms`, which is the plugin's half of it.
#[derive(Deserialize)]
pub struct Manifest {
    pub version: String,
    pub front: Option<Entry>,
    /// The application layer, by the kind of machine that can run it — see
    /// [`target`]. A release cut before this was written names none, which is a
    /// release whose layer is the one inside its program.
    #[serde(default)]
    pub layers: std::collections::HashMap<String, Layer>,
}

/// Where one machine's copy of the application layer is.
#[derive(Deserialize)]
pub struct Layer {
    /// The conversation it speaks — see [`totex_layer::PROTOCOL`]. Read before
    /// anything is downloaded, so that a layer this program could not talk to
    /// is a row that says so rather than a download that ends in being unable
    /// to start what arrived.
    pub protocol: u32,
    pub url: String,
    pub signature: String,
}

/// Which machine's downloads this copy is asking for.
///
/// The kind of machine rather than the kind of installed copy: a layer is one
/// program that is started and asked things, so the only thing that decides
/// which one runs here is the operating system and the processor. The names are
/// written the same way in `scripts/update-manifest.mjs`, which is what puts
/// them in the document this reads.
pub fn target() -> String {
    format!("{}-{}", std::env::consts::OS, std::env::consts::ARCH)
}

/// Where the pages of a release are, and what they need to run against.
#[derive(Deserialize)]
pub struct Entry {
    /// The oldest agreement between the pages and the program that these pages
    /// will work against — `frontContract` in `package.json`, which is the one
    /// place the number is written and the number both halves are built with.
    pub needs: u32,
    pub url: String,
    pub signature: String,
}

/// The URL a new version is named at and the key it has to be signed with,
/// both read out of the updater's own configuration.
///
/// Not a second copy of either. The whole worth of the key is that there is one
/// of them: the app already declares it once for the plugin, and the build
/// refuses a tree where the two install scripts do not carry the same string.
/// A front signed with anything else is a front from somebody else.
pub fn declared<R: Runtime>(app: &AppHandle<R>) -> Result<(String, String), String> {
    let updater = app
        .config()
        .plugins
        .0
        .get("updater")
        .ok_or_else(|| "this build has no updater configured".to_string())?;
    let endpoint = updater["endpoints"][0]
        .as_str()
        .ok_or_else(|| "the updater names no endpoint".to_string())?;
    let key = updater["pubkey"]
        .as_str()
        .ok_or_else(|| "the updater carries no key".to_string())?;
    Ok((endpoint.to_string(), key.to_string()))
}

pub mod cycle;
pub mod fetch;
pub(crate) mod url;

pub use cycle::{Cycle, Cycles};
pub use fetch::read;
pub use url::manifest_url;
