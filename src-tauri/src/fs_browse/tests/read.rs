//! Listing a directory, and reading and writing the head of a file.

use std::fs;

use super::super::MAX_FILE_HEAD;
use super::super::read::{read_directory, read_file_head, write_file};
use super::temp_dir;

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

/// Failing rather than answering empty is the whole of the contract: an empty
/// folder is a different thing, and the pane draws a rule where the rows would
/// be.
#[test]
fn a_directory_that_is_not_there_is_a_failure_and_not_an_empty_listing() {
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

/// The card read one file and something else wrote another. Writing here would
/// drop that write, and what it dropped could be anything.
#[test]
fn a_file_that_moved_under_the_card_is_not_written_over() {
    let dir = temp_dir("file-stale");
    let path = dir.join("notes.txt");
    fs::write(&path, "one\n").unwrap();
    let head = read_file_head(&path.to_string_lossy()).expect("file head");
    fs::write(&path, "one\ntwo\n").unwrap();

    assert!(write_file(&path.to_string_lossy(), "mine\n", head.size).is_err());
    assert_eq!(fs::read_to_string(&path).unwrap(), "one\ntwo\n");

    fs::remove_dir_all(&dir).unwrap();
}

/// Only the head of it was ever on screen, and the rest is not the card's to
/// drop.
#[test]
fn a_file_past_the_preview_limit_is_never_written() {
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
