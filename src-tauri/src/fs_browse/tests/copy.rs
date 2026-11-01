//! What a folder is given when something is dropped on it, both ends of it on
//! this machine. The pair that crosses into a distribution is in `wsl.rs`.

use std::fs;

use super::super::operate::copy_into;
use super::temp_dir;

#[test]
fn a_drop_lands_in_the_folder_without_replacing_what_is_there() {
    let root = temp_dir("drop-into");
    let source = root.join("shot.png");
    fs::write(&source, b"pixels").expect("fill a file");
    let into = root.join("project");
    fs::create_dir(&into).expect("make the folder");
    let dropped = vec![source.to_string_lossy().into_owned()];
    let raw_into = into.to_string_lossy().into_owned();

    let landed = copy_into(&dropped, &raw_into).expect("the drop lands");
    assert_eq!(landed.len(), 1);
    assert!(landed[0].ends_with("shot.png"), "{}", landed[0]);
    assert_eq!(
        fs::read(into.join("shot.png")).ok(),
        Some(b"pixels".to_vec())
    );
    // A copy and only ever a copy: what was dropped stays where it was.
    assert!(source.is_file(), "the file dropped is still there");

    // And the same one again, which is the name the folder already has: it is
    // told from what is there rather than put over it.
    let again = copy_into(&dropped, &raw_into).expect("the second drop lands");
    assert!(again[0].ends_with("shot copy.png"), "{}", again[0]);
    fs::remove_dir_all(root).expect("clean temp dir");
}

#[test]
fn a_whole_folder_comes_with_the_drop() {
    let root = temp_dir("drop-folder");
    let source = root.join("assets");
    fs::create_dir_all(source.join("icons")).expect("make the folder");
    fs::write(source.join("read.me"), b"one\n").expect("fill a file");
    fs::write(source.join("icons").join("mark.svg"), b"two\n").expect("fill a deeper one");
    let into = root.join("project");
    fs::create_dir(&into).expect("make the folder");

    copy_into(
        &[source.to_string_lossy().into_owned()],
        &into.to_string_lossy(),
    )
    .expect("the drop lands");
    assert_eq!(
        fs::read(into.join("assets").join("icons").join("mark.svg")).ok(),
        Some(b"two\n".to_vec())
    );
    fs::remove_dir_all(root).expect("clean temp dir");
}

#[test]
fn a_folder_dropped_on_something_it_holds_is_refused() {
    let root = temp_dir("drop-into-itself");
    let source = root.join("project");
    let inside = source.join("inside");
    fs::create_dir_all(&inside).expect("make the folders");

    // Onto itself, and onto a folder under it: the copy would be inside what is
    // being copied either way.
    let dropped = [source.to_string_lossy().into_owned()];
    assert_eq!(
        copy_into(&dropped, &source.to_string_lossy()),
        Err("into-itself".to_string())
    );
    assert_eq!(
        copy_into(&dropped, &inside.to_string_lossy()),
        Err("into-itself".to_string())
    );
    // A file out of that folder is not the folder, and goes in.
    fs::write(source.join("notes.txt"), b"one\n").expect("fill a file");
    copy_into(
        &[source.join("notes.txt").to_string_lossy().into_owned()],
        &inside.to_string_lossy(),
    )
    .expect("the drop lands");
    fs::remove_dir_all(root).expect("clean temp dir");
}

#[test]
fn a_drop_on_something_that_is_not_a_folder_is_refused() {
    let root = temp_dir("drop-nowhere");
    let file = root.join("notes.txt");
    fs::write(&file, b"one\n").expect("fill a file");

    let dropped = [file.to_string_lossy().into_owned()];
    assert_eq!(
        copy_into(&dropped, &file.to_string_lossy()),
        Err("no-such-folder".to_string())
    );
    assert_eq!(
        copy_into(&dropped, &root.join("gone").to_string_lossy()),
        Err("no-such-folder".to_string())
    );
    // And a drop of something that is not there, onto a folder that is.
    assert_eq!(
        copy_into(
            &[root.join("gone.txt").to_string_lossy().into_owned()],
            &root.to_string_lossy()
        ),
        Err("no-such-file".to_string())
    );
    fs::remove_dir_all(root).expect("clean temp dir");
}
