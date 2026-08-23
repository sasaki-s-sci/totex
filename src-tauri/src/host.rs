//! Where a path lives, and how the app works on it there.
//!
//! Two answers: this machine, or a WSL distribution reached through
//! [`crate::wsl`]. Every path in the app is a plain string that says which —
//! `\\wsl.localhost\Ubuntu\home\a\repo` names a place inside a distribution
//! the same way `C:\Users\a` names one on the Windows disk — so nothing that
//! passes a path around has to know, and only the things that actually touch a
//! file or start a program come through here.
//!
//! ## Why not just read the share
//!
//! Bytes can be read either way; work cannot. A distribution's files are owned
//! by its own user, which no Windows account is, so git refuses the repository
//! outright; the agents are installed inside the distribution; `cmd` will not
//! take a UNC directory to run in; and Windows' change notifications never fire
//! for the share, so nothing would ever refresh. Reaching in is the only one of
//! the two that is the same app on both sides.
//!
//! ## Paths, and why they are not `Path`
//!
//! A remote path is manipulated as a string rather than through `Path`, because
//! it has to mean the same thing in both builds: on Windows `Path` reads the
//! UNC spelling correctly, and on Linux — where these tests run — it sees one
//! component and a backslash is an ordinary letter. So `join`, `parent` and
//! `name` are asked of the host rather than of the path.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use crate::wsl;

/// How many directories one bulk listing asks about at a time.
///
/// A command line is not unbounded and a walk can hold thousands of
/// directories, so the question is asked in mouthfuls. Large enough that the
/// round trips are few, small enough to stay far inside what a shell will take.
const BATCH: usize = 128;

/// What a path is, as much of it as anything here asks.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Stat {
    /// After following a link, which is what "is this a folder" means to a
    /// person looking at a listing.
    pub is_dir: bool,
    pub is_symlink: bool,
    /// Marked hidden by the filesystem itself, which only Windows does. A name
    /// beginning with a dot is hidden too, but that is the caller's rule to
    /// apply — it holds on both sides.
    pub hidden: bool,
    pub size: u64,
    /// Milliseconds since the Unix epoch.
    pub modified_ms: Option<u64>,
}

/// One entry of a directory.
#[derive(Debug, Clone)]
pub struct Child {
    pub name: String,
    pub stat: Stat,
}

/// What a program said, whichever side it ran on.
#[derive(Debug, Clone)]
pub struct Output {
    pub code: i32,
    pub stdout: Vec<u8>,
    pub stderr: Vec<u8>,
}

impl Output {
    pub fn ok(&self) -> bool {
        self.code == 0
    }
}

/// The machine a path is on.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Host {
    Local,
    /// A WSL distribution, by name.
    Wsl(String),
}

impl Host {
    /// Which machine `path` is on, read from the path itself.
    pub fn of(path: &Path) -> Self {
        Self::of_str(&path.to_string_lossy())
    }

    pub fn of_str(path: &str) -> Self {
        match wsl::locate(path) {
            Some(found) => Self::Wsl(found.distro),
            None => Self::Local,
        }
    }

    pub fn is_remote(&self) -> bool {
        matches!(self, Self::Wsl(_))
    }

    /// The distribution's name, for the mark the window puts beside a path.
    pub fn distro(&self) -> Option<&str> {
        match self {
            Self::Local => None,
            Self::Wsl(distro) => Some(distro),
        }
    }

    /// The path as the machine holding it spells it: `/home/a/repo` inside a
    /// distribution, and unchanged here.
    pub fn native(&self, path: &Path) -> String {
        match self {
            Self::Local => path.to_string_lossy().into_owned(),
            Self::Wsl(_) => wsl::locate(&path.to_string_lossy())
                .map(|found| found.path)
                .unwrap_or_else(|| path.to_string_lossy().into_owned()),
        }
    }

    /// A path the machine spelled, back in the form the whole app stores,
    /// compares and hands over IPC.
    pub fn canonical(&self, native: &str) -> PathBuf {
        match self {
            Self::Local => PathBuf::from(native),
            Self::Wsl(distro) => PathBuf::from(wsl::unc(distro, native)),
        }
    }

    pub fn join(&self, path: &Path, name: &str) -> PathBuf {
        match self {
            Self::Local => path.join(name),
            Self::Wsl(_) => self.canonical(&wsl::join(&self.native(path), name)),
        }
    }

    pub fn parent(&self, path: &Path) -> Option<PathBuf> {
        match self {
            Self::Local => path.parent().map(Path::to_path_buf),
            Self::Wsl(_) => wsl::locate(&path.to_string_lossy())?
                .parent()
                .map(|parent| PathBuf::from(parent.unc())),
        }
    }

    /// The last part of a path. A root has none, so it keeps its whole
    /// spelling — `C:\`, or the name of the distribution.
    pub fn name(&self, path: &Path) -> String {
        match self {
            Self::Local => path
                .file_name()
                .map(|name| name.to_string_lossy().into_owned())
                .unwrap_or_else(|| path.to_string_lossy().into_owned()),
            Self::Wsl(_) => wsl::locate(&path.to_string_lossy())
                .map(|found| found.name())
                .unwrap_or_default(),
        }
    }

    // ------------------------------------------------------------ the disk

    pub fn stat(&self, path: &Path) -> Option<Stat> {
        match self {
            Self::Local => local_stat(path),
            Self::Wsl(distro) => {
                let output = wsl::script(distro, None, STAT, &[&self.native(path)]).ok()?;
                if !output.ok() {
                    return None;
                }
                parse_stat(output.text().trim())
            }
        }
    }

    pub fn is_dir(&self, path: &Path) -> bool {
        self.stat(path).is_some_and(|stat| stat.is_dir)
    }

    /// Everything in one directory. The error is the machine's own words about
    /// why it would not open.
    pub fn read_dir(&self, path: &Path) -> Result<Vec<Child>, String> {
        match self {
            Self::Local => {
                let entries = std::fs::read_dir(path).map_err(|error| error.to_string())?;
                Ok(entries
                    .flatten()
                    .filter_map(|entry| local_child(&entry))
                    .collect())
            }
            Self::Wsl(distro) => {
                let output = wsl::script(distro, None, LIST, &[&self.native(path)])?;
                if !output.ok() && output.stdout.is_empty() {
                    return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
                }
                Ok(parse_children(&output.stdout)
                    .into_iter()
                    .map(|(_, child)| child)
                    .collect())
            }
        }
    }

    /// The children of many directories at once, and whatever could not be
    /// read about the ones that would not open.
    ///
    /// One question rather than one per directory: a walk asks this of a whole
    /// level of the tree, and inside a distribution each answer would otherwise
    /// be its own round trip. The walk that uses it is what turns a folder into
    /// the repositories on the canvas, so it is asked about thousands.
    pub fn children(&self, dirs: &[PathBuf]) -> (HashMap<PathBuf, Vec<Child>>, Vec<String>) {
        let mut found: HashMap<PathBuf, Vec<Child>> = HashMap::new();
        let mut warnings = Vec::new();

        match self {
            Self::Local => {
                for dir in dirs {
                    match self.read_dir(dir) {
                        Ok(children) => {
                            found.insert(dir.clone(), children);
                        }
                        Err(error) => warnings.push(error),
                    }
                }
            }
            Self::Wsl(distro) => {
                for batch in dirs.chunks(BATCH) {
                    let native: Vec<String> = batch.iter().map(|dir| self.native(dir)).collect();
                    let args: Vec<&str> = native.iter().map(String::as_str).collect();
                    let output = match wsl::script(distro, None, LIST_MANY, &args) {
                        Ok(output) => output,
                        Err(error) => {
                            warnings.push(error);
                            continue;
                        }
                    };
                    for (parent, child) in parse_children(&output.stdout) {
                        found
                            .entry(self.canonical(&parent))
                            .or_default()
                            .push(child);
                    }
                    // `find` names the directory it could not open, which is
                    // exactly what the walk wants to report.
                    for line in String::from_utf8_lossy(&output.stderr).lines() {
                        let line = line.trim();
                        if !line.is_empty() {
                            warnings.push(line.to_string());
                        }
                    }
                }
                // A directory that answered nothing still answered, and the
                // walk tells "empty" from "unreadable" by which map it is in.
                for dir in dirs {
                    found.entry(dir.clone()).or_default();
                }
            }
        }

        (found, warnings)
    }

    /// The first `limit` bytes of a file, and how long the whole of it is.
    pub fn read_head(&self, path: &Path, limit: u64) -> Result<(Vec<u8>, u64), String> {
        match self {
            Self::Local => {
                use std::io::Read;
                let metadata = std::fs::metadata(path).map_err(|error| error.to_string())?;
                if metadata.is_dir() {
                    return Err("is-a-directory".to_string());
                }
                let file = std::fs::File::open(path).map_err(|error| error.to_string())?;
                let mut bytes = Vec::new();
                file.take(limit)
                    .read_to_end(&mut bytes)
                    .map_err(|error| error.to_string())?;
                Ok((bytes, metadata.len()))
            }
            Self::Wsl(distro) => {
                let limit = limit.to_string();
                let output = wsl::script(distro, None, HEAD, &[&self.native(path), &limit])?;
                match output.code {
                    0 => {}
                    3 => return Err("is-a-directory".to_string()),
                    _ => return Err(String::from_utf8_lossy(&output.stderr).trim().to_string()),
                }
                // The size comes first on a line of its own, then the bytes.
                let cut = output
                    .stdout
                    .iter()
                    .position(|byte| *byte == b'\n')
                    .ok_or("unreadable")?;
                let size: u64 = String::from_utf8_lossy(&output.stdout[..cut])
                    .trim()
                    .parse()
                    .map_err(|_| "unreadable".to_string())?;
                Ok((output.stdout[cut + 1..].to_vec(), size))
            }
        }
    }

    /// Writes a file in place, refusing when it is no longer `expect` bytes
    /// long — see [`crate::fs_browse::write_file`], which is what this is for.
    pub fn write(&self, path: &Path, text: &str, expect: u64) -> Result<u64, String> {
        match self {
            Self::Local => {
                std::fs::write(path, text).map_err(|error| error.to_string())?;
                Ok(text.len() as u64)
            }
            Self::Wsl(distro) => {
                let expect = expect.to_string();
                // The bytes ride inside the command rather than down the
                // channel's own pipe: a command reads nothing, so that one
                // waiting on input cannot hold up everything queued behind it.
                let payload = wsl::encode(text.as_bytes());
                let output = wsl::script(
                    distro,
                    None,
                    WRITE,
                    &[&self.native(path), &expect, &payload],
                )?;
                match output.code {
                    0 => Ok(text.len() as u64),
                    3 => Err("is-a-directory".to_string()),
                    4 => Err("changed".to_string()),
                    _ => Err(String::from_utf8_lossy(&output.stderr).trim().to_string()),
                }
            }
        }
    }

    pub fn create_dir_all(&self, path: &Path) -> Result<(), String> {
        match self {
            Self::Local => std::fs::create_dir_all(path).map_err(|error| error.to_string()),
            Self::Wsl(distro) => {
                let output = wsl::exec(distro, None, &[], &["mkdir", "-p", &self.native(path)])?;
                if output.ok() {
                    Ok(())
                } else {
                    Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
                }
            }
        }
    }

    /// The home directory on the machine the path is on.
    pub fn home(&self) -> Option<PathBuf> {
        match self {
            Self::Local => crate::fs_browse::home_dir(),
            Self::Wsl(distro) => {
                let output =
                    wsl::exec(distro, None, &[], &["sh", "-c", "printf %s \"$HOME\""]).ok()?;
                let home = output.text();
                (!home.trim().is_empty()).then(|| self.canonical(home.trim()))
            }
        }
    }

    /// The path with every link along it followed, or `None` when it is not
    /// there. What `canonicalize` is on this machine.
    pub fn resolve(&self, path: &Path) -> Option<PathBuf> {
        match self {
            Self::Local => path.canonicalize().ok(),
            Self::Wsl(distro) => {
                let output = wsl::exec(
                    distro,
                    None,
                    &[],
                    &["readlink", "-f", "--", &self.native(path)],
                )
                .ok()?;
                let resolved = output.text();
                let resolved = resolved.trim();
                (output.ok() && !resolved.is_empty()).then(|| self.canonical(resolved))
            }
        }
    }

    /// Where a scratch directory belongs on this machine.
    pub fn temp_dir(&self) -> PathBuf {
        match self {
            Self::Local => std::env::temp_dir(),
            Self::Wsl(_) => self.canonical("/tmp"),
        }
    }

    // ------------------------------------------------------------ programs

    /// Runs one program on the machine the path is on, and waits for it.
    pub fn exec(
        &self,
        cwd: Option<&Path>,
        env: &[(&str, &str)],
        argv: &[&str],
    ) -> Result<Output, String> {
        match self {
            Self::Local => {
                let Some((program, arguments)) = argv.split_first() else {
                    return Err("no-command".to_string());
                };
                let mut command = std::process::Command::new(program);
                command.args(arguments);
                if let Some(cwd) = cwd {
                    command.current_dir(cwd);
                }
                for (name, value) in env {
                    command.env(name, value);
                }
                #[cfg(windows)]
                {
                    use std::os::windows::process::CommandExt;
                    command.creation_flags(0x0800_0000);
                }
                let output = command.output().map_err(|error| match error.kind() {
                    std::io::ErrorKind::NotFound => "not-found".to_string(),
                    _ => error.to_string(),
                })?;
                Ok(Output {
                    code: output.status.code().unwrap_or(-1),
                    stdout: output.stdout,
                    stderr: output.stderr,
                })
            }
            Self::Wsl(distro) => {
                let cwd = cwd.map(|cwd| self.native(cwd));
                let output = wsl::exec(distro, cwd.as_deref(), env, argv)?;
                Ok(Output {
                    code: output.code,
                    stdout: output.stdout,
                    stderr: output.stderr,
                })
            }
        }
    }
}

// ---------------------------------------------------------------- the scripts

/// One path, as `%y` (what it is) `%Y` (what it points at) size and mtime.
const STAT: &str = r#"exec find "$1" -maxdepth 0 -printf '%y\t%Y\t%s\t%T@\n'"#;

/// One directory's children, NUL-terminated so a newline in a name is a name.
const LIST: &str = r#"exec find "$1" -maxdepth 1 -mindepth 1 -printf '%y\t%Y\t%s\t%T@\t%p\0'"#;

/// The same, for as many directories as were asked about at once.
const LIST_MANY: &str = r#"exec find "$@" -maxdepth 1 -mindepth 1 -printf '%y\t%Y\t%s\t%T@\t%p\0'"#;

/// How long a file is, then as much of it as was asked for.
const HEAD: &str = r#"
[ -e "$1" ] || exit 2
[ -d "$1" ] && exit 3
size=$(wc -c <"$1") || exit 4
printf '%s\n' "$size"
exec head -c "$2" -- "$1"
"#;

/// A file written back over itself, and only while it is the length it was.
///
/// Written in place rather than replaced, so whatever the file already is — a
/// symlink, a mode, an owner, a hard link — it stays.
const WRITE: &str = r#"
[ -e "$1" ] || exit 2
[ -d "$1" ] && exit 3
[ "$(wc -c <"$1")" = "$2" ] || exit 4
printf '%s' "$3" | base64 -d >"$1"
"#;

// ---------------------------------------------------------------- reading them

/// `%y \t %Y \t %s \t %T@` — the four fields every one of the scripts prints.
fn parse_stat(fields: &str) -> Option<Stat> {
    let mut parts = fields.split('\t');
    let kind = parts.next()?;
    let target = parts.next()?;
    let size = parts.next()?.trim().parse().unwrap_or(0);
    let modified_ms = parts.next().and_then(epoch_ms);
    Some(Stat {
        is_dir: target == "d",
        is_symlink: kind == "l",
        // Nothing in a Linux filesystem marks a file hidden.
        hidden: false,
        size,
        modified_ms,
    })
}

/// `find`'s `%T@`: seconds since the epoch, with a fraction.
fn epoch_ms(value: &str) -> Option<u64> {
    let seconds: f64 = value.trim().parse().ok()?;
    if seconds < 0.0 {
        return None;
    }
    Some((seconds * 1_000.0) as u64)
}

/// The records of a listing: each one a stat and the full path it is of, which
/// is what says which of the directories asked about it belongs to.
fn parse_children(stdout: &[u8]) -> Vec<(String, Child)> {
    let mut found = Vec::new();
    for record in stdout.split(|byte| *byte == 0) {
        if record.is_empty() {
            continue;
        }
        let text = String::from_utf8_lossy(record);
        // The path is last because it is the one field allowed to hold a tab.
        let mut fields = text.splitn(5, '\t');
        let head: Vec<&str> = (&mut fields).take(4).collect();
        let (Some(path), 4) = (fields.next(), head.len()) else {
            continue;
        };
        let Some(stat) = parse_stat(&head.join("\t")) else {
            continue;
        };
        let (parent, name) = match path.rfind('/') {
            Some(0) => ("/".to_string(), path[1..].to_string()),
            Some(cut) => (path[..cut].to_string(), path[cut + 1..].to_string()),
            None => continue,
        };
        found.push((parent, Child { name, stat }));
    }
    found
}

fn local_stat(path: &Path) -> Option<Stat> {
    let link = std::fs::symlink_metadata(path).ok();
    let metadata = std::fs::metadata(path).ok().or_else(|| link.clone())?;
    Some(Stat {
        is_dir: metadata.is_dir(),
        is_symlink: link.map(|link| link.is_symlink()).unwrap_or(false),
        hidden: marked_hidden(&metadata),
        size: metadata.len(),
        modified_ms: metadata
            .modified()
            .ok()
            .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
            .map(|since| since.as_millis() as u64),
    })
}

/// Whether the filesystem itself calls this file hidden, which only Windows
/// has an answer to.
fn marked_hidden(metadata: &std::fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        const FILE_ATTRIBUTE_HIDDEN: u32 = 0x0000_0002;
        const FILE_ATTRIBUTE_SYSTEM: u32 = 0x0000_0004;
        metadata.file_attributes() & (FILE_ATTRIBUTE_HIDDEN | FILE_ATTRIBUTE_SYSTEM) != 0
    }
    #[cfg(not(windows))]
    {
        let _ = metadata;
        false
    }
}

fn local_child(entry: &std::fs::DirEntry) -> Option<Child> {
    let file_type = entry.file_type().ok()?;
    let is_symlink = file_type.is_symlink();
    // `DirEntry::file_type` never follows a link, so a link to a directory
    // needs the target's own metadata to be shown as one.
    let is_dir = if is_symlink {
        std::fs::metadata(entry.path())
            .map(|meta| meta.is_dir())
            .unwrap_or(false)
    } else {
        file_type.is_dir()
    };
    let metadata = entry.metadata().ok();
    Some(Child {
        name: entry.file_name().to_string_lossy().into_owned(),
        stat: Stat {
            is_dir,
            is_symlink,
            hidden: metadata.as_ref().is_some_and(marked_hidden),
            size: metadata.as_ref().map(|meta| meta.len()).unwrap_or(0),
            modified_ms: metadata
                .as_ref()
                .and_then(|meta| meta.modified().ok())
                .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
                .map(|since| since.as_millis() as u64),
        },
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_windows_path_is_this_machine() {
        assert_eq!(Host::of(Path::new(r"C:\Users\a")), Host::Local);
        assert_eq!(Host::of(Path::new("/home/a")), Host::Local);
    }

    #[test]
    fn a_share_path_is_the_distribution_it_names() {
        let host = Host::of(Path::new(r"\\wsl.localhost\Ubuntu\home\a"));
        assert_eq!(host, Host::Wsl("Ubuntu".to_string()));
        assert_eq!(
            host.native(Path::new(r"\\wsl.localhost\Ubuntu\home\a")),
            "/home/a"
        );
        assert_eq!(
            host.canonical("/home/a/repo"),
            PathBuf::from(r"\\wsl.localhost\Ubuntu\home\a\repo")
        );
    }

    /// The reason these are asked of the host: on a Linux build `Path` reads
    /// none of it, and this is the build the tests run in.
    #[test]
    fn walks_a_remote_path_without_going_through_path() {
        let host = Host::Wsl("Ubuntu".to_string());
        let dir = PathBuf::from(r"\\wsl.localhost\Ubuntu\home\a");
        assert_eq!(
            host.join(&dir, "repo"),
            PathBuf::from(r"\\wsl.localhost\Ubuntu\home\a\repo")
        );
        assert_eq!(
            host.parent(&dir),
            Some(PathBuf::from(r"\\wsl.localhost\Ubuntu\home"))
        );
        assert_eq!(host.name(&dir), "a");
        assert_eq!(host.name(Path::new(r"\\wsl.localhost\Ubuntu")), "Ubuntu");
    }

    #[test]
    fn reads_what_find_prints_about_one_path() {
        let stat = parse_stat("d\td\t4096\t1690000000.5").expect("a stat");
        assert!(stat.is_dir && !stat.is_symlink);
        assert_eq!(stat.modified_ms, Some(1_690_000_000_500));

        let link = parse_stat("l\td\t12\t1690000000").expect("a stat");
        assert!(link.is_dir && link.is_symlink, "a link to a folder is one");

        let broken = parse_stat("l\tN\t12\t1690000000").expect("a stat");
        assert!(!broken.is_dir && broken.is_symlink);
    }

    #[test]
    fn reads_a_listing_back_into_the_directories_it_came_from() {
        let mut raw = Vec::new();
        raw.extend_from_slice(b"d\td\t4096\t1690000000\t/home/a/repo\0");
        raw.extend_from_slice(b"f\tf\t12\t1690000001\t/home/a/notes.txt\0");
        raw.extend_from_slice(b"f\tf\t3\t1690000002\t/srv/thing\0");
        let found = parse_children(&raw);
        assert_eq!(found.len(), 3);
        assert_eq!(found[0].0, "/home/a");
        assert_eq!(found[0].1.name, "repo");
        assert!(found[0].1.stat.is_dir);
        assert_eq!(found[2].0, "/srv");
    }

    #[test]
    fn a_name_may_hold_anything_but_a_slash() {
        let raw = b"f\tf\t1\t1690000000\t/home/a/one\ttwo\nthree\0";
        let found = parse_children(raw);
        assert_eq!(found[0].1.name, "one\ttwo\nthree");
        assert_eq!(found[0].0, "/home/a");
    }

    /// A distribution to try things in, or `None` where there is none —
    /// which is every machine the CI builds on, so these skip rather than fail.
    fn reachable() -> Option<Host> {
        crate::wsl::distros().into_iter().next().map(Host::Wsl)
    }

    /// One scratch directory inside the distribution, emptied first.
    ///
    /// Named after the test that asked for it: these run alongside each other,
    /// and a shared directory would be one test clearing another's setup.
    fn scratch(host: &Host, name: &str) -> PathBuf {
        let dir = host.canonical(&format!("/tmp/totex-host-test/{name}"));
        host.exec(None, &[], &["rm", "-rf", &host.native(&dir)])
            .expect("a shell");
        host.create_dir_all(&dir).expect("a directory");
        dir
    }

    #[test]
    fn reads_a_directory_inside_the_distribution() {
        let Some(host) = reachable() else {
            return;
        };
        let dir = scratch(&host, "listing");
        host.exec(
            Some(&dir),
            &[],
            &["sh", "-c", "mkdir sub; printf 12345 > file; ln -s sub link"],
        )
        .expect("a shell");

        let mut children = host.read_dir(&dir).expect("a listing");
        children.sort_by(|left, right| left.name.cmp(&right.name));
        let names: Vec<&str> = children.iter().map(|child| child.name.as_str()).collect();
        assert_eq!(names, vec!["file", "link", "sub"]);

        assert!(children[0].stat.size == 5 && !children[0].stat.is_dir);
        assert!(children[1].stat.is_symlink && children[1].stat.is_dir);
        assert!(children[2].stat.is_dir && !children[2].stat.is_symlink);
        assert!(children[0].stat.modified_ms.unwrap_or(0) > 1_600_000_000_000);
    }

    #[test]
    fn says_what_one_path_is() {
        let Some(host) = reachable() else {
            return;
        };
        let dir = scratch(&host, "stat");
        assert!(host.is_dir(&dir));
        assert!(host.stat(&dir).expect("a stat").is_dir);
        assert!(host.stat(&host.join(&dir, "nothing")).is_none());
    }

    #[test]
    fn reads_the_top_of_a_file_and_says_how_long_it_is() {
        let Some(host) = reachable() else {
            return;
        };
        let dir = scratch(&host, "head");
        host.exec(Some(&dir), &[], &["sh", "-c", "printf 'abcdefghij' > file"])
            .expect("a shell");
        let file = host.join(&dir, "file");

        let (bytes, size) = host.read_head(&file, 4).expect("a reading");
        assert_eq!(bytes, b"abcd");
        assert_eq!(size, 10, "the whole file, not the part that was read");

        assert_eq!(host.read_head(&dir, 10), Err("is-a-directory".to_string()));
    }

    #[test]
    fn writes_a_file_back_only_while_it_is_the_length_it_was() {
        let Some(host) = reachable() else {
            return;
        };
        let dir = scratch(&host, "write");
        host.exec(Some(&dir), &[], &["sh", "-c", "printf 'hello' > file"])
            .expect("a shell");
        let file = host.join(&dir, "file");

        host.write(&file, "it's \"new\"\n", 5).expect("a write");
        let (bytes, _) = host.read_head(&file, 64).expect("a read");
        assert_eq!(String::from_utf8_lossy(&bytes), "it's \"new\"\n");
        // The file is no longer five bytes, so the stale write is refused.
        assert_eq!(host.write(&file, "x", 5), Err("changed".to_string()));
    }

    /// What the walk over a folder of repositories is built on.
    #[test]
    fn asks_about_many_directories_at_once() {
        let Some(host) = reachable() else {
            return;
        };
        let dir = scratch(&host, "children");
        host.exec(
            Some(&dir),
            &[],
            &["sh", "-c", "mkdir -p one/deep two; touch one/file"],
        )
        .expect("a shell");

        let dirs = vec![host.join(&dir, "one"), host.join(&dir, "two")];
        let (found, warnings) = host.children(&dirs);
        assert!(warnings.is_empty(), "{warnings:?}");
        assert_eq!(found[&dirs[0]].len(), 2);
        assert!(found[&dirs[1]].is_empty(), "an empty folder still answered");
    }

    #[test]
    fn a_directory_that_will_not_open_is_reported_rather_than_dropped() {
        let Some(host) = reachable() else {
            return;
        };
        let dir = scratch(&host, "missing");
        let (found, warnings) = host.children(&[host.join(&dir, "missing")]);
        assert!(found.values().all(|children| children.is_empty()));
        assert!(!warnings.is_empty(), "nothing was said about it");
    }

    #[test]
    fn the_home_of_the_distribution_is_the_one_inside_it() {
        let Some(host) = reachable() else {
            return;
        };
        let home = host.home().expect("a home");
        assert!(host.native(&home).starts_with('/'));
        assert!(host.is_dir(&home));
    }

    #[test]
    fn a_child_of_the_root_belongs_to_the_root() {
        let found = parse_children(b"d\td\t4096\t1690000000\t/srv\0");
        assert_eq!(found[0].0, "/");
        assert_eq!(found[0].1.name, "srv");
    }
}
