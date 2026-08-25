//! What the folder column reads out of a repository it is drawing.

use std::path::PathBuf;

use super::*;
// One temp directory that cleans itself up, and one git isolated from
// whatever config the machine has: the same fixture the rest of the git
// suite is built on.
use crate::git::tests::{TempDir, git};

/// A repository holding one file at the top and two under a folder.
fn repository(temp: &TempDir) -> PathBuf {
    let path = temp.path().join("repo");
    std::fs::create_dir_all(path.join("sub/deep")).expect("create dirs");
    git(&path, &["init", "--quiet", "-b", "main"]);
    git(&path, &["config", "user.name", "totex"]);
    git(&path, &["config", "user.email", "totex@example.invalid"]);
    for (name, contents) in [
        ("top.txt", "top"),
        ("sub/inside.txt", "inside"),
        ("sub/deep/down.txt", "down"),
    ] {
        std::fs::write(path.join(name), contents).expect("write file");
    }
    git(&path, &["add", "."]);
    git(&path, &["commit", "-m", "first"]);
    path
}

fn answer(dir: &Path) -> Answer {
    read_answer(dir).expect("an answer")
}

fn changes(dir: &Path) -> HashMap<String, Change> {
    answer(dir).changed
}

#[test]
fn a_file_is_named_by_what_became_of_it() {
    let temp = TempDir::new("changes");
    let repo = repository(&temp);
    assert!(changes(&repo).is_empty());

    std::fs::write(repo.join("top.txt"), "rewritten").expect("write");
    std::fs::write(repo.join("arrived.txt"), "new").expect("write");
    assert_eq!(changes(&repo).get("top.txt"), Some(&Change::Modified));
    assert_eq!(changes(&repo).get("arrived.txt"), Some(&Change::Added));

    // Staged or not is the same fact to anyone looking at the folder.
    git(&repo, &["add", "arrived.txt"]);
    assert_eq!(changes(&repo).get("arrived.txt"), Some(&Change::Added));
}

/// A file that has gone has no row of its own, so what it says is said by
/// the folder it was in.
#[test]
fn a_folder_carries_what_is_underneath_it() {
    let temp = TempDir::new("changes-folder");
    let repo = repository(&temp);

    std::fs::write(repo.join("sub/deep/down.txt"), "rewritten").expect("write");
    assert_eq!(changes(&repo).get("sub"), Some(&Change::Modified));
    // And the level showing that folder answers for its own rows only.
    assert_eq!(
        changes(&repo.join("sub")).get("deep"),
        Some(&Change::Modified)
    );

    std::fs::remove_file(repo.join("sub/inside.txt")).expect("remove");
    assert_eq!(
        changes(&repo.join("sub")).get("inside.txt"),
        Some(&Change::Deleted)
    );

    // A folder that has gained one file and lost another has been
    // rewritten, whatever either file did.
    assert_eq!(changes(&repo).get("sub"), Some(&Change::Modified));
}

/// A folder git has never heard of is a folder that arrived whole: the
/// files under it are listed one by one, and the row above them is green
/// rather than a colour none of them is.
#[test]
fn a_new_folder_arrives_as_one_thing() {
    let temp = TempDir::new("changes-new");
    let repo = repository(&temp);

    std::fs::create_dir_all(repo.join("fresh/deeper")).expect("create dir");
    std::fs::write(repo.join("fresh/one.txt"), "one").expect("write");
    std::fs::write(repo.join("fresh/deeper/two.txt"), "two").expect("write");

    assert_eq!(changes(&repo).get("fresh"), Some(&Change::Added));
    assert_eq!(
        changes(&repo.join("fresh")).get("deeper"),
        Some(&Change::Added)
    );
}

/// The ignore list is read by the row that carries it: a folder on it says
/// so once, for everything under it, and a file under a folder that is not
/// on it says nothing about that folder.
#[test]
fn a_row_on_the_ignore_list_is_named_as_one() {
    let temp = TempDir::new("changes-ignored");
    let repo = repository(&temp);
    std::fs::write(repo.join(".gitignore"), "node_modules/\n*.log\n").expect("write");
    std::fs::create_dir_all(repo.join("node_modules/pkg")).expect("create dirs");
    std::fs::write(repo.join("node_modules/pkg/index.js"), "there").expect("write");
    std::fs::write(repo.join("run.log"), "noise").expect("write");
    std::fs::write(repo.join("sub/deep/run.log"), "noise").expect("write");

    let top = answer(&repo);
    assert!(top.ignored.contains(&"node_modules".to_string()));
    assert!(top.ignored.contains(&"run.log".to_string()));
    // The folder leading to an ignored file is a folder like any other.
    assert!(!top.ignored.contains(&"sub".to_string()));
    assert!(!top.all_ignored);
    // It is the level showing that file which names it.
    let deep = answer(&repo.join("sub").join("deep"));
    assert!(deep.ignored.contains(&"run.log".to_string()));

    // A folder on the list is one fact at every depth inside it, and never
    // a listing of what it holds.
    for inside in [repo.join("node_modules"), repo.join("node_modules/pkg")] {
        let held = answer(&inside);
        assert!(held.all_ignored, "{inside:?} is inside an ignored folder");
        assert!(held.ignored.is_empty());
        // And nothing in one arrives: it is not a file git is watching.
        assert!(held.changed.is_empty());
    }
}

#[test]
fn a_rename_is_a_name_that_left_and_a_name_that_arrived() {
    let mut changes = HashMap::new();
    walk_name_status("R100\0was.txt\0is.txt\0", |letter, from, to| {
        assert_eq!(letter, 'R');
        note(&mut changes, from, Change::Deleted);
        note(&mut changes, to.expect("second path"), Change::Added);
    });

    assert_eq!(changes.get("was.txt"), Some(&Change::Deleted));
    assert_eq!(changes.get("is.txt"), Some(&Change::Added));
}

/// The second path of a rename is a path and not the next record's letter.
#[test]
fn a_rename_does_not_eat_the_record_after_it() {
    let mut records = Vec::new();
    walk_name_status("R100\0was.txt\0A\0D\0gone.txt\0", |letter, from, _| {
        records.push((letter, from.to_string()));
    });

    assert_eq!(
        records,
        vec![('R', "was.txt".to_string()), ('D', "gone.txt".to_string())]
    );
}
