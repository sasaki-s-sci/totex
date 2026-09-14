//! The disk of a far machine, reached from outside it — every far machine
//! there is, one after the other.

use std::path::Path;

use super::super::Host;
use super::{reachable, scratch};

#[test]
fn reads_a_directory_on_the_far_machine() {
    for host in reachable() {
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
        assert_eq!(names, vec!["file", "link", "sub"], "{host:?}");

        assert!(children[0].stat.size == 5 && !children[0].stat.is_dir);
        assert!(children[1].stat.is_symlink && children[1].stat.is_dir);
        assert!(children[2].stat.is_dir && !children[2].stat.is_symlink);
        assert!(children[0].stat.modified_ms.unwrap_or(0) > 1_600_000_000_000);
    }
}

#[test]
fn says_what_one_path_is() {
    for host in reachable() {
        let dir = scratch(&host, "stat");
        assert!(host.is_dir(&dir), "{host:?}");
        assert!(host.exists(&dir));
        assert!(host.stat(&dir).expect("a stat").is_dir);
        assert!(host.stat(&host.join(&dir, "nothing")).is_none());
        assert!(!host.exists(&host.join(&dir, "nothing")));
    }
}

#[test]
fn reads_the_top_of_a_file_and_says_how_long_it_is() {
    for host in reachable() {
        let dir = scratch(&host, "head");
        host.exec(Some(&dir), &[], &["sh", "-c", "printf 'abcdefghij' > file"])
            .expect("a shell");
        let file = host.join(&dir, "file");

        let (bytes, size) = host.read_head(&file, 4).expect("a reading");
        assert_eq!(bytes, b"abcd", "{host:?}");
        assert_eq!(size, 10, "the whole file, not the part that was read");
        assert_eq!(host.read(&file), Ok(b"abcdefghij".to_vec()));

        assert_eq!(host.read_head(&dir, 10), Err("is-a-directory".to_string()));
    }
}

#[test]
fn writes_a_file_back_only_while_it_is_the_length_it_was() {
    for host in reachable() {
        let dir = scratch(&host, "write");
        host.exec(Some(&dir), &[], &["sh", "-c", "printf 'hello' > file"])
            .expect("a shell");
        let file = host.join(&dir, "file");

        host.write(&file, "it's \"new\"\n", 5).expect("a write");
        let (bytes, _) = host.read_head(&file, 64).expect("a read");
        assert_eq!(
            String::from_utf8_lossy(&bytes),
            "it's \"new\"\n",
            "{host:?}"
        );
        // The file is no longer five bytes, so the stale write is refused.
        assert_eq!(host.write(&file, "x", 5), Err("changed".to_string()));
    }
}

/// The verbs a row's menu offers, on a far machine: each one a command there.
#[test]
fn makes_renames_and_removes_entries_on_the_far_machine() {
    for host in reachable() {
        let dir = scratch(&host, "verbs");
        let file = host.join(&dir, "it's a file");
        let folder = host.join(&dir, "folder");

        host.create_file(&file).expect("make the file");
        assert_eq!(host.create_file(&file), Err("already-exists".to_string()));
        host.create_dir(&folder).expect("make the folder");
        assert!(host.create_dir(&folder).is_err(), "{host:?}: made twice");

        let moved = host.join(&folder, "moved");
        host.rename(&file, &moved).expect("rename");
        assert!(!host.exists(&file) && host.exists(&moved), "{host:?}");

        let copied = host.join(&folder, "copied");
        host.copy_file(&moved, &copied).expect("copy beside");
        assert!(
            host.copy_file(&moved, &copied).is_err(),
            "not over one there"
        );

        host.remove_file(&copied).expect("remove the copy");
        assert!(!host.exists(&copied));
        host.remove_dir_all(&folder).expect("remove the folder");
        assert!(!host.exists(&folder));
        assert!(host.remove_dir_all(&folder).is_err(), "it is gone for good");
    }
}

#[test]
fn follows_every_link_along_a_path() {
    for host in reachable() {
        let dir = scratch(&host, "resolve");
        host.exec(
            Some(&dir),
            &[],
            &["sh", "-c", "mkdir real; ln -s real alias"],
        )
        .expect("a shell");

        let resolved = host.resolve(&host.join(&dir, "alias")).expect("a path");
        assert_eq!(host.name(&resolved), "real", "{host:?}: {resolved:?}");
        assert_eq!(Host::of(&resolved), host, "and it stays on the machine");
        // `readlink -f` forgives a missing last part, as `realpath -m` would;
        // a missing folder above it is what nothing can answer for.
        assert!(host.resolve(&host.join(&dir, "nothing/deeper")).is_none());
    }
}

/// What the walk over a folder of repositories is built on.
#[test]
fn asks_about_many_directories_at_once() {
    for host in reachable() {
        let dir = scratch(&host, "children");
        host.exec(
            Some(&dir),
            &[],
            &["sh", "-c", "mkdir -p one/deep two; touch one/file"],
        )
        .expect("a shell");

        let dirs = vec![host.join(&dir, "one"), host.join(&dir, "two")];
        let (found, warnings) = host.children(&dirs);
        assert!(warnings.is_empty(), "{host:?}: {warnings:?}");
        assert_eq!(found[&dirs[0]].len(), 2);
        assert!(found[&dirs[1]].is_empty(), "an empty folder still answered");
    }
}

#[test]
fn a_directory_that_will_not_open_is_reported_rather_than_dropped() {
    for host in reachable() {
        let dir = scratch(&host, "missing");
        let (found, warnings) = host.children(&[host.join(&dir, "missing")]);
        assert!(found.values().all(|children| children.is_empty()));
        assert!(!warnings.is_empty(), "{host:?}: nothing was said about it");
    }
}

#[test]
fn the_home_of_the_far_machine_is_the_one_on_it() {
    for host in reachable() {
        let home = host.home().expect("a home");
        assert!(host.native(&home).starts_with('/'), "{host:?}: {home:?}");
        assert_eq!(Host::of(&home), host, "spelled as a path on that machine");
        assert!(host.is_dir(&home));
    }
}

#[test]
fn puts_bytes_down_on_the_far_machine_and_sweeps_them_up_again() {
    for host in reachable() {
        let dir = scratch(&host, "put");
        let file = host.join(&dir, "shot.png");

        // Bytes rather than text: this is the far half of a copy out of
        // somewhere the machine cannot be handed, and what comes that way is a
        // file of any kind. A NUL and a high byte are what a `printf` of it
        // would lose.
        let bytes = [0u8, 0x89, b'P', b'N', b'G', 0x1a, 0xff];
        host.write_new(&file, &bytes).expect("put the bytes down");
        assert_eq!(host.read(&file), Ok(bytes.to_vec()), "{host:?}");
        assert_eq!(host.stat(&file).expect("a stat").size, bytes.len() as u64);

        // And it replaces nothing: the name was chosen against a listing, and
        // a file that arrived since is one this was never asked to write over.
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
}

/// Writing a file has to come back as the folder it was written in.
#[test]
fn says_which_folder_moved_since_the_last_look() {
    assert_eq!(
        Host::Local.watch(false, &[], |_| {}).err(),
        Some("local".to_string()),
        "this machine is watched another way"
    );
    for host in reachable() {
        let dir = scratch(&host, "watch");
        let native = host.native(&dir);

        let (tx, rx) = std::sync::mpsc::channel();
        let poll = host
            .watch(false, std::slice::from_ref(&native), move |moved| {
                let _ = tx.send(moved);
            })
            .expect("a poll");

        // After the first look, so the write is something that happened
        // since. Written again on every tick rather than once: the poll's
        // first `last` is taken when the far shell starts, which may be after
        // a write made straight away.
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(15);
        let mut seen: Vec<String> = Vec::new();
        while std::time::Instant::now() < deadline {
            host.exec(Some(&dir), &[], &["touch", "written"])
                .expect("a shell");
            if let Ok(moved) = rx.recv_timeout(std::time::Duration::from_millis(1_500)) {
                seen = moved;
                if seen
                    .iter()
                    .any(|path| path == &native || path.ends_with("/written"))
                {
                    break;
                }
            }
        }
        drop(poll);

        assert!(
            seen.iter()
                .any(|path| path == &native || path.ends_with("/written")),
            "{host:?}: the write never came back: {seen:?}"
        );
        assert!(
            seen.iter().all(|path| Path::new(path).is_absolute()),
            "reported as the far machine spells them: {seen:?}"
        );
    }
}
