//! Reading a manifest off the release page, and asking a URL for bytes.

use serde::Serialize;
use tauri::{AppHandle, Runtime};

use super::cycle::{Cycle, Cycles};
use super::url::{listing_url, manifest_url, versions};
use super::{Manifest, PATIENCE, SMALL, declared};

/// Reads what one release says about itself, and checks it is that release.
pub async fn read(
    endpoint: &str,
    cycle: &Cycle,
    version: Option<&str>,
) -> Result<Manifest, String> {
    let url = manifest_url(endpoint, cycle, version).ok_or_else(|| {
        format!(
            "there is no release page here for {}",
            version.unwrap_or("the newest release")
        )
    })?;
    let asked = ask(&url, SMALL).await?;
    let manifest: Manifest =
        serde_json::from_slice(&asked).map_err(|error| format!("unreadable manifest: {error}"))?;
    if let Some(version) = version
        && manifest.version != version
    {
        return Err(format!(
            "v{version} was asked for and the release under that tag says {}",
            manifest.version
        ));
    }
    Ok(manifest)
}

/// Settles which implementation of the ciphers this process uses, once.
///
/// rustls does not carry one: something has to name it before the first client
/// is built, and a client built before anything has is not an error but a
/// panic — the one failure that does not come back down the wire as a message
/// somebody could read. The updater plugin names one, and it does it on the way
/// into its own download, so a copy that has never downloaded a release is a
/// copy where nothing has named one yet — which is every copy at the moment it
/// opens and asks which releases there are.
///
/// So it is named here as well, and it is the same one the plugin names:
/// installing it twice is what `install_default` returns an error for, and that
/// error is the answer "somebody already did", which is not a failure.
fn provider() {
    static ONCE: std::sync::Once = std::sync::Once::new();
    ONCE.call_once(|| {
        let _ = rustls::crypto::ring::default_provider().install_default();
    });
}

/// Reads a URL into memory, or says why it could not.
///
/// `most` is what the thing being read has no right to be bigger than. Held to
/// twice: once on what the server says it is about to send, and once on what has
/// arrived so far, because a server that says nothing is read anyway — and a
/// server that says one thing and sends another is the reason the second check
/// is made as it goes rather than at the end.
pub async fn ask(url: &str, most: usize) -> Result<Vec<u8>, String> {
    along(url, most, |_, _| {}).await
}

/// The same, saying how much has arrived as it arrives.
///
/// Read a piece at a time rather than in one go, which is the only difference:
/// a download of eighty megabytes on somebody's line is a ring that has to
/// fill, and a ring that fills is the difference between a window that is
/// working and a window that has stopped.
pub async fn along(
    url: &str,
    most: usize,
    mut coming: impl FnMut(u64, Option<u64>),
) -> Result<Vec<u8>, String> {
    provider();
    let client = reqwest::Client::builder()
        .timeout(PATIENCE)
        .user_agent(concat!("totex/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|error| format!("no client: {error}"))?;
    let mut response = client
        .get(url)
        .send()
        .await
        .map_err(|error| format!("{url} did not answer: {error}"))?
        .error_for_status()
        .map_err(|error| format!("{url} answered {error}"))?;
    let length = response.content_length();
    if length.is_some_and(|len| len > most as u64) {
        return Err(format!("{url} is larger than it has any right to be"));
    }

    let mut taken = Vec::with_capacity(length.unwrap_or(0).min(most as u64) as usize);
    while let Some(piece) = response
        .chunk()
        .await
        .map_err(|error| format!("{url} stopped part way: {error}"))?
    {
        taken.extend_from_slice(&piece);
        if taken.len() > most {
            return Err(format!("{url} is larger than it has any right to be"));
        }
        coming(taken.len() as u64, length);
    }
    Ok(taken)
}

/// Which versions one cycle offers, newest first.
///
/// Asked on a loop by the window rather than by a press, because a list has to
/// be filled before it is opened. Nothing is drawn for a listing that does not
/// answer: an empty answer leaves the window with the versions it already had,
/// and a window that has never had any offers the newest release instead, which
/// is what every press meant before a version could be named at all.
///
/// One reading of the release page serves all three cycles — they are tags on
/// one repository — so the window asks for the cycles its rows are following
/// and this answers each of them out of the one listing.
#[tauri::command]
pub async fn update_versions<R: Runtime>(
    app: AppHandle<R>,
    cycles: Vec<Cycles>,
) -> Vec<(Cycles, Vec<String>)> {
    let Ok((endpoint, _)) = declared(&app) else {
        return Vec::new();
    };
    let Some(url) = listing_url(&endpoint) else {
        return Vec::new();
    };
    let Ok(listing) = ask(&url, SMALL).await else {
        return Vec::new();
    };
    cycles
        .into_iter()
        .map(|which| {
            let found = versions(&listing, &which.cycle());
            (which, found)
        })
        .collect()
}

/// One version that can be declared in the update settings, with the two
/// agreements needed to keep the independent application layer compatible
/// with the front and program selected beside it.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateChoice {
    cycle: Cycles,
    version: String,
    layer_protocol: Option<u32>,
    front_contract: Option<u32>,
}

fn update_choice(which: Cycles, version: String, manifest: super::Manifest) -> UpdateChoice {
    let layer_protocol = manifest
        .layers
        .get(&super::target())
        .map(|layer| layer.protocol);
    let front_contract = manifest.front.map(|front| front.needs);
    UpdateChoice {
        cycle: which,
        version,
        layer_protocol,
        front_contract,
    }
}

/// The releases available to the two declarative update selectors.
///
/// The repository listing only says which versions exist. Compatibility lives
/// in each release's manifest, so those small documents are read in parallel
/// and only manifests that answer truthfully are offered to the window.
#[tauri::command]
pub async fn update_choices<R: Runtime>(
    app: AppHandle<R>,
    cycles: Vec<Cycles>,
) -> Vec<UpdateChoice> {
    let Ok((endpoint, _)) = declared(&app) else {
        return Vec::new();
    };
    let Some(url) = listing_url(&endpoint) else {
        return Vec::new();
    };
    let Ok(listing) = ask(&url, SMALL).await else {
        return Vec::new();
    };

    let mut reading = Vec::new();
    for which in cycles {
        let cycle = which.cycle();
        for version in versions(&listing, &cycle) {
            let endpoint = endpoint.clone();
            reading.push(tauri::async_runtime::spawn(async move {
                let manifest = read(&endpoint, &cycle, Some(&version)).await.ok()?;
                Some(update_choice(which, version, manifest))
            }));
        }
    }

    let mut found = Vec::new();
    for reading in reading {
        if let Ok(Some(choice)) = reading.await {
            found.push(choice);
        }
    }
    found
}

#[cfg(test)]
mod tests {
    use super::super::url::is_version;
    use super::*;
    use crate::release::cycle::{Cycle, Cycles};

    /// The address this app is actually pointed at, from `tauri.conf.json`.
    const ENDPOINT: &str =
        "https://github.com/sasaki-s-sci/totex/releases/latest/download/latest.json";

    /// The app's own cycle, which is the one every layer follows until it is
    /// told otherwise.
    fn release() -> Cycle {
        Cycles::Release.cycle()
    }

    /// The one thing about asking a URL that is not about the URL.
    ///
    /// A client is built out of a TLS stack that has to have been told which
    /// ciphers to use, and being told is a thing somebody does to the process
    /// rather than to the client — so the failure is not a failed request, it
    /// is a panic on the way to making one, and a panic inside a command is an
    /// answer the window never receives at all. Nothing here reaches a network:
    /// what is asked for is a port nothing is listening on, and the answer
    /// wanted is that it came back as an error rather than took the process
    /// with it.
    #[test]
    fn a_url_can_be_asked_before_anything_has_been_downloaded() {
        let refused = tauri::async_runtime::block_on(ask("http://127.0.0.1:1/nothing", SMALL));
        assert!(refused.is_err(), "nothing is listening there");
    }

    #[test]
    fn a_version_is_three_numbers() {
        assert!(is_version("0.1.6"));
        assert!(is_version("10.20.30"));
        assert!(!is_version("v0.1.6"));
        assert!(!is_version("0.1"));
        assert!(!is_version("0.1.6.1"));
        assert!(!is_version("../../etc"));
        assert!(!is_version(""));
        // Long enough to be a way of writing something else into an address.
        assert!(!is_version("0.1.99999999999"));
    }

    #[test]
    fn a_named_version_is_the_same_file_under_its_own_tag() {
        assert_eq!(
            manifest_url(ENDPOINT, &release(), None).as_deref(),
            Some(ENDPOINT)
        );
        assert_eq!(
            manifest_url(ENDPOINT, &release(), Some("0.1.2")).as_deref(),
            Some("https://github.com/sasaki-s-sci/totex/releases/download/v0.1.2/latest.json")
        );
        // Nothing that is not a version becomes part of an address.
        assert_eq!(
            manifest_url(ENDPOINT, &release(), Some("0.1.2/../../x")),
            None
        );
        // And an endpoint of another shape has no per-version copy to name.
        assert_eq!(
            manifest_url("https://example.invalid/x.json", &release(), Some("0.1.2")),
            None
        );
    }

    #[test]
    fn a_cycle_of_its_own_is_the_same_page_under_its_own_tag() {
        let layer = Cycles::Layer.cycle();
        assert_eq!(
            manifest_url(ENDPOINT, &layer, Some("0.2.0")).as_deref(),
            Some("https://github.com/sasaki-s-sci/totex/releases/download/layer-v0.2.0/layer.json")
        );
        // And it has no address for "whichever is newest": the one address
        // GitHub keeps pointed at a release is pointed at the newest release of
        // the repository, which is not the newest release of this cycle. Which
        // version is newest here is the listing's to say.
        assert_eq!(manifest_url(ENDPOINT, &layer, None), None);
    }

    #[test]
    fn the_listing_is_the_repository_the_endpoint_names() {
        assert_eq!(
            listing_url(ENDPOINT).as_deref(),
            Some("https://api.github.com/repos/sasaki-s-sci/totex/releases?per_page=30")
        );
        assert_eq!(listing_url("https://example.invalid/latest.json"), None);
        assert_eq!(listing_url("https://github.com/onlyowner"), None);
    }

    #[test]
    fn only_released_versions_of_the_app_are_offered() {
        let listing = br#"[
          {"tag_name": "v0.1.6", "draft": false, "prerelease": false},
          {"tag_name": "setup",  "draft": false, "prerelease": true},
          {"tag_name": "v0.1.5", "draft": true,  "prerelease": false},
          {"tag_name": "v0.1.4", "draft": false, "prerelease": true},
          {"tag_name": "nightly","draft": false, "prerelease": false},
          {"tag_name": "v0.1.3", "draft": false, "prerelease": false}
        ]"#;
        assert_eq!(
            versions(listing, &release()),
            vec!["0.1.6".to_string(), "0.1.3".to_string()]
        );
    }

    #[test]
    fn one_listing_tells_three_cycles_apart() {
        let listing = br#"[
          {"tag_name": "layer-v0.2.0", "draft": false, "prerelease": false},
          {"tag_name": "v0.1.6",       "draft": false, "prerelease": false},
          {"tag_name": "front-v0.1.7", "draft": false, "prerelease": false},
          {"tag_name": "layer-v0.1.9", "draft": false, "prerelease": false}
        ]"#;
        assert_eq!(versions(listing, &release()), vec!["0.1.6".to_string()]);
        assert_eq!(
            versions(listing, &Cycles::Layer.cycle()),
            vec!["0.2.0".to_string(), "0.1.9".to_string()]
        );
        assert_eq!(
            versions(listing, &Cycles::Front.cycle()),
            vec!["0.1.7".to_string()]
        );
    }

    #[test]
    fn a_choice_carries_the_agreements_from_its_manifest() {
        let mut layers = std::collections::HashMap::new();
        layers.insert(
            super::super::target(),
            super::super::Layer {
                protocol: 7,
                url: String::new(),
                signature: String::new(),
            },
        );
        let manifest = super::super::Manifest {
            version: "1.2.3".to_string(),
            front: Some(super::super::Entry {
                needs: 9,
                url: String::new(),
                signature: String::new(),
            }),
            layers,
        };

        let choice = update_choice(Cycles::Release, "1.2.3".to_string(), manifest);
        assert_eq!(choice.cycle, Cycles::Release);
        assert_eq!(choice.version, "1.2.3");
        assert_eq!(choice.layer_protocol, Some(7));
        assert_eq!(choice.front_contract, Some(9));
    }

    #[test]
    fn a_listing_that_is_not_one_offers_nothing() {
        assert!(versions(b"{\"message\":\"API rate limit exceeded\"}", &release()).is_empty());
        assert!(versions(b"not json at all", &release()).is_empty());
    }
}
