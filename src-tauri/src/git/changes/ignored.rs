//! The other thing git has to say about a name in a listing: whether it was
//! told to leave it alone.

use std::path::Path;

use super::super::cmd;

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
pub(super) fn read_ignored(dir: &Path) -> (Vec<String>, bool) {
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
