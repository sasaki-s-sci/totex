//! The entries of the picker's left rail: everywhere this platform can start a
//! pane, on the Windows and the WSL side alike.

use super::model::{Root, RootKind};
use super::path::home_dir;

/// The home directory first, then whatever this platform can reach.
pub fn list_roots() -> Vec<Root> {
    let mut roots = Vec::new();
    if let Some(home) = home_dir() {
        // Written `~`, which is what a shell calls it and what can be typed into
        // the field over the menu. The directory's own name is whatever the
        // account is called, which says nothing about the place — where it
        // actually is goes on the line under it.
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
    use crate::wsl;

    let mut roots = Vec::new();
    for letter in 'A'..='Z' {
        let path = format!("{letter}:\\");
        if std::path::Path::new(&path).is_dir() {
            roots.push(Root {
                kind: RootKind::WindowsDrive,
                label: format!("{letter}:"),
                detail: None,
                path,
            });
        }
    }
    // Named, not started: asking for a distribution's root is what boots it, and
    // listing the rail must not boot every one the machine has installed.
    for distro in wsl::distros() {
        // Home first, as it is at the top of this rail — the account's own
        // folder is where the work is, and its root is where the system is.
        // Written `~` because that is all this side knows: which account the
        // distribution runs as is something only the distribution can say, and
        // asking is what starting it would be. It is folded into the real path
        // when the row is picked, by which point the distribution is up anyway.
        roots.push(Root {
            kind: RootKind::WslDistro,
            label: distro.clone(),
            detail: Some("~".to_string()),
            path: wsl::unc(&distro, "/~"),
        });
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

/// What the distribution this window is itself running in is called, which is
/// the only name a build inside one has for its own filesystem.
#[cfg(not(windows))]
fn wsl_distro_name() -> Option<String> {
    std::env::var("WSL_DISTRO_NAME")
        .ok()
        .filter(|name| !name.is_empty())
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
