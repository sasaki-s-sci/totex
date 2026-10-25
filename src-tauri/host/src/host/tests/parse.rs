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

#[test]
fn local_walk_keeps_entry_kinds_and_full_listing_metadata() {
    let unique = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("clock")
        .as_nanos();
    let dir = std::env::temp_dir().join(format!("totex-local-listing-{unique}"));
    std::fs::create_dir(&dir).expect("scratch directory");
    std::fs::create_dir(dir.join("folder")).expect("child directory");
    std::fs::write(dir.join("file"), "12345").expect("file");
    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(dir.join("folder"), dir.join("link")).expect("directory link");
        std::os::unix::fs::symlink(dir.join("missing"), dir.join("broken")).expect("broken link");
    }

    let host = super::super::Host::Local;
    let missing = dir.join("missing");
    let (found, warnings) = host.children(&[dir.clone(), missing.clone()]);
    assert_eq!(warnings.len(), 1);
    assert!(!found.contains_key(&missing));
    let full = host.read_dir(&dir).expect("full listing");
    assert_eq!(found[&dir].len(), full.len());
    for child in &full {
        let walked = found[&dir]
            .iter()
            .find(|one| one.name == child.name)
            .expect("same entry");
        assert_eq!(walked.stat.is_dir, child.stat.is_dir, "{}", child.name);
        assert_eq!(
            walked.stat.is_symlink, child.stat.is_symlink,
            "{}",
            child.name
        );
    }
    let file = full
        .iter()
        .find(|child| child.name == "file")
        .expect("file metadata");
    assert_eq!(file.stat.size, 5);
    assert!(file.stat.modified_ms.is_some());
    std::fs::remove_dir_all(dir).expect("remove scratch directory");
}
