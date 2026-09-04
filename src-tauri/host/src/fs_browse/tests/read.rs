//! Listing a directory, and reading and writing a file.

use std::fs;

use super::super::read::{read_directory, read_file_data, read_file_head, write_file};
use super::super::{MAX_FILE_DATA, MAX_FILE_HEAD};
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

/// The whole of it, and nothing of it decoded on the way: what the window is
/// handed is the file's own bytes, spelled the one way JSON can carry them.
#[test]
fn a_picture_is_answered_with_the_whole_of_its_bytes() {
    let dir = temp_dir("file-data");
    let path = dir.join("dot.png");
    // The eight bytes every PNG opens with, which is a picture as far as
    // anything here is concerned: nothing in the layer reads what a file is.
    fs::write(&path, [0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a]).unwrap();

    let read = read_file_data(&path.to_string_lossy()).expect("the file");
    assert_eq!(read.name, "dot.png");
    assert_eq!(read.size, 8);
    assert_eq!(read.data.as_deref(), Some("iVBORw0KGgo="));

    assert!(read_file_data(&dir.to_string_lossy()).is_err());
    assert!(read_file_data("/totex/does/not/exist").is_err());

    fs::remove_dir_all(&dir).unwrap();
}

/// Nothing rather than an error, because the card has something to say about a
/// file it cannot draw and nothing to say about a failure.
#[test]
fn a_picture_past_what_a_card_draws_comes_back_with_nothing_in_it() {
    let dir = temp_dir("file-data-long");
    let path = dir.join("huge.png");
    fs::write(&path, vec![7u8; MAX_FILE_DATA as usize + 1]).unwrap();

    let read = read_file_data(&path.to_string_lossy()).expect("the file");
    assert_eq!(read.size, MAX_FILE_DATA + 1);
    assert_eq!(read.data, None);

    fs::remove_dir_all(&dir).unwrap();
}
