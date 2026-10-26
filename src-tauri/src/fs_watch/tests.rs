//! Which directories a set of open folders comes to, split by machine.

use super::*;

#[test]
fn reports_the_watched_directory_a_file_belongs_to() {
    let watched: BTreeSet<PathBuf> = [PathBuf::from("/tmp/demo")].into_iter().collect();
    let paths = [PathBuf::from("/tmp/demo/alpha.txt")];
    assert_eq!(directories(paths.iter(), &watched), vec!["/tmp/demo"]);
}

#[test]
fn reports_a_watched_directory_that_moved_itself() {
    let watched: BTreeSet<PathBuf> = [PathBuf::from("/tmp/demo/alpha")].into_iter().collect();
    let paths = [PathBuf::from("/tmp/demo/alpha")];
    assert_eq!(directories(paths.iter(), &watched), vec!["/tmp/demo/alpha"]);
}

#[test]
fn ignores_paths_no_open_directory_is_showing() {
    let watched: BTreeSet<PathBuf> = [PathBuf::from("/tmp/demo")].into_iter().collect();
    let paths = [PathBuf::from("/tmp/other/beta.txt")];
    assert!(directories(paths.iter(), &watched).is_empty());
}

#[test]
fn names_each_directory_once_however_many_files_moved() {
    let watched: BTreeSet<PathBuf> = [PathBuf::from("/tmp/demo")].into_iter().collect();
    let paths = [
        PathBuf::from("/tmp/demo/one.txt"),
        PathBuf::from("/tmp/demo/two.txt"),
    ];
    assert_eq!(directories(paths.iter(), &watched), vec!["/tmp/demo"]);
}

/// A file inside a distribution belongs to the open directory holding it,
/// which is spelled the way the tree spells it and not the way the poll
/// that found it does.
#[test]
fn a_path_inside_a_distribution_finds_its_open_directory() {
    let open = PathBuf::from(r"\\wsl.localhost\Ubuntu\home\a");
    let watched: BTreeSet<PathBuf> = [open.clone()].into_iter().collect();
    let paths = [PathBuf::from(r"\\wsl.localhost\Ubuntu\home\a\notes.txt")];
    assert_eq!(
        directories(paths.iter(), &watched),
        vec![open.to_string_lossy().into_owned()]
    );
}

#[test]
fn reading_is_not_a_filesystem_change() {
    use notify_debouncer_full::notify::event::{CreateKind, ModifyKind, RemoveKind};
    for access in [
        AccessKind::Read,
        AccessKind::Open(AccessMode::Any),
        AccessKind::Open(AccessMode::Read),
        AccessKind::Close(AccessMode::Read),
    ] {
        assert!(!changes_contents(EventKind::Access(access)));
    }
    for kind in [
        EventKind::Create(CreateKind::File),
        EventKind::Modify(ModifyKind::Any),
        EventKind::Remove(RemoveKind::File),
        EventKind::Access(AccessKind::Close(AccessMode::Write)),
        EventKind::Any,
    ] {
        assert!(changes_contents(kind));
    }
}

#[cfg(target_os = "linux")]
#[test]
fn directory_reads_do_not_feed_back_but_writes_still_notify() {
    let directory = std::env::temp_dir().join(format!("totex-watch-read-{}", std::process::id()));
    std::fs::create_dir_all(&directory).unwrap();
    let (sender, receiver) = std::sync::mpsc::channel();
    let mut watcher = new_debouncer(DEBOUNCE, None, move |result: DebounceEventResult| {
        let kinds = result
            .unwrap()
            .iter()
            .map(|event| event.kind)
            .collect::<Vec<_>>();
        let _ = sender.send(kinds);
    })
    .unwrap();
    watcher
        .watch(&directory, RecursiveMode::NonRecursive)
        .unwrap();
    let _ = std::fs::read_dir(&directory).unwrap().count();
    let read = receiver
        .recv_timeout(Duration::from_secs(2))
        .expect("directory access notification");
    assert!(!read.into_iter().any(changes_contents));

    std::fs::write(directory.join("written.txt"), "changed").unwrap();
    let deadline = std::time::Instant::now() + Duration::from_secs(2);
    let changed = loop {
        let remaining = deadline.saturating_duration_since(std::time::Instant::now());
        match receiver.recv_timeout(remaining) {
            Ok(kinds) if kinds.iter().copied().any(changes_contents) => break true,
            Ok(_) => continue,
            Err(_) => break false,
        }
    };
    drop(watcher);
    std::fs::remove_dir_all(&directory).unwrap();
    assert!(changed, "real writes must refresh the folder");
}
