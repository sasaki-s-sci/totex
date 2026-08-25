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
