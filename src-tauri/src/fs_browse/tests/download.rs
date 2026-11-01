use std::fs;

use super::super::copy::copy_tree;
use super::super::download::{
    expand_home, expand_windows_vars, read_registry_value, read_user_dir,
};
use super::temp_dir;
use crate::host::Host;

#[test]
fn copies_a_whole_folder_and_stops_at_a_link_to_one() {
    let root = temp_dir("download-folder");
    let source = root.join("project");
    fs::create_dir_all(source.join("inside")).expect("make the folder");
    fs::write(source.join("notes.txt"), b"one\n").expect("fill a file");
    fs::write(source.join("inside").join("deep.txt"), b"two\n").expect("fill a deeper one");

    // A link to the folder holding it: followed, this walk would never end.
    #[cfg(unix)]
    std::os::unix::fs::symlink(&source, source.join("itself")).expect("link to the folder");
    #[cfg(unix)]
    std::os::unix::fs::symlink(source.join("notes.txt"), source.join("again.txt"))
        .expect("link to the file");

    let target = root.join("Downloads").join("project");
    fs::create_dir_all(root.join("Downloads")).expect("make the downloads folder");
    let stat = Host::Local.stat(&source).expect("the folder is there");
    copy_tree(&Host::Local, &source, &stat, &Host::Local, &target).expect("copy the folder");

    assert_eq!(
        fs::read(target.join("notes.txt")).ok(),
        Some(b"one\n".to_vec())
    );
    assert_eq!(
        fs::read(target.join("inside").join("deep.txt")).ok(),
        Some(b"two\n".to_vec())
    );
    #[cfg(unix)]
    {
        assert!(
            !target.join("itself").exists(),
            "a link to a folder is left"
        );
        // A link to a file is the file: what a download of it should hold.
        assert_eq!(
            fs::read(target.join("again.txt")).ok(),
            Some(b"one\n".to_vec())
        );
    }
    fs::remove_dir_all(root).expect("clean temp dir");
}

#[test]
fn reads_where_each_platform_says_its_downloads_folder_is() {
    let home = std::path::Path::new("/home/a");
    let written =
        "# a comment\nXDG_DESKTOP_DIR=\"$HOME/Desktop\"\nXDG_DOWNLOAD_DIR=\"$HOME/Downloads\"\n";
    let named = read_user_dir(written, "XDG_DOWNLOAD_DIR").expect("the line is there");
    assert_eq!(expand_home(&named, home), "/home/a/Downloads");
    assert_eq!(expand_home("/mnt/big/incoming", home), "/mnt/big/incoming");
    assert_eq!(
        read_user_dir("XDG_MUSIC_DIR=\"$HOME/Music\"\n", "XDG_DOWNLOAD_DIR"),
        None
    );

    let printed = "\r\nHKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders\r\n    {374DE290-123F-4565-9164-39C4925E467B}    REG_EXPAND_SZ    %USERPROFILE%\\Downloads\r\n\r\n";
    let value = read_registry_value(printed, "{374DE290-123F-4565-9164-39C4925E467B}")
        .expect("the value is there");
    assert_eq!(
        expand_windows_vars(&value, std::path::Path::new("C:\\Users\\a")),
        "C:\\Users\\a\\Downloads"
    );
    assert_eq!(read_registry_value(printed, "{0}"), None);
}
