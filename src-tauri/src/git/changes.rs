//! What git has to say about one directory's rows.
//!
//! The rim on a branch says how much a worktree has moved; this says which
//! rows in the folder column moved it. Both are the same question asked at two
//! sizes — [`super::workspace::read_status`] counts a whole worktree, and this
//! names the entries of one directory in it — so the vocabulary for what can
//! have become of a file lives here and the counting borrows it.
//!
//! The ignore list is read here as well, because it is the other thing git has
//! to say about a name in a listing, and the column asks both questions of the
//! same directory at the same moment. It is the weaker fact of the two and is
//! drawn as one: a file that moved takes a colour, and a file git was told to
//! leave alone is only drawn faint.
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

/// What git has to say about the rows of one directory.
///
/// The two things it says, kept apart because a row is drawn by one or the
/// other and never by both: what became of a file is a colour, and being on the
/// ignore list is a faint row. A file has at most one of them to its name — one
/// git was told to ignore is not one it is watching, so it can neither have
/// arrived nor been rewritten — and a folder that manages both is drawn by what
/// became of it, which is the thing worth seeing.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Answer {
    /// What became of each row that has moved, by the name of that row.
    pub changed: HashMap<String, Change>,
    /// The rows of this directory that git was told to ignore, by name.
    pub ignored: Vec<String>,
    /// Set when the directory itself is one of those, which makes every row in
    /// it one too. Nothing is listed then, because there is nothing in such a
    /// directory that is not on the list — and naming what is under
    /// `node_modules` one file at a time is the one thing this must not do.
    pub all_ignored: bool,
}

/// What git says about each of `paths`, by the entry each answer belongs to.
///
/// Keyed by the directory asked about, then by the name of the row inside it —
/// the name and not a path, because a row is drawn by the level holding it and
/// a file further down belongs to the folder that leads there. A directory git
/// would not answer for is left out rather than failing the call: the column is
/// mostly folders that are not repositories, and none of them is an error.
#[tauri::command(async)]
pub fn directory_changes(paths: Vec<String>) -> HashMap<String, Answer> {
    super::parallel_map(paths, |path| {
        let answer = read_answer(Path::new(&path))?;
        Some((path, answer))
    })
    .into_iter()
    .flatten()
    .collect()
}

/// Reads one directory: what became of each name directly inside it, and which
/// of those names git was told to ignore.
///
/// The same two commands the worktree's counts are read with, asked about this
/// directory alone — `--relative` both limits the diff to the subtree and
/// answers in paths starting at it, and `ls-files` is already bounded by the
/// directory it runs in — and one more for the ignore list. So an open level
/// costs three gits whatever the repository around it is, and a file five
/// folders down is answered for by the one folder in this listing that leads to
/// it.
///
/// `None` is a directory git would not answer for — one outside a repository,
/// most of the time — which the column draws in the colour of everything else.
fn read_answer(dir: &Path) -> Option<Answer> {
    // Asked first because it is the question that fails when this is not a
    // repository at all. A repository with no commit in it yet has no HEAD to
    // diff against and everything in it is untracked anyway, so the diff below
    // is allowed to say nothing.
    let untracked = cmd::try_run(dir, &["ls-files", "--others", "--exclude-standard", "-z"])?;

    let mut changed = HashMap::new();
    if let Some(listing) = cmd::try_run(dir, &["diff", "HEAD", "--name-status", "-z", "--relative"])
    {
        walk_name_status(&listing, |letter, from, to| match letter {
            'A' => note(&mut changed, from, Change::Added),
            'D' => note(&mut changed, from, Change::Deleted),
            // A rename is a name that has gone and a name that has arrived.
            // The rim counts it as one file that changed, because that is what
            // it is to the branch; here it is two rows, because that is what it
            // is to whoever is looking at the folder — one of those names is on
            // the disk and the other is not.
            'R' => {
                note(&mut changed, from, Change::Deleted);
                if let Some(to) = to {
                    note(&mut changed, to, Change::Added);
                }
            }
            // A copy leaves its source where it was.
            'C' => {
                if let Some(to) = to {
                    note(&mut changed, to, Change::Added);
                }
            }
            _ => note(&mut changed, from, Change::Modified),
        });
    }

    for path in untracked.split('\0').filter(|path| !path.is_empty()) {
        note(&mut changed, path, Change::Added);
    }

    let (ignored, all_ignored) = read_ignored(dir);
    Some(Answer {
        changed,
        ignored,
        all_ignored,
    })
}

/// Which rows of `dir` are on the ignore list, and whether `dir` itself is.
///
/// `--directory` is the whole of what makes this affordable: a folder that is
/// ignored answers with its own name, so `node_modules` is one line and not the
/// forty thousand files under it. What comes back is relative to this
/// directory, so a name with a slash in it is a file further down under a
/// folder that is not itself ignored — the row leading to it is a folder of
/// this repository like any other, and drawing it faint would say the opposite.
///
/// A directory that is itself ignored has no names to tell apart: git answers
/// `./`, meaning the place it was asked from, and a level or two further down
/// it stops answering at all — `--directory` inside an ignored folder is an
/// error in the gits this runs against. Both are the same fact, and both are
/// settled by asking about this one directory instead.
fn read_ignored(dir: &Path) -> (Vec<String>, bool) {
    let listed = cmd::try_run(
        dir,
        &[
            "ls-files",
            "--others",
            "--ignored",
            "--exclude-standard",
            "--directory",
            "-z",
        ],
    );
    let Some(listing) = listed else {
        return (Vec::new(), inside_ignored(dir));
    };

    let mut names = Vec::new();
    for path in listing.split('\0').filter(|path| !path.is_empty()) {
        // A folder arrives with a trailing slash, and the directory git was
        // asked from arrives as itself.
        let name = path.trim_end_matches('/');
        if name.is_empty() || name == "." {
            return (Vec::new(), true);
        }
        if name.contains('/') {
            continue;
        }
        names.push(name.to_string());
    }

    (names, false)
}

/// Whether `dir` is inside something the ignore list names.
///
/// One question about one directory, which is all that is left when the listing
/// cannot be had: everything under an ignored folder is ignored too, so a level
/// showing one has no names to tell apart anyway.
fn inside_ignored(dir: &Path) -> bool {
    // `-q` says nothing and answers with its exit code, which is the one thing
    // `try_run` reads: a path on the list is a git that succeeded.
    cmd::try_run(dir, &["check-ignore", "-q", "."]).is_some()
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
}
