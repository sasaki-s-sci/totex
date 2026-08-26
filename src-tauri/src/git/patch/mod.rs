//! What one file has become since the commit under it.
//!
//! The folder column asks what became of a whole directory and answers in a
//! colour per row — see [`super::changes`]. This is the same question asked of
//! one file and answered in full: which lines of it moved, and the patch git
//! would print for them. A card on the canvas draws the first down its gutter
//! and the second in place of the reading.
//!
//! Asked of a file rather than of a repository, because a card is one file and
//! the card is the only thing that asks.

#[cfg(test)]
mod tests;

use std::path::Path;

use serde::Serialize;

use super::cmd;

/// How much of a patch is worth sending to a card.
///
/// A card holds the head of a file — 64 KB, see `fs_browse::MAX_FILE_HEAD` — and
/// a patch is at most that twice over plus its context. What this bounds is the
/// other file: one longer than a card can hold is still diffed here, and a
/// rewritten one of those would be a megabyte of patch drawn a line at a time.
const MAX_PATCH: usize = 256 * 1024;

/// Where a file stands with the repository around it, as far as one is watching.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Standing {
    /// No repository would answer for it, which is most of a machine.
    Unknown,
    /// git is watching it and the commit under it has the same thing in it.
    /// A file git was told to ignore reads as this: neither has anything to show.
    Same,
    /// The two differ, and [`FileDiff::patch`] is what git says about how.
    Changed,
    /// git has never been told about it, so the whole of it is new. There is no
    /// patch for that — every line of what the card is already holding is the
    /// answer.
    Untracked,
}

/// What became of a run of lines.
///
/// The three the window already answers in: green for what has arrived, amber
/// for what has been rewritten, red for what has gone — the same three the
/// folder column colours its rows with and a branch its rim.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Mark {
    Added,
    Modified,
    Deleted,
}

/// One run of lines of the file as it now stands, and what became of them.
///
/// Runs rather than lines: a gutter is drawn in bars, and a hundred changed
/// lines in a row is one bar rather than a hundred.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Run {
    /// The first line of the run, counted from one as the card counts them.
    pub line: u32,
    /// How many lines it covers.
    ///
    /// Zero for a deletion, which is the whole of what makes one different:
    /// nothing of it is left in the file to mark, so what the card draws is the
    /// gap above `line` rather than a line of it.
    pub lines: u32,
    pub mark: Mark,
}

/// What git has to say about one file, for the card holding it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileDiff {
    pub standing: Standing,
    /// The hunks as git printed them, with the header it names files in taken
    /// off: the card already says which file it is holding.
    pub patch: String,
    /// Set when the patch ran past [`MAX_PATCH`] and was cut short.
    pub truncated: bool,
    /// What became of each run of lines in the file as it now stands.
    pub runs: Vec<Run>,
}

impl FileDiff {
    fn nothing(standing: Standing) -> Self {
        Self {
            standing,
            patch: String::new(),
            truncated: false,
            runs: Vec::new(),
        }
    }
}

/// What git says about one file: where it stands, how it differs, and which of
/// its lines moved.
///
/// Never a failure. A file outside a repository is the ordinary case rather than
/// an error — the canvas opens files from anywhere — and it is answered the same
/// way a directory git would not read is answered in the column: with nothing to
/// draw.
#[tauri::command(async)]
pub fn file_diff(path: String) -> FileDiff {
    read_diff(Path::new(&path))
}

/// Reads one file, in the directory it is in.
///
/// `diff HEAD` is everything git has been told about, staged or not — the two
/// are the same fact to whoever is reading the file — and it says nothing at all
/// about a file git has never been told about. So a diff with nothing in it is
/// two different answers, and which one it is takes the second command.
fn read_diff(file: &Path) -> FileDiff {
    let (Some(dir), Some(name)) = (file.parent(), file.file_name()) else {
        return FileDiff::nothing(Standing::Unknown);
    };
    // A pathspec rather than a path: a file called `*.rs` is one file, and one
    // called `-x` is not an option. `:(literal)` is what says so to git.
    let named = format!(":(literal){}", name.to_string_lossy());

    let patch = cmd::try_run(
        dir,
        &["diff", "HEAD", "--no-color", "--no-ext-diff", "--", &named],
    );
    let Some(patch) = patch else {
        // No HEAD to diff against — a repository with nothing committed in it
        // yet — or no repository at all. The listing below tells the two apart.
        return FileDiff::nothing(untracked_or_unknown(dir, &named));
    };

    if patch.trim().is_empty() {
        return FileDiff::nothing(match untracked_or_unknown(dir, &named) {
            Standing::Unknown => Standing::Same,
            standing => standing,
        });
    }

    let (patch, truncated) = cut(body_of(&patch));
    let runs = runs_of(&patch);
    FileDiff {
        standing: Standing::Changed,
        patch,
        truncated,
        runs,
    }
}

/// Whether git has never been told about this file, or would not answer at all.
///
/// An ignored file is not listed and so reads as neither: it is in no repository
/// as far as anything that reads one is concerned, and the card has nothing to
/// draw for it either way.
fn untracked_or_unknown(dir: &Path, named: &str) -> Standing {
    let listing = cmd::try_run(
        dir,
        &[
            "ls-files",
            "--others",
            "--exclude-standard",
            "-z",
            "--",
            named,
        ],
    );
    match listing {
        Some(listing) if listing.split('\0').any(|entry| !entry.is_empty()) => Standing::Untracked,
        Some(_) => Standing::Same,
        None => Standing::Unknown,
    }
}

/// The hunks, with the header git names files in taken off.
///
/// A card is holding one file and its name is written across the top of it, so
/// the four lines git spends saying which file this is are four lines of a small
/// card spent saying what it already says. What is left is the hunks — and, for
/// a file that is not text at all, git's one line saying so.
fn body_of(patch: &str) -> String {
    if patch.starts_with("@@ ") {
        return patch.to_string();
    }
    if let Some(at) = patch.find("\n@@ ") {
        return patch[at + 1..].to_string();
    }
    let kept: Vec<&str> = patch.lines().filter(|line| !heading(line)).collect();
    kept.join("\n")
}

/// One of the lines git writes above a patch to say which file it is of.
fn heading(line: &str) -> bool {
    const HEADINGS: [&str; 12] = [
        "diff --git ",
        "index ",
        "--- ",
        "+++ ",
        "old mode ",
        "new mode ",
        "new file mode ",
        "deleted file mode ",
        "similarity index ",
        "rename from ",
        "rename to ",
        "copy from ",
    ];
    HEADINGS.iter().any(|heading| line.starts_with(heading))
}

/// The patch, cut at the last whole line inside [`MAX_PATCH`].
fn cut(patch: String) -> (String, bool) {
    if patch.len() <= MAX_PATCH {
        return (patch, false);
    }
    let end = patch[..MAX_PATCH].rfind('\n').unwrap_or(0);
    (patch[..end].to_string(), true)
}

/// A block of changed lines while it is being read: where it starts in the file
/// as it now stands, and how many lines arrived and went in it.
#[derive(Default)]
struct Block {
    line: u32,
    added: u32,
    removed: u32,
}

/// What became of each run of lines, read off the patch.
///
/// A hunk says where it lands in the file as it now stands, and every line of it
/// after that either arrived, went, or is there in both — so walking a hunk is
/// counting. What is being counted is blocks: a run of lines that went followed
/// by a run that arrived is one thing that happened to the file, and the file
/// now holds the second half of it.
fn runs_of(patch: &str) -> Vec<Run> {
    let mut runs = Vec::new();
    let mut block = Block::default();
    // Where the reading has got to in the file as it now stands, and whether it
    // is inside a hunk at all — a patch begins outside one.
    let mut at = 0u32;
    let mut inside = false;

    for line in patch.lines() {
        if let Some(start) = hunk_at(line) {
            close(&mut runs, &mut block);
            at = start;
            inside = true;
            continue;
        }
        if !inside {
            continue;
        }
        match line.as_bytes().first() {
            Some(b'+') => {
                open(&mut block, at);
                block.added += 1;
                at += 1;
            }
            Some(b'-') => {
                open(&mut block, at);
                block.removed += 1;
            }
            // `\ No newline at end of file`, which is said about the line above
            // rather than being one.
            Some(b'\\') => {}
            // A line of the file that is in both, and an empty line of the patch,
            // which is a context line whose space was trimmed somewhere.
            Some(b' ') | None => {
                close(&mut runs, &mut block);
                at += 1;
            }
            // Anything else is not part of a hunk: the next file of a patch that
            // holds several, or the line git says a binary file differs on.
            _ => {
                close(&mut runs, &mut block);
                inside = false;
            }
        }
    }

    close(&mut runs, &mut block);
    runs
}

/// The line a block starts at, noted once — when the first line of it is read.
fn open(block: &mut Block, at: u32) {
    if block.added == 0 && block.removed == 0 {
        block.line = at;
    }
}

/// Files a block that has just ended as the run the gutter draws.
fn close(runs: &mut Vec<Run>, block: &mut Block) {
    let Block {
        line,
        added,
        removed,
    } = std::mem::take(block);
    match (added, removed) {
        (0, 0) => {}
        // Lines that arrived where nothing was taken away.
        (added, 0) => runs.push(Run {
            line,
            lines: added,
            mark: Mark::Added,
        }),
        // Lines that went and left nothing in their place. There is no line in
        // the file to mark, so the run is empty and stands at the gap: `line` is
        // the line that now follows what went, one past the end where a file was
        // cut short.
        (0, _) => runs.push(Run {
            line,
            lines: 0,
            mark: Mark::Deleted,
        }),
        // Lines that went and lines that arrived in their place, which is one
        // thing that happened however many of each there were.
        (added, _) => runs.push(Run {
            line,
            lines: added,
            mark: Mark::Modified,
        }),
    }
}

/// Where a hunk lands in the file as it now stands, off its `@@` line.
///
/// `@@ -12,7 +12,9 @@` is the whole of what is read: the second pair, whose
/// count is left off entirely when it is one line. Everything after the second
/// `@@` is git's guess at the function the hunk is in, which can hold anything.
fn hunk_at(line: &str) -> Option<u32> {
    let rest = line.strip_prefix("@@ ")?;
    let (_, new) = rest.split_once(" +")?;
    let start = new.split([',', ' ']).next()?;
    start.parse().ok()
}
