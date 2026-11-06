//! What a folder is given when something is dropped on it, both ends of it on
//! this machine. The pair that crosses into a distribution is in `wsl.rs`.

use std::fs;

use super::super::operate::copy_into;
use super::temp_dir;

#[test]
#[cfg(unix)]
fn a_folder_cannot_enter_itself_through_a_symlink() {
    use super::super::operate::move_into;
    let root = temp_dir("copy-alias");
    let source = root.join("project");
    fs::create_dir_all(source.join("inside")).unwrap();
    let alias = root.join("alias");
    std::os::unix::fs::symlink(source.join("inside"), &alias).unwrap();
    let sources = [source.to_string_lossy().into_owned()];
    assert_eq!(
        copy_into(&sources, alias.to_str().unwrap()).unwrap_err(),
        "into-itself"
    );
    assert_eq!(
        move_into(&sources, alias.to_str().unwrap()).unwrap_err(),
        "into-itself"
    );
    assert_eq!(fs::read_dir(source.join("inside")).unwrap().count(), 0);
    fs::remove_dir_all(root).unwrap();
}

#[test]
#[cfg(unix)]
fn local_copies_keep_executable_and_private_permissions() {
    use std::os::unix::fs::PermissionsExt;
    let root = temp_dir("copy-permissions");
    let into = root.join("into");
    fs::create_dir(&into).unwrap();
    for (name, mode) in [("run.sh", 0o751), ("private.txt", 0o600)] {
        let source = root.join(name);
        fs::write(&source, "contents").unwrap();
        fs::set_permissions(&source, fs::Permissions::from_mode(mode)).unwrap();
        let copied = copy_into(
            &[source.to_string_lossy().into_owned()],
            into.to_str().unwrap(),
        )
        .unwrap();
        let duplicate = super::super::operate::duplicate_file(source.to_str().unwrap()).unwrap();
        for path in [copied[0].as_str(), duplicate.as_str()] {
            assert_eq!(
                fs::metadata(path).unwrap().permissions().mode() & 0o777,
                mode
            );
            assert_eq!(fs::read_to_string(path).unwrap(), "contents");
        }
    }
    fs::remove_dir_all(root).unwrap();
}

#[test]
#[cfg(unix)]
fn a_copy_refusal_keeps_a_destination_created_by_another_writer() {
    use std::io::Write;
    let root = temp_dir("copy-target-race");
    let source = root.join("input");
    let into = root.join("into");
    fs::create_dir(&into).unwrap();
    assert!(
        std::process::Command::new("mkfifo")
            .arg(&source)
            .status()
            .unwrap()
            .success()
    );
    let source_name = source.to_string_lossy().into_owned();
    let into_name = into.to_string_lossy().into_owned();
    let copying = std::thread::spawn(move || copy_into(&[source_name], &into_name));
    // Opening the FIFO pauses after choosing the destination, before create_new.
    std::thread::sleep(std::time::Duration::from_millis(200));
    let target = into.join("input");
    fs::write(&target, "another writer's file").unwrap();
    let mut writer = fs::OpenOptions::new().write(true).open(&source).unwrap();
    let _ = writer.write_all(b"source bytes");
    drop(writer);
    assert!(copying.join().unwrap().is_err());
    assert_eq!(
        fs::read_to_string(&target).unwrap(),
        "another writer's file"
    );
    fs::remove_dir_all(root).unwrap();
}

#[test]
#[cfg(unix)]
fn a_failed_tree_copy_removes_only_the_tree_it_created() {
    let root = temp_dir("copy-owned-cleanup");
    let source = root.join("source");
    let into = root.join("into");
    fs::create_dir(&source).unwrap();
    fs::create_dir(&into).unwrap();
    std::os::unix::fs::symlink("missing", source.join("broken")).unwrap();
    fs::write(into.join("keep"), "untouched").unwrap();
    assert!(
        copy_into(
            &[source.to_string_lossy().into_owned()],
            into.to_str().unwrap()
        )
        .is_err()
    );
    assert!(!into.join("source").exists());
    assert_eq!(fs::read_to_string(into.join("keep")).unwrap(), "untouched");
    fs::remove_dir_all(root).unwrap();
}

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
