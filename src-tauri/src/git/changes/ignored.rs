//! The other thing git has to say about a name in a listing: whether it was
//! told to leave it alone.

use std::path::Path;

use super::super::cmd;

/// Which rows of `dir` are on the ignore list, and whether `dir` itself is.
///
/// `--directory` avoids walking huge ignored trees, but also collapses folders
/// containing only ignored files. Confirm directory entries with `check-ignore`
/// so those parents keep their normal colour. Paths are relative to `dir`.
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
            if inside_ignored(dir) {
                return (Vec::new(), true);
            }
            continue;
        }
        if name.contains('/') {
            continue;
        }
        if path.ends_with('/') && cmd::try_run(dir, &["check-ignore", "-q", "--", name]).is_none() {
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
