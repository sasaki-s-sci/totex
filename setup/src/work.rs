//! The install itself, on a thread of its own so that the window keeps
//! answering while it happens.

use std::panic::AssertUnwindSafe;
use std::sync::{Arc, Mutex};

use crate::{Poke, Told, WM_TOLD, WM_VERSIONS, install, release, web};

/// Says a thing, and pokes the window into drawing it.
pub(crate) fn say(told: &Arc<Mutex<Told>>, poke: Poke, what: &str) {
    told.lock().unwrap_or_else(|held| held.into_inner()).status = what.to_string();
    poke.tell(WM_TOLD);
}

/// The whole of an install, on a thread of its own so that the window keeps
/// answering while it happens.
pub(crate) fn do_it(poke: Poke, told: Arc<Mutex<Told>>, asked: Option<String>, msi: bool) {
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

pub(crate) fn fetch(
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
pub(crate) fn which_versions(poke: Poke, told: Arc<Mutex<Told>>) {
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
