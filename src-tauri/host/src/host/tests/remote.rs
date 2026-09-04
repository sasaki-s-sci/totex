//! The disk of a distribution, reached from outside it.

use super::{reachable, scratch};

#[test]
fn reads_a_directory_inside_the_distribution() {
    let Some(host) = reachable() else {
        return;
    };
    let dir = scratch(&host, "listing");
    host.exec(
        Some(&dir),
        &[],
        &["sh", "-c", "mkdir sub; printf 12345 > file; ln -s sub link"],
    )
    .expect("a shell");

    let mut children = host.read_dir(&dir).expect("a listing");
    children.sort_by(|left, right| left.name.cmp(&right.name));
    let names: Vec<&str> = children.iter().map(|child| child.name.as_str()).collect();
    assert_eq!(names, vec!["file", "link", "sub"]);

    assert!(children[0].stat.size == 5 && !children[0].stat.is_dir);
    assert!(children[1].stat.is_symlink && children[1].stat.is_dir);
    assert!(children[2].stat.is_dir && !children[2].stat.is_symlink);
    assert!(children[0].stat.modified_ms.unwrap_or(0) > 1_600_000_000_000);
}

#[test]
fn says_what_one_path_is() {
    let Some(host) = reachable() else {
        return;
    };
    let dir = scratch(&host, "stat");
    assert!(host.is_dir(&dir));
    assert!(host.stat(&dir).expect("a stat").is_dir);
    assert!(host.stat(&host.join(&dir, "nothing")).is_none());
}

#[test]
fn reads_the_top_of_a_file_and_says_how_long_it_is() {
    let Some(host) = reachable() else {
        return;
    };
    let dir = scratch(&host, "head");
    host.exec(Some(&dir), &[], &["sh", "-c", "printf 'abcdefghij' > file"])
        .expect("a shell");
    let file = host.join(&dir, "file");

    let (bytes, size) = host.read_head(&file, 4).expect("a reading");
    assert_eq!(bytes, b"abcd");
    assert_eq!(size, 10, "the whole file, not the part that was read");

    assert_eq!(host.read_head(&dir, 10), Err("is-a-directory".to_string()));
}

#[test]
fn writes_a_file_back_only_while_it_is_the_length_it_was() {
    let Some(host) = reachable() else {
        return;
    };
    let dir = scratch(&host, "write");
    host.exec(Some(&dir), &[], &["sh", "-c", "printf 'hello' > file"])
        .expect("a shell");
    let file = host.join(&dir, "file");

    host.write(&file, "it's \"new\"\n", 5).expect("a write");
    let (bytes, _) = host.read_head(&file, 64).expect("a read");
    assert_eq!(String::from_utf8_lossy(&bytes), "it's \"new\"\n");
    // The file is no longer five bytes, so the stale write is refused.
    assert_eq!(host.write(&file, "x", 5), Err("changed".to_string()));
}

/// What the walk over a folder of repositories is built on.
#[test]
fn asks_about_many_directories_at_once() {
    let Some(host) = reachable() else {
        return;
    };
    let dir = scratch(&host, "children");
    host.exec(
        Some(&dir),
        &[],
        &["sh", "-c", "mkdir -p one/deep two; touch one/file"],
    )
    .expect("a shell");

    let dirs = vec![host.join(&dir, "one"), host.join(&dir, "two")];
    let (found, warnings) = host.children(&dirs);
    assert!(warnings.is_empty(), "{warnings:?}");
    assert_eq!(found[&dirs[0]].len(), 2);
    assert!(found[&dirs[1]].is_empty(), "an empty folder still answered");
}

#[test]
fn a_directory_that_will_not_open_is_reported_rather_than_dropped() {
    let Some(host) = reachable() else {
        return;
    };
    let dir = scratch(&host, "missing");
    let (found, warnings) = host.children(&[host.join(&dir, "missing")]);
    assert!(found.values().all(|children| children.is_empty()));
    assert!(!warnings.is_empty(), "nothing was said about it");
}

#[test]
fn the_home_of_the_distribution_is_the_one_inside_it() {
    let Some(host) = reachable() else {
        return;
    };
    let home = host.home().expect("a home");
    assert!(host.native(&home).starts_with('/'));
    assert!(host.is_dir(&home));
}

#[test]
fn puts_bytes_down_inside_the_distribution_and_sweeps_them_up_again() {
    let Some(host) = reachable() else {
        return;
    };
    let dir = scratch(&host, "put");
    let file = host.join(&dir, "shot.png");

    // Bytes rather than text: this is the far half of a copy out of somewhere
    // the distribution cannot be handed, and what comes that way is a file of
    // any kind. A NUL and a high byte are what a `printf` of it would lose.
    let bytes = [0u8, 0x89, b'P', b'N', b'G', 0x1a, 0xff];
    host.write_new(&file, &bytes).expect("put the bytes down");
    assert_eq!(host.read(&file), Ok(bytes.to_vec()));
    assert_eq!(host.stat(&file).expect("a stat").size, bytes.len() as u64);

    // And it replaces nothing: the name was chosen against a listing, and a file
    // that arrived since is one this was never asked to write over.
    assert_eq!(
        host.write_new(&file, b"other"),
        Err("already-exists".to_string())
    );

    let folder = host.join(&dir, "half-copied");
    host.create_dir(&folder).expect("make the folder");
    host.write_new(&host.join(&folder, "inside"), b"one")
        .expect("fill it");
    host.remove_all(&folder);
    assert!(!host.exists(&folder), "the sweep took the folder with it");
}
