//! The same reading and writing, of a path inside a distribution.
//!
//! Skipped where there is no WSL to reach, and the skip is declared: off
//! Windows these carry `#[ignore]` so the run says they did not happen. See
//! `crate::wsl::tests` for the whole of why.

use std::path::Path;

use super::super::operate::{copy_into, delete_folder};
use super::super::read::{read_directory, read_file_head, write_file};
use super::wsl_dir;
use crate::host::Host;

#[test]
#[cfg_attr(not(windows), ignore = "reaches into WSL, which is Windows only")]
fn a_folder_inside_a_distribution_is_listed_from_inside_it() {
    let Some(dir) = wsl_dir("listing") else {
        eprintln!("skipped: no WSL distribution to reach");
        return;
    };
    let host = Host::of(Path::new(&dir));
    host.exec(
        Some(Path::new(&dir)),
        &[],
        &[
            "sh",
            "-c",
            "mkdir Beta alpha; printf hello > notes.txt; printf shh > .secret",
        ],
    )
    .expect("a shell");

    let listing = read_directory(&dir, false).expect("a listing");
    let names: Vec<&str> = listing.entries.iter().map(|e| e.name.as_str()).collect();
    assert_eq!(names, ["alpha", "Beta", "notes.txt"]);
    assert_eq!(listing.entries[2].size, Some(5));
    assert_eq!(listing.name, "listing");
    assert!(listing.distro.is_some(), "the row says which distribution");
    // The paths it hands back are the ones it takes: they go straight back over
    // IPC as the next directory to open.
    assert!(listing.entries[0].path.starts_with(r"\\wsl.localhost\"));
    assert!(read_directory(&listing.entries[0].path, false).is_ok());
    assert!(
        listing
            .parent
            .as_deref()
            .is_some_and(|parent| parent.ends_with(r"\tmp\totex-browse-test")),
        "{:?}",
        listing.parent
    );

    let with_hidden = read_directory(&dir, true).expect("a listing");
    assert_eq!(with_hidden.entries.len(), 4);
}

#[test]
#[cfg_attr(not(windows), ignore = "reaches into WSL, which is Windows only")]
fn a_climbing_path_inside_a_distribution_is_folded_before_it_is_read() {
    let Some(dir) = wsl_dir("climb") else {
        eprintln!("skipped: no WSL distribution to reach");
        return;
    };
    let listing = read_directory(&format!(r"{dir}\one\.."), false).expect("a listing");
    assert_eq!(listing.path, dir);
}

#[test]
#[cfg_attr(not(windows), ignore = "reaches into WSL, which is Windows only")]
fn a_card_reads_and_writes_a_file_inside_the_distribution() {
    let Some(dir) = wsl_dir("card") else {
        eprintln!("skipped: no WSL distribution to reach");
        return;
    };
    let host = Host::of(Path::new(&dir));
    host.exec(
        Some(Path::new(&dir)),
        &[],
        &["sh", "-c", "printf 'one\ntwo\n' > notes.txt"],
    )
    .expect("a shell");
    let file = format!(r"{dir}\notes.txt");

    let head = read_file_head(&file).expect("a reading");
    assert_eq!(head.name, "notes.txt");
    assert_eq!(head.text.as_deref(), Some("one\ntwo\n"));
    assert!(!head.truncated);

    assert_eq!(write_file(&file, "one\ntwo\nthree\n", head.size), Ok(14));
    assert_eq!(
        read_file_head(&file).expect("a reading").text.as_deref(),
        Some("one\ntwo\nthree\n")
    );
    // The reading the card holds is stale now, so its write is refused.
    assert!(write_file(&file, "mine\n", head.size).is_err());
    assert!(read_file_head(&dir).is_err(), "a folder is not a card");
}

#[test]
#[cfg_attr(not(windows), ignore = "reaches into WSL, which is Windows only")]
fn a_drop_crosses_between_this_machine_and_the_distribution() {
    let Some(dir) = wsl_dir("drop") else {
        eprintln!("skipped: no WSL distribution to reach");
        return;
    };
    let root = super::temp_dir("drop-across");
    let source = root.join("shot.png");
    std::fs::write(&source, b"pixels").expect("fill a file");

    // Out of this machine and into the distribution, which is the drag out of
    // Explorer onto a folder inside one.
    let landed = copy_into(&[source.to_string_lossy().into_owned()], &dir).expect("the drop lands");
    assert_eq!(landed.len(), 1);
    assert!(landed[0].starts_with(r"\\wsl.localhost\"), "{}", landed[0]);
    let host = Host::of(Path::new(&dir));
    assert_eq!(
        host.read(Path::new(&landed[0])),
        Ok(b"pixels".to_vec()),
        "the bytes arrived whole"
    );
    assert!(source.is_file(), "the file dropped is still there");

    // And back the other way, onto a folder on this machine.
    let back = root.join("kept");
    std::fs::create_dir(&back).expect("make the folder");
    let returned = copy_into(&[landed[0].clone()], &back.to_string_lossy()).expect("it comes back");
    assert_eq!(
        std::fs::read(&returned[0]).ok(),
        Some(b"pixels".to_vec()),
        "and back again whole"
    );

    // The second of the same name is told from the first, on either side.
    let twice = copy_into(&[source.to_string_lossy().into_owned()], &dir).expect("the drop lands");
    assert!(twice[0].ends_with("shot copy.png"), "{}", twice[0]);
    std::fs::remove_dir_all(root).expect("clean temp dir");
}

#[test]
#[cfg_attr(not(windows), ignore = "reaches into WSL, which is Windows only")]
fn a_folder_the_distribution_copies_for_itself_keeps_its_links_as_links() {
    let Some(dir) = wsl_dir("drop-links") else {
        eprintln!("skipped: no WSL distribution to reach");
        return;
    };
    let host = Host::of(Path::new(&dir));
    host.exec(
        Some(Path::new(&dir)),
        &[],
        &[
            "sh",
            "-c",
            "mkdir assets; printf one > assets/read.me; \
             ln -s \"$PWD/assets\" assets/itself; ln -s \"$PWD/assets/read.me\" assets/again",
        ],
    )
    .expect("a shell");

    // Across to this machine, which the distribution can name, so `cp` makes
    // the whole copy — links and all. The walk is the other answer, and
    // `download`'s own test is what pins that one; see this module's `copy`.
    let root = super::temp_dir("drop-links");
    let landed = copy_into(&[format!(r"{dir}\assets")], &root.to_string_lossy())
        .expect("the folder comes across");
    let inside = Path::new(&landed[0]);
    assert_eq!(
        std::fs::read(inside.join("read.me")).ok(),
        Some(b"one".to_vec())
    );
    // A link to the folder holding it would have stopped the walk. It does not
    // stop `cp`, and what arrives is the link.
    assert!(
        std::fs::symlink_metadata(inside.join("itself"))
            .expect("the link is there")
            .is_symlink(),
        "a link to a folder comes across as a link"
    );
    assert!(
        std::fs::symlink_metadata(inside.join("again"))
            .expect("the link is there")
            .is_symlink(),
        "and so does a link to a file"
    );
    std::fs::remove_dir_all(root).expect("clean temp dir");
}

#[test]
#[cfg_attr(not(windows), ignore = "reaches into WSL, which is Windows only")]
fn a_folder_inside_a_distribution_goes_with_everything_under_it() {
    let Some(dir) = wsl_dir("folder-deletion") else {
        eprintln!("skipped: no WSL distribution to reach");
        return;
    };
    let host = Host::of(Path::new(&dir));
    host.exec(
        Some(Path::new(&dir)),
        &[],
        &[
            "sh",
            "-c",
            "mkdir -p project/inside; printf one > project/notes.txt; \
             printf two > project/inside/deep.txt; printf three > beside.txt; \
             ln -s \"$PWD/project\" shortcut",
        ],
    )
    .expect("a shell");
    let project = format!(r"{dir}\project");
    let beside = format!(r"{dir}\beside.txt");
    let shortcut = format!(r"{dir}\shortcut");

    // The link first, which is a name and nothing else: it goes, and the folder
    // it pointed at is still there to be deleted on its own.
    delete_folder(&shortcut).expect("delete the link");
    assert!(
        host.stat(Path::new(&shortcut)).is_none(),
        "the name is gone"
    );
    assert!(host.is_dir(Path::new(&project)), "and the folder is not");

    delete_folder(&project).expect("delete the folder");
    assert!(
        host.stat(Path::new(&project)).is_none(),
        "the tree went with it"
    );
    assert_eq!(
        host.read(Path::new(&beside)),
        Ok(b"three".to_vec()),
        "and nothing beside it moved"
    );
    assert!(delete_folder(&project).is_err(), "it is gone for good");
    assert!(delete_folder(&beside).is_err(), "a file is not a folder");
}
