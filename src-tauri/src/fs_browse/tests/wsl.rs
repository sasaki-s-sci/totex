//! The same reading and writing, of a path inside a distribution. Skipped where
//! there is no WSL to reach.

use std::path::Path;

use super::super::read::{read_directory, read_file_head, write_file};
use super::wsl_dir;
use crate::host::Host;

#[test]
fn a_folder_inside_a_distribution_is_listed_from_inside_it() {
    let Some(dir) = wsl_dir("listing") else {
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
fn a_climbing_path_inside_a_distribution_is_folded_before_it_is_read() {
    let Some(dir) = wsl_dir("climb") else {
        return;
    };
    let listing = read_directory(&format!(r"{dir}\one\.."), false).expect("a listing");
    assert_eq!(listing.path, dir);
}

#[test]
fn a_card_reads_and_writes_a_file_inside_the_distribution() {
    let Some(dir) = wsl_dir("card") else {
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
