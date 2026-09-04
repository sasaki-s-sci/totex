//! Bringing a release of the window down, and putting it in once the window has
//! gone.
//!
//! The window is the half of the app that is replaced, and it cannot replace
//! itself: an installer cannot write over a program that is running, and a
//! program that has exited cannot start what replaces it. This program can do
//! both, because it is still here when the window is not. So the window asks
//! for a release to be brought down while it is open — checked against the key
//! it was built with, so that a release page somebody has been at hands over
//! nothing — and then asks to be started again once it has gone, with what came
//! down put in first. See [`crate::serve::Relaunch`].
//!
//! What "putting it in" is depends entirely on what the window is running from,
//! and the window says which — see [`Kind`]. An AppImage is one file and is
//! written over; a `.app` is a directory and is swapped; the two Windows
//! installers are run over a copy that has closed. Nothing here decides whether
//! a copy can be replaced at all: a copy the package manager owns never asks.

use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Duration;

use base64::Engine as _;
use base64::engine::general_purpose::STANDARD as BASE64;
use minisign_verify::{PublicKey, Signature};
use serde::{Deserialize, Serialize};

/// The most of a release that will be read off the network.
///
/// An installer of this app is around eighty megabytes. This is not a size
/// anything is expected to reach — it is what stops a URL that answers forever
/// from filling memory, which is the one thing an unbounded read of somebody
/// else's server can be made to do before a signature has been checked.
const MOST: usize = 512 * 1024 * 1024;

/// How long the whole of a release is given to arrive.
const FETCHING: Duration = Duration::from_secs(15 * 60);

/// How long a program that has just closed is given to let go of its own file.
///
/// The window closes its socket before its process has quite gone, and on
/// Windows an installer that arrives in that instant finds the program it is
/// replacing still open.
const LETTING_GO: Duration = Duration::from_secs(15);

/// Where a release is kept once it is down, under the home directory.
const RELEASE: &str = "release";

/// What a copy of the app is running from, which is what decides how a release
/// of it goes in.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    /// One file, written over.
    AppImage,
    /// A `.app` directory, unpacked beside itself and swapped in.
    App,
    /// The NSIS installer, run over the closed app.
    Nsis,
    /// The MSI, handed to `msiexec` the same way.
    Msi,
}

/// What a window asks to be brought down.
#[derive(Clone, Debug, Deserialize)]
pub struct Taking {
    pub url: String,
    /// The signature the release page carries for it, and the key this copy
    /// of the app was built with — the same pair every other download the
    /// app makes is checked against.
    pub signature: String,
    pub key: String,
}

/// What came down, and where.
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Taken {
    pub path: PathBuf,
}

/// A release that is down, and how it goes in.
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Install {
    pub kind: Kind,
    /// The file that came down — see [`Taken`].
    pub download: PathBuf,
    /// What it replaces: the AppImage, the `.app` directory, or the program
    /// the installer will write over.
    pub target: PathBuf,
}

/// Brings one release down, checks it, and keeps it under the home directory.
///
/// `coming` is told how much has arrived as it arrives, which is what a
/// window fills its ring from.
pub fn take(
    home: &Path,
    taking: &Taking,
    coming: impl FnMut(u64, Option<u64>),
) -> Result<Taken, String> {
    let dir = home.join(RELEASE);
    std::fs::create_dir_all(&dir).map_err(|error| format!("{}: {error}", dir.display()))?;
    // Whatever was there was a release nothing is pointed at any more.
    for entry in std::fs::read_dir(&dir).into_iter().flatten().flatten() {
        let _ = std::fs::remove_file(entry.path());
    }

    let bytes = fetch(&taking.url, coming)?;
    ours(&bytes, &taking.signature, &taking.key)?;

    let name = taking
        .url
        .rsplit('/')
        .next()
        .filter(|name| !name.is_empty() && !name.contains(['\\', ':']))
        .unwrap_or("release");
    let path = dir.join(name);
    let placing = dir.join(format!("{name}.taking"));
    std::fs::write(&placing, &bytes).map_err(|error| format!("{}: {error}", placing.display()))?;
    std::fs::rename(&placing, &path).map_err(|error| format!("{}: {error}", path.display()))?;
    Ok(Taken { path })
}

/// Reads a URL into memory, saying how much has arrived as it arrives.
fn fetch(url: &str, mut coming: impl FnMut(u64, Option<u64>)) -> Result<Vec<u8>, String> {
    provider();
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(|error| format!("no runtime to download with: {error}"))?;
    runtime.block_on(async {
        let client = reqwest::Client::builder()
            .timeout(FETCHING)
            .user_agent(concat!("totex-keep/", env!("CARGO_PKG_VERSION")))
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
        if length.is_some_and(|len| len > MOST as u64) {
            return Err(format!("{url} is larger than it has any right to be"));
        }
        let mut taken = Vec::with_capacity(length.unwrap_or(0).min(MOST as u64) as usize);
        while let Some(piece) = response
            .chunk()
            .await
            .map_err(|error| format!("{url} stopped part way: {error}"))?
        {
            taken.extend_from_slice(&piece);
            if taken.len() > MOST {
                return Err(format!("{url} is larger than it has any right to be"));
            }
            coming(taken.len() as u64, length);
        }
        Ok(taken)
    })
}

/// Settles which implementation of the ciphers this process uses, once.
///
/// rustls does not carry one, and a client built before anything has named one
/// is a panic rather than an error. The same provider the window names, named
/// the same way.
fn provider() {
    static ONCE: std::sync::Once = std::sync::Once::new();
    ONCE.call_once(|| {
        let _ = rustls::crypto::ring::default_provider().install_default();
    });
}

/// Whether this is the release the page named, signed with the app's key.
///
/// The two strings are base64 around the two halves of a minisign pair, which
/// is the shape the release manifest carries and the shape `tauri signer`
/// writes.
pub fn ours(bytes: &[u8], signature: &str, key: &str) -> Result<(), String> {
    let text = |encoded: &str, what: &str| {
        BASE64
            .decode(encoded)
            .ok()
            .and_then(|bytes| String::from_utf8(bytes).ok())
            .ok_or_else(|| format!("the {what} is not what a {what} looks like"))
    };
    let key = PublicKey::decode(&text(key, "key")?)
        .map_err(|error| format!("the key will not decode: {error}"))?;
    let signature = Signature::decode(&text(signature, "signature")?)
        .map_err(|error| format!("the signature will not decode: {error}"))?;
    key.verify(bytes, &signature, true)
        .map_err(|_| "this release is not signed with the app's key".to_string())
}

/// Puts a release in, once the program it replaces has gone.
pub fn install(install: &Install) -> Result<(), String> {
    let_go(&install.target);
    match install.kind {
        Kind::AppImage => over_file(&install.download, &install.target),
        Kind::App => swap_bundle(&install.download, &install.target),
        Kind::Nsis => run(
            Command::new(&install.download).args(["/S", "/UPDATE"]),
            "the installer",
        ),
        Kind::Msi => run(
            Command::new("msiexec")
                .arg("/i")
                .arg(&install.download)
                .args(["/quiet", "/norestart"]),
            "msiexec",
        ),
    }
}

/// Waits for the program being replaced to stop being open for running.
///
/// Only Windows holds a running program's file against being written; the
/// wait is measured in the instants between a socket closing and a process
/// ending, and is bounded so that a program that will not go is written over
/// anyway and the installer says what it thinks of that.
fn let_go(target: &Path) {
    if !cfg!(windows) || !target.is_file() {
        return;
    }
    let deadline = std::time::Instant::now() + LETTING_GO;
    while std::time::Instant::now() < deadline {
        if std::fs::OpenOptions::new()
            .append(true)
            .open(target)
            .is_ok()
        {
            return;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
}

/// Writes one file over another, whole or not at all.
fn over_file(download: &Path, target: &Path) -> Result<(), String> {
    let placing = target.with_extension("new");
    std::fs::copy(download, &placing).map_err(|error| format!("{}: {error}", placing.display()))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&placing, std::fs::Permissions::from_mode(0o755))
            .map_err(|error| format!("{}: {error}", placing.display()))?;
    }
    std::fs::rename(&placing, target).map_err(|error| format!("{}: {error}", target.display()))
}

/// Unpacks a `.app.tar.gz` beside the bundle it replaces and swaps the two.
fn swap_bundle(download: &Path, target: &Path) -> Result<(), String> {
    let beside = target
        .parent()
        .ok_or_else(|| format!("{} has nowhere beside it", target.display()))?;
    let unpacking = beside.join(format!(".totex-update-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&unpacking);
    std::fs::create_dir_all(&unpacking)
        .map_err(|error| format!("{}: {error}", unpacking.display()))?;

    let file = std::fs::File::open(download)
        .map_err(|error| format!("{}: {error}", download.display()))?;
    let mut archive = tar::Archive::new(flate2::read::GzDecoder::new(file));
    archive
        .unpack(&unpacking)
        .map_err(|error| format!("the release would not unpack: {error}"))?;

    // The one bundle inside it, whatever it is called.
    let unpacked = std::fs::read_dir(&unpacking)
        .into_iter()
        .flatten()
        .flatten()
        .map(|entry| entry.path())
        .find(|path| path.extension().is_some_and(|ext| ext == "app"))
        .ok_or_else(|| "the release arrived without an app in it".to_string())?;

    let old = beside.join(format!(".totex-old-{}", std::process::id()));
    std::fs::rename(target, &old).map_err(|error| format!("{}: {error}", target.display()))?;
    if let Err(error) = std::fs::rename(&unpacked, target) {
        // Put the old one back rather than leave nothing where the app was.
        let _ = std::fs::rename(&old, target);
        return Err(format!("{}: {error}", target.display()));
    }
    let _ = std::fs::remove_dir_all(&old);
    let _ = std::fs::remove_dir_all(&unpacking);
    Ok(())
}

/// Runs an installer to its end, and says what it said if it would not.
fn run(command: &mut Command, what: &str) -> Result<(), String> {
    let ran = command
        .output()
        .map_err(|error| format!("{what} would not start: {error}"))?;
    if ran.status.success() {
        return Ok(());
    }
    Err(format!(
        "{what} did not finish: {}{}",
        ran.status,
        String::from_utf8_lossy(&ran.stderr).trim()
    ))
}

/// Writes down what went wrong on the way to a relaunch, where somebody can
/// find it: nothing is connected to this program by then to be told.
pub fn note(home: &Path, said: &str) {
    let at = home.join("relaunch.log");
    if let Ok(mut file) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(at)
    {
        let _ = writeln!(file, "{said}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The public half of a real key that signed nothing here.
    const KEY: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDg2RkI4MTZBQjRGMkNBNUIKUldSYnl2SzBhb0g3aGwzS1ZPY04wenRUdmdnSW5EdnlEMVpMYy8zRnNCb1hwRENvUzVGRllKeUkK";

    fn temp(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "totex-update-{tag}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|elapsed| elapsed.as_nanos())
                .unwrap_or_default()
        ));
        std::fs::create_dir_all(&dir).expect("temp dir");
        dir
    }

    #[test]
    fn a_release_that_is_not_signed_with_the_apps_key_is_refused() {
        let refused = ours(b"not a release", "not a signature", KEY).expect_err("refused");
        assert!(refused.contains("signature"), "{refused}");
        let refused = ours(b"not a release", KEY, KEY).expect_err("refused");
        assert!(
            refused.contains("signature") || refused.contains("key"),
            "{refused}"
        );
    }

    #[test]
    fn a_release_nothing_answers_for_is_not_kept() {
        let home = temp("nobody");
        let refused = take(
            &home,
            &Taking {
                url: "http://127.0.0.1:1/never-there".to_string(),
                signature: String::new(),
                key: KEY.to_string(),
            },
            |_, _| {},
        )
        .expect_err("nothing is listening there");
        assert!(refused.contains("127.0.0.1"), "{refused}");
        assert!(
            std::fs::read_dir(home.join(RELEASE))
                .map(|dir| dir.count())
                .unwrap_or(0)
                == 0,
            "something was kept"
        );
        let _ = std::fs::remove_dir_all(&home);
    }

    #[cfg(unix)]
    #[test]
    fn an_appimage_is_written_over_whole_and_left_runnable() {
        use std::os::unix::fs::PermissionsExt;

        let home = temp("appimage");
        let target = home.join("totex.AppImage");
        let download = home.join("release").join("totex-linux-x86_64.AppImage");
        std::fs::create_dir_all(download.parent().expect("a parent")).expect("dir");
        std::fs::write(&target, b"the old program").expect("old");
        std::fs::write(&download, b"the new program").expect("new");

        install(&Install {
            kind: Kind::AppImage,
            download: download.clone(),
            target: target.clone(),
        })
        .expect("it goes in");

        assert_eq!(std::fs::read(&target).expect("read"), b"the new program");
        let mode = std::fs::metadata(&target)
            .expect("stat")
            .permissions()
            .mode();
        assert_eq!(mode & 0o111, 0o111, "the program is not runnable: {mode:o}");
        assert!(!target.with_extension("new").exists());
        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn a_bundle_is_swapped_for_the_one_that_came_down() {
        let home = temp("bundle");
        let target = home.join("totex.app");
        std::fs::create_dir_all(target.join("Contents")).expect("old bundle");
        std::fs::write(target.join("Contents").join("old"), b"old").expect("old");

        // A release as the job packs one: the bundle, at the root of the tar.
        let download = home.join("totex-macos-universal.app.tar.gz");
        {
            let file = std::fs::File::create(&download).expect("tarball");
            let mut builder = tar::Builder::new(flate2::write::GzEncoder::new(
                file,
                flate2::Compression::fast(),
            ));
            let body = b"new";
            let mut header = tar::Header::new_gnu();
            header.set_size(body.len() as u64);
            header.set_mode(0o644);
            builder
                .append_data(&mut header, "totex.app/Contents/new", &body[..])
                .expect("pack a file");
            builder
                .into_inner()
                .expect("finish the archive")
                .finish()
                .expect("finish the compression");
        }

        install(&Install {
            kind: Kind::App,
            download,
            target: target.clone(),
        })
        .expect("it goes in");

        assert!(target.join("Contents").join("new").is_file());
        assert!(!target.join("Contents").join("old").exists());
        let left: Vec<_> = std::fs::read_dir(&home)
            .expect("home")
            .flatten()
            .map(|entry| entry.file_name().to_string_lossy().into_owned())
            .filter(|name| name.starts_with(".totex-"))
            .collect();
        assert!(left.is_empty(), "left behind: {left:?}");
        let _ = std::fs::remove_dir_all(&home);
    }
}
