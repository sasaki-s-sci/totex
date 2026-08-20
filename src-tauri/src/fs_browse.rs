//! Filesystem browsing primitives shared by the folder picker window and the
//! folder tree of the main window.
//!
//! Paths cross the IPC boundary as plain strings so that Windows locations
//! (`C:\Users\...`, `\\wsl.localhost\Ubuntu\home\...`) and WSL locations
//! (`/home/...`, `/mnt/c/...`) both survive the round trip untouched.

use std::ffi::OsStr;
use std::fs;
use std::io::Read;
use std::path::{Component, Path, PathBuf};
use std::time::UNIX_EPOCH;

use serde::Serialize;

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
    /// A WSL distribution seen from Windows (`\\wsl.localhost\Ubuntu`).
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
    /// once `~` expansion, `..` folding or the `\\wsl$\` fallback ran.
    pub path: String,
    pub name: String,
    pub parent: Option<String>,
    pub entries: Vec<Entry>,
    /// Set when the directory holds more than [`MAX_ENTRIES`] children.
    pub truncated: bool,
}

/// The top of one file, for the card the canvas draws it in.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileHead {
    /// The file that actually answered, which may differ from the request once
    /// `~` expansion, `..` folding or the `\\wsl$\` fallback ran.
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

/// `\\wsl.localhost\` only exists on recent Windows builds; older ones publish
/// the same share as `\\wsl$\`. Retrying under the legacy prefix keeps distro
/// roots reachable on both.
pub fn wsl_legacy_alias(path: &str) -> Option<String> {
    let rest = path.strip_prefix(r"\\wsl.localhost\")?;
    Some(format!(r"\\wsl$\{rest}"))
}

/// Reads `raw_path` and returns its children, sorted directories first.
pub fn read_directory(raw_path: &str, show_hidden: bool) -> Result<Listing, String> {
    if raw_path.trim().is_empty() {
        return Err("empty-path".to_string());
    }
    let requested = clean_path(&expand_user_path(raw_path));
    let (path, dir) = open_directory(&requested)?;

    let mut entries = Vec::new();
    let mut truncated = false;
    for entry in dir {
        let Ok(entry) = entry else {
            // A single unreadable child must not sink the whole listing.
            continue;
        };
        let Some(entry) = describe(&entry) else {
            continue;
        };
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
        name: display_name(&path),
        parent: path
            .parent()
            .map(|parent| parent.to_string_lossy().into_owned()),
        path: path.to_string_lossy().into_owned(),
        entries,
        truncated,
    })
}

/// Opens `path`, falling back to the legacy WSL share when the modern one is
/// missing, and reports which path actually answered.
fn open_directory(path: &Path) -> Result<(PathBuf, fs::ReadDir), String> {
    match fs::read_dir(path) {
        Ok(dir) => Ok((path.to_path_buf(), dir)),
        Err(error) => {
            if let Some(alias) = wsl_legacy_alias(&path.to_string_lossy())
                && let Ok(dir) = fs::read_dir(&alias)
            {
                return Ok((PathBuf::from(alias), dir));
            }
            Err(error.to_string())
        }
    }
}

/// Reads the top of `raw_path`, for a card on the canvas.
///
/// A directory is a failure here rather than an empty file: the two are
/// different things, and the card that would draw the second one is not what a
/// folder should put on the canvas.
pub fn read_file_head(raw_path: &str) -> Result<FileHead, String> {
    if raw_path.trim().is_empty() {
        return Err("empty-path".to_string());
    }
    let requested = clean_path(&expand_user_path(raw_path));
    let (path, bytes, size) = open_file(&requested)?;
    let truncated = size > bytes.len() as u64;

    Ok(FileHead {
        name: display_name(&path),
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
    if raw_path.trim().is_empty() {
        return Err("empty-path".to_string());
    }
    let requested = clean_path(&expand_user_path(raw_path));
    let (path, metadata) = stat_file(&requested)?;
    if metadata.is_dir() {
        return Err("is-a-directory".to_string());
    }
    if metadata.len() > MAX_FILE_HEAD {
        return Err("too-long".to_string());
    }
    if metadata.len() != expect_size {
        return Err("changed".to_string());
    }

    fs::write(&path, text).map_err(|error| error.to_string())?;
    Ok(text.len() as u64)
}

/// What a path is, under the legacy WSL share as well, and which one answered.
fn stat_file(path: &Path) -> Result<(PathBuf, fs::Metadata), String> {
    match fs::metadata(path) {
        Ok(metadata) => Ok((path.to_path_buf(), metadata)),
        Err(error) => {
            if let Some(alias) = wsl_legacy_alias(&path.to_string_lossy())
                && let Ok(metadata) = fs::metadata(&alias)
            {
                return Ok((PathBuf::from(alias), metadata));
            }
            Err(error.to_string())
        }
    }
}

/// Opens `path` under the legacy WSL share as well, the way a directory is
/// opened, and reports which one answered.
fn open_file(path: &Path) -> Result<(PathBuf, Vec<u8>, u64), String> {
    match head_of(path) {
        Ok((bytes, size)) => Ok((path.to_path_buf(), bytes, size)),
        Err(error) => {
            if let Some(alias) = wsl_legacy_alias(&path.to_string_lossy())
                && let Ok((bytes, size)) = head_of(Path::new(&alias))
            {
                return Ok((PathBuf::from(alias), bytes, size));
            }
            Err(error)
        }
    }
}

/// The first [`MAX_FILE_HEAD`] bytes of a file, and how long the file itself is.
fn head_of(path: &Path) -> Result<(Vec<u8>, u64), String> {
    let metadata = fs::metadata(path).map_err(|error| error.to_string())?;
    if metadata.is_dir() {
        return Err("is-a-directory".to_string());
    }
    let file = fs::File::open(path).map_err(|error| error.to_string())?;
    let mut bytes = Vec::new();
    file.take(MAX_FILE_HEAD)
        .read_to_end(&mut bytes)
        .map_err(|error| error.to_string())?;
    Ok((bytes, metadata.len()))
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

fn describe(entry: &fs::DirEntry) -> Option<Entry> {
    let path = entry.path();
    let name = entry.file_name().to_string_lossy().into_owned();
    let file_type = entry.file_type().ok()?;
    let is_symlink = file_type.is_symlink();
    // `DirEntry::file_type` never follows symlinks, so a link to a directory
    // needs the target's metadata to be shown as a directory.
    let is_dir = if is_symlink {
        fs::metadata(&path)
            .map(|meta| meta.is_dir())
            .unwrap_or(false)
    } else {
        file_type.is_dir()
    };
    let metadata = entry.metadata().ok();
    let modified_ms = metadata
        .as_ref()
        .and_then(|meta| meta.modified().ok())
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|since_epoch| since_epoch.as_millis() as u64);

    Some(Entry {
        is_hidden: is_hidden(&name, metadata.as_ref()),
        size: if is_dir {
            None
        } else {
            metadata.as_ref().map(|meta| meta.len())
        },
        modified_ms,
        name,
        path: path.to_string_lossy().into_owned(),
        is_dir,
        is_symlink,
    })
}

fn is_hidden(name: &str, metadata: Option<&fs::Metadata>) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        const FILE_ATTRIBUTE_HIDDEN: u32 = 0x0000_0002;
        const FILE_ATTRIBUTE_SYSTEM: u32 = 0x0000_0004;
        if let Some(metadata) = metadata
            && metadata.file_attributes() & (FILE_ATTRIBUTE_HIDDEN | FILE_ATTRIBUTE_SYSTEM) != 0
        {
            return true;
        }
    }
    #[cfg(not(windows))]
    let _ = metadata;
    // Dot files are hidden on both sides: WSL trees are browsed from Windows too.
    name.starts_with('.')
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

/// The name to show for a directory: roots such as `C:\` or `/` keep the whole
/// path because they have no file name of their own.
fn display_name(path: &Path) -> String {
    path.file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.to_string_lossy().into_owned())
}

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
        // Called what the directory is called. The rail names places, and a
        // place named by this app rather than by the disk is a word the window
        // wrote — the mark beside the row is what says which kind it is.
        let path = home.to_string_lossy().into_owned();
        roots.push(Root {
            kind: RootKind::Home,
            label: home
                .file_name()
                .map(|name| name.to_string_lossy().into_owned())
                .unwrap_or_else(|| path.clone()),
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
    for distro in wsl_distros() {
        let path = format!(r"\\wsl.localhost\{distro}");
        roots.push(Root {
            kind: RootKind::WslDistro,
            label: distro,
            detail: Some(path.clone()),
            path,
        });
    }
    roots
}

/// The installed WSL distributions, as reported by `wsl.exe`.
#[cfg(windows)]
fn wsl_distros() -> Vec<String> {
    use std::os::windows::process::CommandExt;
    /// Keeps `wsl.exe` from flashing a console window over the app.
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    let output = std::process::Command::new("wsl.exe")
        .args(["--list", "--quiet"])
        .creation_flags(CREATE_NO_WINDOW)
        .output();
    match output {
        // WSL is simply not installed, which is not an error worth surfacing.
        Err(_) => Vec::new(),
        Ok(output) if !output.status.success() => Vec::new(),
        Ok(output) => parse_wsl_list(&output.stdout),
    }
}

/// Parses `wsl.exe --list --quiet`, which answers in UTF-16LE on most builds
/// and in UTF-8 on others.
#[cfg_attr(not(any(windows, test)), allow(dead_code))]
pub fn parse_wsl_list(stdout: &[u8]) -> Vec<String> {
    let zeros = stdout.iter().filter(|byte| **byte == 0).count();
    let text = if zeros * 3 > stdout.len() {
        let units: Vec<u16> = stdout
            .chunks_exact(2)
            .map(|pair| u16::from_le_bytes([pair[0], pair[1]]))
            .collect();
        String::from_utf16_lossy(&units)
    } else {
        String::from_utf8_lossy(stdout).into_owned()
    };

    text.lines()
        .map(|line| line.trim_matches(|c: char| c.is_whitespace() || c == '\u{feff}' || c == '\0'))
        // `--quiet` drops the header, but not the default marker on old builds.
        .map(|line| line.trim_end_matches("(Default)").trim())
        .filter(|line| !line.is_empty())
        .map(str::to_string)
        .collect()
}

#[cfg(not(windows))]
fn platform_roots() -> Vec<Root> {
    let mut roots = vec![Root {
        kind: RootKind::UnixRoot,
        label: wsl_distro_name().unwrap_or_else(|| "/".to_string()),
        detail: Some("/".to_string()),
        path: "/".to_string(),
    }];
    let mounts = fs::read_to_string("/proc/mounts").unwrap_or_default();
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
    fn wsl_shares_fall_back_to_the_legacy_prefix() {
        assert_eq!(
            wsl_legacy_alias(r"\\wsl.localhost\Ubuntu\home").as_deref(),
            Some(r"\\wsl$\Ubuntu\home")
        );
        assert_eq!(wsl_legacy_alias(r"C:\Users"), None);
        assert_eq!(wsl_legacy_alias("/home/user"), None);
    }

    #[test]
    fn wsl_list_is_read_as_utf16_or_utf8() {
        let mut utf16 = Vec::new();
        for unit in "Ubuntu-24.04\r\nDebian\r\n".encode_utf16() {
            utf16.extend_from_slice(&unit.to_le_bytes());
        }
        assert_eq!(parse_wsl_list(&utf16), ["Ubuntu-24.04", "Debian"]);
        assert_eq!(
            parse_wsl_list(b"Ubuntu (Default)\nDebian\n"),
            ["Ubuntu", "Debian"]
        );
        assert!(parse_wsl_list(b"").is_empty());
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

    #[test]
    fn roots_always_offer_a_starting_point() {
        let roots = list_roots();
        assert!(!roots.is_empty());
        assert!(roots.iter().all(|root| !root.path.is_empty()));
    }
}
