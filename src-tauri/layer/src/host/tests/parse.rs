//! Reading what `find` printed.

use super::super::parse::{parse_children, parse_stat};

#[test]
fn reads_what_find_prints_about_one_path() {
    let stat = parse_stat("d\td\t4096\t1690000000.5").expect("a stat");
    assert!(stat.is_dir && !stat.is_symlink);
    assert_eq!(stat.modified_ms, Some(1_690_000_000_500));

    let link = parse_stat("l\td\t12\t1690000000").expect("a stat");
    assert!(link.is_dir && link.is_symlink, "a link to a folder is one");

    let broken = parse_stat("l\tN\t12\t1690000000").expect("a stat");
    assert!(!broken.is_dir && broken.is_symlink);
}

#[test]
fn reads_a_listing_back_into_the_directories_it_came_from() {
    let mut raw = Vec::new();
    raw.extend_from_slice(b"d\td\t4096\t1690000000\t/home/a/repo\0");
    raw.extend_from_slice(b"f\tf\t12\t1690000001\t/home/a/notes.txt\0");
    raw.extend_from_slice(b"f\tf\t3\t1690000002\t/srv/thing\0");
    let found = parse_children(&raw);
    assert_eq!(found.len(), 3);
    assert_eq!(found[0].0, "/home/a");
    assert_eq!(found[0].1.name, "repo");
    assert!(found[0].1.stat.is_dir);
    assert_eq!(found[2].0, "/srv");
}

#[test]
fn a_name_may_hold_anything_but_a_slash() {
    let raw = b"f\tf\t1\t1690000000\t/home/a/one\ttwo\nthree\0";
    let found = parse_children(raw);
    assert_eq!(found[0].1.name, "one\ttwo\nthree");
    assert_eq!(found[0].0, "/home/a");
}

#[test]
fn a_child_of_the_root_belongs_to_the_root() {
    let found = parse_children(b"d\td\t4096\t1690000000\t/srv\0");
    assert_eq!(found[0].0, "/");
    assert_eq!(found[0].1.name, "srv");
}
