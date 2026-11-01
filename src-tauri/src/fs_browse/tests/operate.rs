use std::fs;
use std::path::Path;

use super::super::operate::{
    create_entry, delete_file, delete_folder, duplicate_file, read_file, rename_file,
};
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

#[test]
fn file_operations_agree_on_missing_paths_and_directories() {
    let root = temp_dir("file-operation-refusals");
    let missing = root.join("missing");
    for (path, error) in [(&root, "is-a-directory"), (&missing, "no-such-file")] {
        let raw = path.to_string_lossy();
        assert_eq!(read_file(&raw).unwrap_err(), error);
        assert_eq!(duplicate_file(&raw).unwrap_err(), error);
        assert_eq!(delete_file(&raw).unwrap_err(), error);
        // Names are checked before paths, even when both are invalid.
        assert_eq!(rename_file(&raw, "..").unwrap_err(), "invalid-name");
    }
    assert_eq!(
        rename_file(&missing.to_string_lossy(), "renamed").unwrap_err(),
        "no-such-file"
    );
    assert!(root.is_dir(), "refusing a file operation leaves the folder");
    fs::remove_dir_all(root).expect("clean temp dir");
}

#[test]
fn renames_a_folder_without_replacing_existing_entries() {
    let root = temp_dir("folder-rename");
    let raw_root = root.to_string_lossy();
    let folder = create_entry(&raw_root, "project", true).expect("create folder");
    create_entry(&folder, "notes.txt", false).expect("create file inside");
    create_entry(&raw_root, "occupied", true).expect("create another folder");
    assert_eq!(
        rename_file(&folder, "occupied").unwrap_err(),
        "already-exists"
    );
    assert_eq!(
        rename_file(&folder, "../outside").unwrap_err(),
        "invalid-name"
    );
    let renamed = rename_file(&folder, "project.new").expect("rename folder");
    assert!(Path::new(&renamed).join("notes.txt").is_file());
    assert!(!Path::new(&folder).exists());
    assert_eq!(rename_file(&renamed, "project.new").unwrap(), renamed);
    #[cfg(unix)]
    assert_eq!(rename_file("/", "renamed-root").unwrap_err(), "no-parent");
    fs::remove_dir_all(root).expect("clean temp dir");
}

#[test]
#[cfg(unix)]
fn renaming_a_folder_link_leaves_its_target_in_place() {
    let root = temp_dir("folder-link-rename");
    let folder = root.join("project");
    fs::create_dir(&folder).expect("create folder");
    let link = root.join("shortcut");
    std::os::unix::fs::symlink(&folder, &link).expect("link to folder");
    let renamed = rename_file(&link.to_string_lossy(), "renamed").expect("rename link");
    assert!(fs::symlink_metadata(&renamed).unwrap().is_symlink());
    assert_eq!(fs::read_link(&renamed).unwrap(), folder);
    assert!(folder.is_dir());
    assert!(!link.exists());
    fs::remove_dir_all(root).expect("clean temp dir");
}

#[test]
fn deletes_a_folder_and_everything_under_it() {
    let root = temp_dir("folder-deletion");
    let raw_root = root.to_string_lossy();
    let folder = create_entry(&raw_root, "project", true).expect("create folder");
    let kept = create_entry(&raw_root, "beside.txt", false).expect("create a file beside it");
    create_entry(&folder, "notes.txt", false).expect("create a file inside");
    let inside = create_entry(&folder, "inside", true).expect("create a folder inside");
    create_entry(&inside, "deep.txt", false).expect("create a file deeper still");

    // The two are not each other's: a folder is refused by the call that
    // removes a file, and a file by the one that removes a folder.
    assert!(delete_file(&folder).is_err(), "a folder is not a file");
    assert!(delete_folder(&kept).is_err(), "a file is not a folder");
    assert!(Path::new(&folder).is_dir());

    delete_folder(&folder).expect("delete the folder");
    assert!(!Path::new(&folder).exists(), "the tree went with it");
    assert!(Path::new(&kept).is_file(), "and nothing beside it moved");
    assert!(delete_folder(&folder).is_err(), "and it is gone for good");
    fs::remove_dir_all(root).expect("clean temp dir");
}

#[test]
#[cfg(unix)]
fn deleting_a_link_to_a_folder_takes_the_link_and_leaves_the_folder() {
    let root = temp_dir("folder-link-deletion");
    let raw_root = root.to_string_lossy();
    let folder = create_entry(&raw_root, "project", true).expect("create folder");
    let file = create_entry(&folder, "notes.txt", false).expect("create a file inside");
    let link = root.join("shortcut");
    std::os::unix::fs::symlink(&folder, &link).expect("link to the folder");

    delete_folder(&link.to_string_lossy()).expect("delete the link");
    assert!(!link.exists(), "the name is gone");
    assert!(
        Path::new(&file).is_file(),
        "and what it pointed at is where it was"
    );
    fs::remove_dir_all(root).expect("clean temp dir");
}
