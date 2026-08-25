//! What git has to say about one directory's rows.
//!
//! The rim on a branch says how much a worktree has moved; this says which rows
//! in the folder column moved it — the same question at two sizes, so the
//! vocabulary for what can have become of a file lives here and
//! [`super::workspace::status::read_status`] borrows it. The ignore list is read
//! here too, because the column asks both questions of the same directory at the
//! same moment. Asked of a directory rather than of a repository, because that
//! is the unit the column draws.

mod ignored;

#[cfg(test)]
mod tests;

use std::collections::HashMap;
use std::collections::hash_map::Entry;
use std::path::Path;

use serde::Serialize;

use ignored::read_ignored;

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

/// soon as two of them disagree.
/// Files the row that `path` is drawn by with what became of it.
///
/// The path is relative to the directory being read, so its first segment is
/// the name of a row in that listing: the file itself, or the folder that leads
/// to it. A folder keeps what everything under it agrees on and turns amber as
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
