//! The rail: what a pane can be started at, on either side.

use super::super::model::RootKind;
use super::super::path::home_dir;
use super::super::roots::{WindowsMount, list_roots, parse_windows_mounts};

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
fn roots_always_offer_a_starting_point() {
    let roots = list_roots();
    assert!(!roots.is_empty());
    assert!(roots.iter().all(|root| !root.path.is_empty()));
}
