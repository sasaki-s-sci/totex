//! The same reading and writing, of a path on a far machine — every far
//! machine there is to reach, one after the other. On Linux that is always the
//! fake ssh host; see `crate::host::tests`.

use std::path::Path;

use super::super::operate::{copy_into, delete_folder};
use super::super::read::{read_directory, read_file_head, write_file};
use super::remote_dirs;
use crate::host::Host;

#[test]
fn a_folder_on_a_far_machine_is_listed_from_there() {
    for (host, dir) in remote_dirs("listing") {
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
        assert_eq!(names, ["alpha", "Beta", "notes.txt"], "{host:?}");
        assert_eq!(listing.entries[2].size, Some(5));
        assert_eq!(listing.name, "browse-listing");
        assert_eq!(
            listing.distro.as_deref(),
            host.remote_name(),
            "the row says which machine"
        );
        // The paths it hands back are the ones it takes: they go straight back
        // over IPC as the next directory to open.
        assert_eq!(Host::of_str(&listing.entries[0].path), host);
        assert!(read_directory(&listing.entries[0].path, false).is_ok());
        assert_eq!(
            listing.parent.as_deref().map(Host::of_str),
            Some(host.clone()),
            "{:?}",
            listing.parent
        );
        assert!(
            listing
                .parent
                .as_deref()
                .is_some_and(|parent| parent.ends_with(host.remote_name().unwrap_or(""))),
            "{:?}",
            listing.parent
        );

        let with_hidden = read_directory(&dir, true).expect("a listing");
        assert_eq!(with_hidden.entries.len(), 4);
    }
}

#[test]
fn a_climbing_path_on_a_far_machine_is_folded_before_it_is_read() {
    for (host, dir) in remote_dirs("climb") {
        let separator = if matches!(host, Host::Wsl(_)) {
            '\\'
        } else {
            '/'
        };
        let listing =
            read_directory(&format!("{dir}{separator}one{separator}.."), false).expect("a listing");
        assert_eq!(listing.path, dir, "{host:?}");
    }
}

#[test]
fn the_home_row_of_a_far_machine_opens_the_folder_of_the_account_it_runs_as() {
    for host in crate::host::tests::reachable() {
        // The path the rail offers names no account — nothing on this side
        // knows one — and what it lands in is the home of whichever account
        // the far machine runs as.
        let offered = host.canonical("/~");
        let listing = read_directory(&offered.to_string_lossy(), false).expect("a listing");
        let home = host.home().expect("a home");
        assert_eq!(Path::new(&listing.path), home, "{host:?}");
        assert!(
            !listing.path.contains('~'),
            "the pane moves to where that is: {}",
            listing.path
        );
    }
}

#[test]
fn a_card_reads_and_writes_a_file_on_the_far_machine() {
    for (host, dir) in remote_dirs("card") {
        host.exec(
            Some(Path::new(&dir)),
            &[],
            &["sh", "-c", "printf 'one\ntwo\n' > notes.txt"],
        )
        .expect("a shell");
        let file = host.join(Path::new(&dir), "notes.txt");
        let file = file.to_string_lossy();

        let head = read_file_head(&file).expect("a reading");
        assert_eq!(head.name, "notes.txt", "{host:?}");
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
}

#[test]
fn a_drop_crosses_between_this_machine_and_the_far_one() {
    for (host, dir) in remote_dirs("drop") {
        let root = super::temp_dir(&format!("drop-across-{}", host.remote_name().unwrap_or("")));
        let source = root.join("shot.png");
        std::fs::write(&source, b"pixels").expect("fill a file");

        // Out of this machine and onto the far one, which is the drag out of
        // Explorer onto a folder there.
        let landed =
            copy_into(&[source.to_string_lossy().into_owned()], &dir).expect("the drop lands");
        assert_eq!(landed.len(), 1);
        assert_eq!(Host::of_str(&landed[0]), host, "{}", landed[0]);
        assert_eq!(
            host.read(Path::new(&landed[0])),
            Ok(b"pixels".to_vec()),
            "the bytes arrived whole"
        );
        assert!(source.is_file(), "the file dropped is still there");

        // And back the other way, onto a folder on this machine.
        let back = root.join("kept");
        std::fs::create_dir(&back).expect("make the folder");
        let returned =
            copy_into(&[landed[0].clone()], &back.to_string_lossy()).expect("it comes back");
        assert_eq!(
            std::fs::read(&returned[0]).ok(),
            Some(b"pixels".to_vec()),
            "and back again whole"
        );

        // The second of the same name is told from the first, on either side.
        let twice =
            copy_into(&[source.to_string_lossy().into_owned()], &dir).expect("the drop lands");
        assert!(twice[0].ends_with("shot copy.png"), "{}", twice[0]);
        std::fs::remove_dir_all(root).expect("clean temp dir");
    }
}

/// A folder dropped somewhere on the same far machine is that machine's own
/// copy to make, links and all; one crossing to this machine is `cp`'s on a
/// distribution — which can name this machine's disks — and the walk from an
/// ssh host, which cannot. The walk's own answer about links is pinned by
/// `download`'s test.
#[test]
fn a_folder_the_far_machine_copies_for_itself_keeps_its_links_as_links() {
    for (host, dir) in remote_dirs("drop-links") {
        host.exec(
            Some(Path::new(&dir)),
            &[],
            &[
                "sh",
                "-c",
                "mkdir assets into; printf one > assets/read.me; \
                 ln -s \"$PWD/assets\" assets/itself; ln -s \"$PWD/assets/read.me\" assets/again",
            ],
        )
        .expect("a shell");
        let assets = host.join(Path::new(&dir), "assets");
        let into = host.join(Path::new(&dir), "into");

        let landed = copy_into(
            &[assets.to_string_lossy().into_owned()],
            &into.to_string_lossy(),
        )
        .expect("the folder goes across");
        let inside = Path::new(&landed[0]);
        assert_eq!(
            host.read(&host.join(inside, "read.me")),
            Ok(b"one".to_vec()),
            "{host:?}"
        );
        // A link to the folder holding it would have stopped the walk. It does
        // not stop `cp`, and what arrives is the link.
        for link in ["itself", "again"] {
            let stat = host
                .stat(&host.join(inside, link))
                .expect("the link is there");
            assert!(stat.is_symlink, "{host:?}: {link} came across as a link");
        }

        // Onto this machine: `cp` again for a distribution, which names this
        // machine's disks, so the links arrive as links here too.
        if let Host::Wsl(_) = host {
            let root = super::temp_dir("drop-links-cp");
            let landed = copy_into(
                &[assets.to_string_lossy().into_owned()],
                &root.to_string_lossy(),
            )
            .expect("the folder comes across");
            let inside = Path::new(&landed[0]);
            assert_eq!(
                std::fs::read(inside.join("read.me")).ok(),
                Some(b"one".to_vec())
            );
            for link in ["itself", "again"] {
                assert!(
                    std::fs::symlink_metadata(inside.join(link))
                        .expect("the link is there")
                        .is_symlink(),
                    "{link} comes across as a link"
                );
            }
            std::fs::remove_dir_all(root).expect("clean temp dir");
        }

        // Onto this machine: the walk, for an ssh host, which follows a link
        // to a file and leaves a link to a folder behind.
        if let Host::Ssh(_) = host {
            let root = super::temp_dir("drop-links-walk");
            let landed = copy_into(
                &[assets.to_string_lossy().into_owned()],
                &root.to_string_lossy(),
            )
            .expect("the folder comes across");
            let inside = Path::new(&landed[0]);
            assert_eq!(
                std::fs::read(inside.join("again")).ok(),
                Some(b"one".to_vec()),
                "a link to a file arrives as the file"
            );
            assert!(
                !inside.join("itself").exists(),
                "a link to a folder is left behind"
            );
            std::fs::remove_dir_all(root).expect("clean temp dir");
        }
    }
}

#[test]
fn a_folder_on_a_far_machine_goes_with_everything_under_it() {
    for (host, dir) in remote_dirs("folder-deletion") {
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
        let project = host.join(Path::new(&dir), "project");
        let beside = host.join(Path::new(&dir), "beside.txt");
        let shortcut = host.join(Path::new(&dir), "shortcut");

        // The link first, which is a name and nothing else: it goes, and the
        // folder it pointed at is still there to be deleted on its own.
        delete_folder(&shortcut.to_string_lossy()).expect("delete the link");
        assert!(host.stat(&shortcut).is_none(), "{host:?}: the name is gone");
        assert!(host.is_dir(&project), "and the folder is not");

        delete_folder(&project.to_string_lossy()).expect("delete the folder");
        assert!(host.stat(&project).is_none(), "the tree went with it");
        assert_eq!(
            host.read(&beside),
            Ok(b"three".to_vec()),
            "and nothing beside it moved"
        );
        assert!(
            delete_folder(&project.to_string_lossy()).is_err(),
            "it is gone for good"
        );
        assert!(
            delete_folder(&beside.to_string_lossy()).is_err(),
            "a file is not a folder"
        );
    }
}
