//! Filesystem browsing primitives shared by the folder picker window and the
//! folder tree of the main window.
//!
//! Paths cross the IPC boundary as plain strings so that Windows locations
//! (`C:\Users\...`, `\\wsl.localhost\Ubuntu\home\...`) and WSL locations
//! (`/home/...`, `/mnt/c/...`) both survive the round trip untouched.
//!
//! A path that names a WSL distribution is not read through the share Windows
//! publishes it under — it is read inside the distribution, by [`crate::host`].
//! The share is bytes over a network filesystem, which is slow enough to be
//! felt in a listing and tells Windows nothing about who owns what; reaching in
//! is the same reading the distribution's own tools would get.

use std::ffi::OsStr;
use std::path::{Component, Path, PathBuf};

use serde::Serialize;

use crate::host::Host;
use crate::wsl;

/// The picker and the tree are interactive views, so oversized directories are
/// cut short instead of shipping a million rows to the webview.
const MAX_ENTRIES: usize = 5_000;

/// How much of a file a card on the canvas is given.
///
/// A card is the top of a file, not a document view: what it can show is a
/// screenful, and a file that runs past this ends in the mark that says so.
/// Reading a gigabyte off a network share to draw twenty lines of it is what
/// this number is here to prevent.
const MAX_FILE_HEAD: u64 = 64 * 1024;

/// Where a root comes from, so the frontend can group and label the rail.
///
/// The frontend knows every variant even though each host only produces some.
#[allow(dead_code)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum RootKind {
    /// The current user's home directory.
    Home,
    /// A drive letter of the Windows host (`C:\`).
    WindowsDrive,
    /// A WSL distribution, reached inside itself rather than over its share.
    WslDistro,
    /// The `/` of the Linux/WSL filesystem.
    UnixRoot,
    /// A Windows drive mounted inside WSL (`/mnt/c`).
    WindowsMount,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Root {
    pub kind: RootKind,
    pub label: String,
    pub path: String,
    /// Secondary line shown under the label, when it adds something.
    pub detail: Option<String>,
}

/// A folder someone typed and kept, spelled out for the row that offers it.
///
/// Not a [`Root`]: those are what the machine has, worked out afresh every time
/// the menu is opened, and there is nothing to keep about them. This is the
/// other kind — a place that exists because a person named it, which between
/// two windows is only ever a path until something spells it out again.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Place {
    /// What a pane is started at: folded, and spelled the way every path in
    /// this app is spelled.
    pub path: String,
    /// The folder's own name, which is what the row is read by.
    pub label: String,
    /// The whole of it with the home directory written `~`, for the line under
    /// the name. Shortened because that is where a person's folders are, and a
    /// column this narrow has no width to spend saying so on every row.
    pub display: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub is_symlink: bool,
    pub is_hidden: bool,
    /// Byte size of files; directories report `null`.
    pub size: Option<u64>,
    /// Modification time as milliseconds since the Unix epoch.
    pub modified_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Listing {
    /// The directory that was actually read, which may differ from the request
    /// once `~` expansion or `..` folding ran.
    pub path: String,
    pub name: String,
    pub parent: Option<String>,
    /// The distribution the directory is inside, when it is inside one. What
    /// the window puts beside a Linux path so it reads as one place and not as
    /// this machine's own `/home`.
    pub distro: Option<String>,
    pub entries: Vec<Entry>,
    /// Set when the directory holds more than [`MAX_ENTRIES`] children.
    pub truncated: bool,
}

/// The top of one file, for the card the canvas draws it in.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileHead {
    /// The file that actually answered, which may differ from the request once
    /// `~` expansion or `..` folding ran.
    pub path: String,
    pub name: String,
    /// As much of the file as was read, when the bytes are text at all. `None`
    /// says they are not, which the card draws as a body it cannot show.
    pub text: Option<String>,
    /// The whole file's size, which is what says the card is showing part of it.
    pub size: u64,
    /// Set when the file runs past what was read. See [`MAX_FILE_HEAD`].
    pub truncated: bool,
}

/// The user's home directory, read from the environment so that no platform
/// specific crate is needed.
pub fn home_dir() -> Option<PathBuf> {
    let raw = if cfg!(windows) {
        std::env::var_os("USERPROFILE")
    } else {
        std::env::var_os("HOME")
    }?;
    if raw.is_empty() {
        return None;
    }
    Some(PathBuf::from(raw))
}

/// Expands a leading `~` so the path bar accepts what a shell would accept.
pub fn expand_user_path(input: &str) -> PathBuf {
    let trimmed = input.trim();
    let Some(home) = home_dir() else {
        return PathBuf::from(trimmed);
    };
    if trimmed == "~" {
        return home;
    }
    for prefix in ["~/", "~\\"] {
        if let Some(rest) = trimmed.strip_prefix(prefix) {
            return home.join(rest);
        }
    }
    PathBuf::from(trimmed)
}

/// The path with the home directory written `~`, the way a shell writes it.
///
/// Which directory that is comes from the environment — see [`home_dir`] — so
/// nothing here holds an opinion about where a person's folders are. A path
/// that is not under it is left exactly as it was: this shortens a spelling, it
/// does not decide anything.
///
/// The separator is whichever one the path is already using, so a Windows path
/// comes back `~\repo` and a Linux one `~/repo` — the same path, still spelled
/// the way the machine holding it spells it.
fn shorten_home(path: &str, home: Option<&Path>) -> String {
    let Some(home) = home else {
        return path.to_string();
    };
    let home = home.to_string_lossy();
    // A home that is the root of the disk shortens everything on it, which is
    // not a shorter spelling of anything — it is the whole filesystem renamed.
    let home = home.trim_end_matches(['/', '\\']);
    if home.is_empty() {
        return path.to_string();
    }
    if path == home {
        return "~".to_string();
    }
    for separator in ['/', '\\'] {
        if let Some(rest) = path.strip_prefix(&format!("{home}{separator}")) {
            return format!("~{separator}{rest}");
        }
    }
    path.to_string()
}

/// One settled path, as the row that offers it needs it.
fn describe_place(host: &Host, path: &Path) -> Place {
    let spelled = path.to_string_lossy().into_owned();
    Place {
        label: host.name(path),
        display: shorten_home(&spelled, home_dir().as_deref()),
        path: spelled,
    }
}

/// Settles one typed path into a place to keep, or says why it is not one.
///
/// The disk is asked, once and here: a path that is a file, or nothing at all,
/// is refused where it was typed rather than kept and left to fail at the pane
/// that could not open it.
pub fn resolve_folder(raw: &str) -> Result<Place, String> {
    let (host, path) = resolve(raw)?;
    if !host.is_dir(&path) {
        return Err("no-such-folder".to_string());
    }
    Ok(describe_place(&host, &path))
}

/// Spells out the folders that were kept, without asking the disk about any.
///
/// What is stored is the paths alone, so this is what a menu is drawn from, and
/// it runs every time one is opened. Nothing here touches a file: a folder
/// inside a WSL distribution is stat'd by starting a process in it, and a
/// handful of kept folders would be a handful of processes started to draw a
/// menu. What became of them is answered by the pane that opens one.
pub fn describe_folders(paths: &[String]) -> Vec<Place> {
    paths
        .iter()
        .filter_map(|raw| {
            let (host, path) = resolve(raw).ok()?;
            Some(describe_place(&host, &path))
        })
        .collect()
}

/// Folds `.` and `..` lexically. Unlike [`fs::canonicalize`] this keeps UNC
/// paths as typed instead of rewriting them to their `\\?\` verbatim form.
pub fn clean_path(path: &Path) -> PathBuf {
    let mut root = PathBuf::new();
    let mut rooted = false;
    let mut parts: Vec<&OsStr> = Vec::new();

    for component in path.components() {
        match component {
            Component::Prefix(prefix) => root.push(prefix.as_os_str()),
            Component::RootDir => {
                root.push(component.as_os_str());
                rooted = true;
            }
            Component::CurDir => {}
            Component::ParentDir => match parts.last() {
                Some(last) if *last != OsStr::new("..") => {
                    parts.pop();
                }
                // `/..` is `/`; a relative path keeps climbing instead.
                _ if rooted => {}
                _ => parts.push(OsStr::new("..")),
            },
            Component::Normal(part) => parts.push(part),
        }
    }

    let mut cleaned = root;
    for part in parts {
        cleaned.push(part);
    }
    if cleaned.as_os_str().is_empty() {
        PathBuf::from(".")
    } else {
        cleaned
    }
}

/// What was typed, as the machine holding it and a settled path on it.
///
/// The one door every command here goes through. A WSL path is folded as the
/// distribution would fold it rather than as this platform's `Path` would: on a
/// Linux build a backslash is an ordinary letter, and the answer has to be the
/// same in both builds.
fn resolve(raw: &str) -> Result<(Host, PathBuf), String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("empty-path".to_string());
    }
    match wsl::locate(trimmed) {
        Some(found) => {
            let path = wsl::unc(&found.distro, &wsl::clean(&found.path));
            Ok((Host::Wsl(found.distro), PathBuf::from(path)))
        }
        None => Ok((Host::Local, clean_path(&expand_user_path(trimmed)))),
    }
}

/// Reads `raw_path` and returns its children, sorted directories first.
pub fn read_directory(raw_path: &str, show_hidden: bool) -> Result<Listing, String> {
    let (host, path) = resolve(raw_path)?;
    let children = host.read_dir(&path)?;

    let mut entries = Vec::new();
    let mut truncated = false;
    for child in children {
        let entry = describe(&host, &path, child);
        if !show_hidden && entry.is_hidden {
            continue;
        }
        if entries.len() == MAX_ENTRIES {
            truncated = true;
            break;
        }
        entries.push(entry);
    }
    sort_entries(&mut entries);

    Ok(Listing {
        name: host.name(&path),
        parent: host
            .parent(&path)
            .map(|parent| parent.to_string_lossy().into_owned()),
        distro: host.distro().map(str::to_string),
        path: path.to_string_lossy().into_owned(),
        entries,
        truncated,
    })
}

/// Reads the top of `raw_path`, for a card on the canvas.
///
/// A directory is a failure here rather than an empty file: the two are
/// different things, and the card that would draw the second one is not what a
/// folder should put on the canvas.
pub fn read_file_head(raw_path: &str) -> Result<FileHead, String> {
    let (host, path) = resolve(raw_path)?;
    let (bytes, size) = host.read_head(&path, MAX_FILE_HEAD)?;
    let truncated = size > bytes.len() as u64;

    Ok(FileHead {
        name: host.name(&path),
        path: path.to_string_lossy().into_owned(),
        text: as_text(&bytes, truncated),
        size,
        truncated,
    })
}

/// Writes a card's reading back to the file it came from.
///
/// Only a file the card holds whole may be written: what is on screen is what
/// goes to disk, so writing back a reading that stopped at [`MAX_FILE_HEAD`]
/// would drop everything past it. `expect_size` is how long the file was when
/// it was read, and a file that is no longer that long has been written by
/// something else since — that write is the one that would be lost, so this one
/// is refused instead.
///
/// The file is written in place rather than replaced, so whatever it already is
/// — a symlink, a mode, an owner, a hard link — it stays.
pub fn write_file(raw_path: &str, text: &str, expect_size: u64) -> Result<u64, String> {
    let (host, path) = resolve(raw_path)?;
    let stat = host.stat(&path).ok_or_else(|| "no-such-file".to_string())?;
    if stat.is_dir {
        return Err("is-a-directory".to_string());
    }
    if stat.size > MAX_FILE_HEAD {
        return Err("too-long".to_string());
    }
    if stat.size != expect_size {
        return Err("changed".to_string());
    }

    host.write(&path, text, expect_size)
}

/// The bytes as text, or `None` when they are not text.
///
/// A NUL byte settles it before the decoding does: it is the one thing no text
/// file holds and most compiled ones open with, and finding it means the rest
/// of the buffer need not be walked at all. What is left is decided by whether
/// it is UTF-8 — with the one allowance that a read which stopped at a byte
/// count can have stopped in the middle of a character, and the character that
/// was cut in half is dropped rather than sinking the whole reading.
fn as_text(bytes: &[u8], truncated: bool) -> Option<String> {
    if bytes.contains(&0) {
        return None;
    }
    match std::str::from_utf8(bytes) {
        Ok(text) => Some(text.to_string()),
        // `error_len` is `None` for a sequence that simply ran out of bytes.
        Err(error) if truncated && error.error_len().is_none() => {
            std::str::from_utf8(&bytes[..error.valid_up_to()])
                .ok()
                .map(str::to_string)
        }
        Err(_) => None,
    }
}

/// One child of a directory, as a row of the pane.
fn describe(host: &Host, dir: &Path, child: crate::host::Child) -> Entry {
    let path = host.join(dir, &child.name);
    Entry {
        // Dot files are hidden on both sides: WSL trees are browsed from
        // Windows too, and only Windows marks a file hidden any other way.
        is_hidden: child.stat.hidden || child.name.starts_with('.'),
        size: (!child.stat.is_dir).then_some(child.stat.size),
        modified_ms: child.stat.modified_ms,
        name: child.name,
        path: path.to_string_lossy().into_owned(),
        is_dir: child.stat.is_dir,
        is_symlink: child.stat.is_symlink,
    }
}

/// Directories first, then by name.
///
/// Keyed rather than compared: the lowercase form is what the order is decided
/// on, and building it inside the comparator builds it again for every pair a
/// sort looks at — a directory at [`MAX_ENTRIES`] is thousands of allocations
/// for an answer that is the same every time.
fn sort_entries(entries: &mut [Entry]) {
    entries
        .sort_by_cached_key(|entry| (!entry.is_dir, entry.name.to_lowercase(), entry.name.clone()));
}

/// What the distribution this window is itself running in is called, which is
/// the only name a build inside one has for its own filesystem.
#[cfg(not(windows))]
fn wsl_distro_name() -> Option<String> {
    std::env::var("WSL_DISTRO_NAME")
        .ok()
        .filter(|name| !name.is_empty())
}

/// The entries of the picker's left rail: the home directory first, then every
/// place this platform can reach on the Windows and the WSL side.
pub fn list_roots() -> Vec<Root> {
    let mut roots = Vec::new();
    if let Some(home) = home_dir() {
        // Written `~`, which is what a shell calls it and what can be typed
        // into the field over the menu to reach it. The directory's own name is
        // whatever the account is called, and an account's name says nothing
        // about the place — where it actually is, is the line under it, read
        // from the environment like everything else here.
        let path = home.to_string_lossy().into_owned();
        roots.push(Root {
            kind: RootKind::Home,
            label: "~".to_string(),
            detail: Some(path.clone()),
            path,
        });
    }
    roots.extend(platform_roots());
    roots
}

#[cfg(windows)]
fn platform_roots() -> Vec<Root> {
    let mut roots = Vec::new();
    for letter in 'A'..='Z' {
        let path = format!("{letter}:\\");
        if Path::new(&path).is_dir() {
            roots.push(Root {
                kind: RootKind::WindowsDrive,
                label: format!("{letter}:"),
                detail: None,
                path,
            });
        }
    }
    // Named, not started. The row is the distribution's own root, and asking
    // for it is what starts the distribution — listing the rail must not boot
    // every one of them the machine has installed.
    for distro in wsl::distros() {
        roots.push(Root {
            kind: RootKind::WslDistro,
            label: distro.clone(),
            detail: Some("/".to_string()),
            path: wsl::unc(&distro, "/"),
        });
    }
    roots
}

#[cfg(not(windows))]
fn platform_roots() -> Vec<Root> {
    let mut roots = vec![Root {
        kind: RootKind::UnixRoot,
        label: wsl_distro_name().unwrap_or_else(|| "/".to_string()),
        detail: Some("/".to_string()),
        path: "/".to_string(),
    }];
    let mounts = std::fs::read_to_string("/proc/mounts").unwrap_or_default();
    for mount in parse_windows_mounts(&mounts) {
        roots.push(Root {
            kind: RootKind::WindowsMount,
            label: mount.label,
            detail: Some(mount.path.clone()),
            path: mount.path,
        });
    }
    roots
}

#[cfg_attr(windows, allow(dead_code))]
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WindowsMount {
    pub label: String,
    pub path: String,
}

/// Picks the Windows drives out of `/proc/mounts`. WSL 2 mounts them over 9p
/// with `aname=drvfs`, WSL 1 uses the `drvfs` filesystem type directly.
#[cfg_attr(windows, allow(dead_code))]
pub fn parse_windows_mounts(proc_mounts: &str) -> Vec<WindowsMount> {
    let mut mounts = Vec::new();
    for line in proc_mounts.lines() {
        let mut fields = line.split_whitespace();
        let (Some(device), Some(mount_point), Some(fs_type), Some(options)) =
            (fields.next(), fields.next(), fields.next(), fields.next())
        else {
            continue;
        };
        if fs_type != "drvfs" && !options.contains("aname=drvfs") {
            continue;
        }
        let mount_point = unescape_mount_field(mount_point);
        let device = unescape_mount_field(device);
        // `C:\` reads better in the rail than the `/mnt/c` it is mounted on.
        let label = device.trim_end_matches('\\').to_string();
        mounts.push(WindowsMount {
            label: if label.is_empty() {
                mount_point.clone()
            } else {
                label
            },
            path: mount_point,
        });
    }
    mounts.sort_by(|left, right| left.path.cmp(&right.path));
    mounts.dedup();
    mounts
}

/// `/proc/mounts` escapes spaces, tabs, newlines and backslashes as octal.
#[cfg_attr(windows, allow(dead_code))]
fn unescape_mount_field(field: &str) -> String {
    let mut out = String::with_capacity(field.len());
    let mut chars = field.chars();
    while let Some(c) = chars.next() {
        if c != '\\' {
            out.push(c);
            continue;
        }
        let digits: String = chars.clone().take(3).collect();
        match u8::from_str_radix(&digits, 8) {
            Ok(code) if digits.len() == 3 => {
                out.push(code as char);
                chars.nth(2);
            }
            _ => out.push('\\'),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use std::fs;

    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("totex-test-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("temp dir");
        dir
    }

    #[test]
    fn clean_path_folds_dot_segments() {
        assert_eq!(clean_path(Path::new("/a/./b/../c")), PathBuf::from("/a/c"));
        assert_eq!(clean_path(Path::new("/../..")), PathBuf::from("/"));
        assert_eq!(clean_path(Path::new("a/../../b")), PathBuf::from("../b"));
        assert_eq!(clean_path(Path::new("")), PathBuf::from("."));
    }

    #[test]
    fn a_path_under_home_is_written_with_a_tilde() {
        let home = Path::new("/home/someone");
        assert_eq!(shorten_home("/home/someone", Some(home)), "~");
        assert_eq!(shorten_home("/home/someone/repo", Some(home)), "~/repo");
        // A name that merely begins with the home directory's is another name.
        assert_eq!(
            shorten_home("/home/someone-else/repo", Some(home)),
            "/home/someone-else/repo"
        );
        assert_eq!(shorten_home("/etc", Some(home)), "/etc");
        // The separator the path is already using is the one it comes back in.
        assert_eq!(
            shorten_home(r"C:\Users\a\repo", Some(Path::new(r"C:\Users\a"))),
            r"~\repo"
        );
        // Nowhere to shorten to: a machine with no home, and a home that is the
        // whole disk, both leave every path exactly as it was.
        assert_eq!(shorten_home("/home/someone", None), "/home/someone");
        assert_eq!(shorten_home("/etc", Some(Path::new("/"))), "/etc");
    }

    #[test]
    fn a_folder_is_kept_only_once_it_is_one() {
        let dir = temp_dir("kept");
        let inside = dir.join("repo");
        fs::create_dir_all(&inside).expect("a folder");
        fs::write(dir.join("notes.txt"), "one\n").expect("a file");

        let place = resolve_folder(&inside.to_string_lossy()).expect("a folder");
        assert_eq!(place.path, inside.to_string_lossy());
        assert_eq!(place.label, "repo");

        assert!(resolve_folder(&dir.join("notes.txt").to_string_lossy()).is_err());
        assert!(resolve_folder(&dir.join("nothing").to_string_lossy()).is_err());
        assert!(resolve_folder("  ").is_err());
    }

    #[test]
    fn kept_folders_are_spelled_out_without_reading_them() {
        let places = describe_folders(&[
            "/home/someone/repo/./totex".to_string(),
            "/nowhere/at/all".to_string(),
            String::new(),
        ]);
        // The empty one names no place and drops out; the one that is not there
        // is spelled out like any other, because nothing here asked the disk.
        assert_eq!(places.len(), 2);
        assert_eq!(places[0].path, "/home/someone/repo/totex");
        assert_eq!(places[0].label, "totex");
        assert_eq!(places[1].path, "/nowhere/at/all");
    }

    #[test]
    fn home_is_offered_under_the_name_a_shell_calls_it() {
        let Some(home) = home_dir() else {
            return;
        };
        let roots = list_roots();
        let offered = roots
            .iter()
            .find(|root| root.kind == RootKind::Home)
            .expect("a home");
        assert_eq!(offered.label, "~");
        // Where it actually is stays on the row, read from the environment.
        assert_eq!(offered.path, home.to_string_lossy());
        assert_eq!(offered.detail.as_deref(), Some(offered.path.as_str()));
    }

    #[test]
    fn windows_drives_are_picked_out_of_proc_mounts() {
        let proc_mounts = concat!(
            "/dev/sdc / ext4 rw,relatime 0 0\n",
            "C:\\134 /mnt/c 9p ro,dirsync,aname=drvfs;path=C:\\;uid=1000 0 0\n",
            "D:\\134 /mnt/my\\040drive drvfs rw,noatime 0 0\n",
            "none /mnt/wsl tmpfs ro,nosuid 0 0\n",
        );
        assert_eq!(
            parse_windows_mounts(proc_mounts),
            [
                WindowsMount {
                    label: "C:".to_string(),
                    path: "/mnt/c".to_string()
                },
                WindowsMount {
                    label: "D:".to_string(),
                    path: "/mnt/my drive".to_string()
                },
            ]
        );
    }

    #[test]
    fn listings_sort_directories_first_and_hide_dot_files() {
        let dir = temp_dir("listing");
        fs::create_dir(dir.join("Beta")).unwrap();
        fs::create_dir(dir.join("alpha")).unwrap();
        fs::write(dir.join("notes.txt"), "hello").unwrap();
        fs::write(dir.join(".secret"), "shh").unwrap();

        let listing = read_directory(&dir.to_string_lossy(), false).expect("listing");
        let names: Vec<&str> = listing.entries.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(names, ["alpha", "Beta", "notes.txt"]);
        assert_eq!(listing.entries[2].size, Some(5));
        assert_eq!(listing.parent.as_deref(), dir.parent().unwrap().to_str());
        assert!(!listing.truncated);

        let with_hidden = read_directory(&dir.to_string_lossy(), true).expect("listing");
        assert_eq!(with_hidden.entries.len(), 4);
        assert!(
            with_hidden
                .entries
                .iter()
                .any(|e| e.name == ".secret" && e.is_hidden)
        );

        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn a_directory_that_is_not_there_is_a_failure_and_not_an_empty_listing() {
        // What comes back is not read by anything: the pane draws a rule where
        // the rows would be. Failing rather than answering empty is the whole
        // of the contract, because an empty folder is a different thing.
        assert!(read_directory("/totex/does/not/exist", false).is_err());
        assert!(read_directory("   ", false).is_err());
    }

    #[test]
    fn file_heads_return_text_without_reading_past_the_preview_limit() {
        let dir = temp_dir("file-head");
        let path = dir.join("notes.txt");
        let text = "a".repeat(MAX_FILE_HEAD as usize + 19);
        fs::write(&path, &text).unwrap();

        let head = read_file_head(&path.to_string_lossy()).expect("file head");
        assert_eq!(head.name, "notes.txt");
        assert_eq!(head.size, text.len() as u64);
        assert_eq!(
            head.text.as_deref().map(str::len),
            Some(MAX_FILE_HEAD as usize)
        );
        assert!(head.truncated);

        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn a_written_file_holds_what_the_card_had() {
        let dir = temp_dir("file-write");
        let path = dir.join("notes.txt");
        fs::write(&path, "one\ntwo\n").unwrap();

        let head = read_file_head(&path.to_string_lossy()).expect("file head");
        let written =
            write_file(&path.to_string_lossy(), "one\ntwo\nthree\n", head.size).expect("write");
        assert_eq!(written, 14);
        assert_eq!(fs::read_to_string(&path).unwrap(), "one\ntwo\nthree\n");

        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn a_file_that_moved_under_the_card_is_not_written_over() {
        // The card read one file and something else wrote another. Writing here
        // would drop that write, and what it dropped could be anything.
        let dir = temp_dir("file-stale");
        let path = dir.join("notes.txt");
        fs::write(&path, "one\n").unwrap();
        let head = read_file_head(&path.to_string_lossy()).expect("file head");
        fs::write(&path, "one\ntwo\n").unwrap();

        assert!(write_file(&path.to_string_lossy(), "mine\n", head.size).is_err());
        assert_eq!(fs::read_to_string(&path).unwrap(), "one\ntwo\n");

        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn a_file_past_the_preview_limit_is_never_written() {
        // Only the head of it was ever on screen, and the rest is not this
        // card's to drop.
        let dir = temp_dir("file-long");
        let path = dir.join("long.txt");
        let text = "a".repeat(MAX_FILE_HEAD as usize + 19);
        fs::write(&path, &text).unwrap();

        assert!(write_file(&path.to_string_lossy(), "short", text.len() as u64).is_err());
        assert_eq!(fs::metadata(&path).unwrap().len(), text.len() as u64);
        assert!(write_file(&dir.to_string_lossy(), "short", 0).is_err());
        assert!(write_file("   ", "short", 0).is_err());

        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn binary_files_and_directories_do_not_masquerade_as_text() {
        let dir = temp_dir("binary-head");
        let path = dir.join("image.bin");
        fs::write(&path, [0, 1, 2, 3]).unwrap();

        let head = read_file_head(&path.to_string_lossy()).expect("file head");
        assert_eq!(head.text, None);
        assert!(!head.truncated);
        assert!(read_file_head(&dir.to_string_lossy()).is_err());

        fs::remove_dir_all(&dir).unwrap();
    }

    /// A folder inside a distribution, named the way the window names it —
    /// which is the whole point: the same path string the picker hands back is
    /// the one that comes in here, and it is read inside the distribution.
    ///
    /// Skipped where there is no WSL to reach, which is every CI machine.
    fn wsl_dir(name: &str) -> Option<String> {
        let distro = crate::wsl::distros().into_iter().next()?;
        let path = format!("/tmp/totex-browse-test/{name}");
        crate::wsl::exec(
            &distro,
            None,
            &[],
            &[
                "sh",
                "-c",
                &format!("rm -rf {0}; mkdir -p {0}", crate::wsl::quote(&path)),
            ],
        )
        .ok()?;
        Some(crate::wsl::unc(&distro, &path))
    }

    #[test]
    fn a_folder_inside_a_distribution_is_listed_from_inside_it() {
        let Some(dir) = wsl_dir("listing") else {
            return;
        };
        let host = Host::of(Path::new(&dir));
        host.exec(
            Some(Path::new(&dir)),
            &[],
            &[
                "sh",
                "-c",
                "mkdir Beta alpha; printf hello > notes.txt; printf shh > .secret",
            ],
        )
        .expect("a shell");

        let listing = read_directory(&dir, false).expect("a listing");
        let names: Vec<&str> = listing.entries.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(names, ["alpha", "Beta", "notes.txt"]);
        assert_eq!(listing.entries[2].size, Some(5));
        assert_eq!(listing.name, "listing");
        assert!(listing.distro.is_some(), "the row says which distribution");
        // The paths it hands back are the ones it takes: they go straight back
        // over IPC as the next directory to open.
        assert!(listing.entries[0].path.starts_with(r"\\wsl.localhost\"));
        assert!(read_directory(&listing.entries[0].path, false).is_ok());
        assert!(
            listing
                .parent
                .as_deref()
                .is_some_and(|parent| parent.ends_with(r"\tmp\totex-browse-test")),
            "{:?}",
            listing.parent
        );

        let with_hidden = read_directory(&dir, true).expect("a listing");
        assert_eq!(with_hidden.entries.len(), 4);
    }

    #[test]
    fn a_climbing_path_inside_a_distribution_is_folded_before_it_is_read() {
        let Some(dir) = wsl_dir("climb") else {
            return;
        };
        let listing = read_directory(&format!(r"{dir}\one\.."), false).expect("a listing");
        assert_eq!(listing.path, dir);
    }

    #[test]
    fn a_card_reads_and_writes_a_file_inside_the_distribution() {
        let Some(dir) = wsl_dir("card") else {
            return;
        };
        let host = Host::of(Path::new(&dir));
        host.exec(
            Some(Path::new(&dir)),
            &[],
            &["sh", "-c", "printf 'one\ntwo\n' > notes.txt"],
        )
        .expect("a shell");
        let file = format!(r"{dir}\notes.txt");

        let head = read_file_head(&file).expect("a reading");
        assert_eq!(head.name, "notes.txt");
        assert_eq!(head.text.as_deref(), Some("one\ntwo\n"));
        assert!(!head.truncated);

        assert_eq!(write_file(&file, "one\ntwo\nthree\n", head.size), Ok(14));
        assert_eq!(
            read_file_head(&file).expect("a reading").text.as_deref(),
            Some("one\ntwo\nthree\n")
        );
        // The reading the card holds is stale now, so its write is refused.
        assert!(write_file(&file, "mine\n", head.size).is_err());
        assert!(read_file_head(&dir).is_err(), "a folder is not a card");
    }

    #[test]
    fn roots_always_offer_a_starting_point() {
        let roots = list_roots();
        assert!(!roots.is_empty());
        assert!(roots.iter().all(|root| !root.path.is_empty()));
    }
}
