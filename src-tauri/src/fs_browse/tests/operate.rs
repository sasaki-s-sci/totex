use std::fs;
use std::path::Path;

use super::super::operate::{create_entry, delete_file, duplicate_file, read_file, rename_file};
use super::temp_dir;

#[test]
fn creates_duplicates_renames_reads_and_deletes_a_file() {
    let root = temp_dir("file-operations");
    let raw_root = root.to_string_lossy();

    let file = create_entry(&raw_root, "notes.txt", false).expect("create file");
    fs::write(&file, b"one\ntwo\n").expect("fill file");
    assert_eq!(read_file(&file), Ok(b"one\ntwo\n".to_vec()));

    let copy = duplicate_file(&file).expect("duplicate file");
    assert!(copy.ends_with("notes copy.txt"));
    assert_eq!(read_file(&copy), Ok(b"one\ntwo\n".to_vec()));

    let second = duplicate_file(&file).expect("choose another copy name");
    assert!(second.ends_with("notes copy 2.txt"));

    let renamed = rename_file(&copy, "again.txt").expect("rename file");
    assert!(Path::new(&renamed).is_file());
    delete_file(&renamed).expect("delete file");
    assert!(!Path::new(&renamed).exists());

    let folder = create_entry(&raw_root, "inside", true).expect("create folder");
    assert!(Path::new(&folder).is_dir());
    fs::remove_dir_all(root).expect("clean temp dir");
}

#[test]
fn refuses_names_that_can_leave_the_parent_or_replace_an_entry() {
    let root = temp_dir("file-operation-names");
    let raw_root = root.to_string_lossy();
    let file = create_entry(&raw_root, "held.txt", false).expect("create first");
    create_entry(&raw_root, "other.txt", false).expect("create second");

    assert!(create_entry(&raw_root, "../outside", false).is_err());
    assert!(create_entry(&raw_root, "held.txt", false).is_err());
    assert!(rename_file(&file, "other.txt").is_err());
    assert!(rename_file(&file, "..").is_err());
    fs::remove_dir_all(root).expect("clean temp dir");
}
