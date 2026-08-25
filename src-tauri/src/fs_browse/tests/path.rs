//! Folding a path, shortening it, and settling one into a folder to keep.

use std::fs;
use std::path::{Path, PathBuf};

use super::super::path::{clean_path, describe_folders, resolve_folder, shorten_home};
use super::temp_dir;

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
    // The empty one names no place and drops out; the one that is not there is
    // spelled out like any other, because nothing here asked the disk.
    assert_eq!(places.len(), 2);
    assert_eq!(places[0].path, "/home/someone/repo/totex");
    assert_eq!(places[0].label, "totex");
    assert_eq!(places[1].path, "/nowhere/at/all");
}
