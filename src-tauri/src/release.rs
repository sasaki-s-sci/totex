//! Read release manifests and signatures for runtime bundles and ephemeral views.
//! `front.runtime` identifies the stateful host required by a view release;
//! version numbers identify releases and do not substitute for compatibility.

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
#[derive(Deserialize)]
pub struct Manifest {
    pub version: String,
    pub front: Option<Entry>,
    /// The program, by the kind of installed copy that can replace itself with
    /// it — see `update::program::standing`, which is the other half of the
    /// names.
    #[serde(default)]
    pub platforms: std::collections::HashMap<String, Download>,
}

/// Where one kind of installed copy's replacement for itself is.
#[derive(Deserialize)]
pub struct Download {
    pub url: String,
    pub signature: String,
}

/// Where the pages of a release are, and what they need to run against.
#[derive(Deserialize)]
pub struct Entry {
    /// The oldest agreement between the pages and the program that these pages
    /// will work against — `frontContract` in `package.json`, which is the one
    /// place the number is written and the number both halves are built with.
    pub needs: u32,
    #[serde(default)]
    pub runtime: Option<String>,
    pub url: String,
    pub signature: String,
}

/// The URL a new version is named at and the key it has to be signed with,
/// both read out of the updater's own configuration.
///
/// Not a second copy of either. The whole worth of the key is that there is one
/// of them: the app already declares it once, and the build refuses a tree
/// where the install scripts do not carry the same string. A release signed
/// with anything else is a release from somebody else.
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

pub mod fetch;
pub(crate) mod url;

pub use fetch::read;
