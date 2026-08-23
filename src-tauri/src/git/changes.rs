//! What is uncommitted, one directory at a time.
//!
//! The rim on a branch says how much a worktree has moved; this says which
//! rows in the folder column moved it. Both are the same question asked at two
//! sizes — [`super::workspace::read_status`] counts a whole worktree, and this
//! names the entries of one directory in it — so the vocabulary for what can
//! have become of a file lives here and the counting borrows it.
//!
//! Asked of a directory rather than of a repository, because that is the unit
//! the column draws: every open level reads its own directory, and one that is
//! not in a repository at all simply has nothing to say.

use std::collections::HashMap;
use std::collections::hash_map::Entry;
use std::path::Path;

use serde::Serialize;

use super::cmd;

/// What became of a file, as far as a row can show it.
///
/// The three the window already answers in: green for what has arrived, amber
/// for what has been rewritten, red for what has gone. A folder carries the one
/// its contents agree on, and amber when they do not — a directory that gained
/// one file and lost another has been rewritten, whatever either file did.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Change {
    /// The worktree has it and the commit does not, tracked or not.
    Added,
    /// Both have it, with something different in it.
    Modified,
    /// The commit has it and the worktree does not.
    Deleted,
}

/// What is uncommitted in each of `paths`, by the entry it belongs to.
///
/// Keyed by the directory asked about, then by the name of the row inside it —
/// the name and not a path, because a row is drawn by the level holding it and
/// a file further down belongs to the folder that leads there. A directory git
/// would not answer for is left out rather than failing the call: the column is
/// mostly folders that are not repositories, and none of them is an error.
#[tauri::command(async)]
pub fn directory_changes(paths: Vec<String>) -> HashMap<String, HashMap<String, Change>> {
    super::parallel_map(paths, |path| {
        let changes = read_changes(Path::new(&path))?;
        Some((path, changes))
    })
    .into_iter()
    .flatten()
    .collect()
}

/// Reads one directory: what became of each name directly inside it.
///
/// The same two commands the worktree's counts are read with, asked about this
/// directory alone — `--relative` both limits the diff to the subtree and
/// answers in paths starting at it, and `ls-files` is already bounded by the
/// directory it runs in. So an open level costs two gits whatever the
/// repository around it is, and a file five folders down is answered for by the
/// one folder in this listing that leads to it.
///
/// `None` is a directory git would not answer for — one outside a repository,
/// most of the time — which the column draws in the colour of everything else.
fn read_changes(dir: &Path) -> Option<HashMap<String, Change>> {
    // Asked first because it is the question that fails when this is not a
    // repository at all. A repository with no commit in it yet has no HEAD to
    // diff against and everything in it is untracked anyway, so the diff below
    // is allowed to say nothing.
    let untracked = cmd::try_run(dir, &["ls-files", "--others", "--exclude-standard", "-z"])?;

    let mut changes = HashMap::new();
    if let Some(listing) = cmd::try_run(dir, &["diff", "HEAD", "--name-status", "-z", "--relative"])
    {
        walk_name_status(&listing, |letter, from, to| match letter {
            'A' => note(&mut changes, from, Change::Added),
            'D' => note(&mut changes, from, Change::Deleted),
            // A rename is a name that has gone and a name that has arrived.
            // The rim counts it as one file that changed, because that is what
            // it is to the branch; here it is two rows, because that is what it
            // is to whoever is looking at the folder — one of those names is on
            // the disk and the other is not.
            'R' => {
                note(&mut changes, from, Change::Deleted);
                if let Some(to) = to {
                    note(&mut changes, to, Change::Added);
                }
            }
            // A copy leaves its source where it was.
            'C' => {
                if let Some(to) = to {
                    note(&mut changes, to, Change::Added);
                }
            }
            _ => note(&mut changes, from, Change::Modified),
        });
    }

    for path in untracked.split('\0').filter(|path| !path.is_empty()) {
        note(&mut changes, path, Change::Added);
    }

    Some(changes)
}

/// Files the row that `path` is drawn by with what became of it.
///
/// The path is relative to the directory being read, so its first segment is
/// the name of a row in that listing: the file itself, or the folder that leads
/// to it. A folder keeps what everything under it agrees on and turns amber as
/// soon as two of them disagree.
fn note(changes: &mut HashMap<String, Change>, path: &str, change: Change) {
    // git answers in forward slashes wherever it ran, including on Windows.
    let Some(name) = path.split('/').next().filter(|name| !name.is_empty()) else {
        return;
    };

    match changes.entry(name.to_string()) {
        Entry::Occupied(mut held) => {
            if *held.get() != change {
                held.insert(Change::Modified);
            }
        }
        Entry::Vacant(slot) => {
            slot.insert(change);
        }
    }
}

/// Walks `git diff --name-status -z`: what became of a file, and the path or
/// paths it became of.
///
/// Each field is NUL-terminated rather than a line of its own, so a path with a
/// newline or a quote in it arrives as git holds it. A rename or a copy carries
/// a similarity score on its letter and two paths after it — where the file was
/// and where it is now — which is why the paths are stepped over by what the
/// letter says rather than one at a time. A listing that stops in the middle of
/// a record stops the walk: what is left is half a fact.
pub(super) fn walk_name_status(listing: &str, mut note: impl FnMut(char, &str, Option<&str>)) {
    let mut fields = listing.split('\0').filter(|field| !field.is_empty());

    while let Some(kind) = fields.next() {
        let Some(letter) = kind.chars().next() else {
            continue;
        };
        let Some(from) = fields.next() else { return };
        let to = if letter == 'R' || letter == 'C' {
            let Some(to) = fields.next() else { return };
            Some(to)
        } else {
            None
        };
        note(letter, from, to);
    }
}

#[cfg(test)]
mod tests {
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

    fn changes(dir: &Path) -> HashMap<String, Change> {
        read_changes(dir).expect("changes")
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
}
