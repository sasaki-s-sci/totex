//! Which branches a repository asks the graph to leave out.
//!
//! The graph draws every branch a repository has, including the ones whose
//! commits are folded away — which is right for a checkout somebody works in
//! and wrong for one that carries a hundred release tags' worth of old lines.
//! So a repository can say which names are not worth a row, and it says it in
//! the one place a fact about a folder is already written down: `.totex`, found
//! by walking up the way `.git` is found.
//!
//! Only the lines are read here. What a line means is the window's, because
//! what it decides is what is drawn — see `src/lib/graph/ignore.ts`.

use std::path::Path;

use crate::host::Host;
use crate::space;

/// What the file is called, inside the space's own directory.
const FILE: &str = ".graphignore";

/// How much of one is read.
///
/// A list of branch names, and a generous bound on one: the file is read on
/// every inspection of the repository, and anything past this is somebody
/// pointing the name at something that is not a list.
const LIMIT: u64 = 64 * 1024;

/// The patterns the space around `dir` keeps, in the order they were written.
///
/// Never an error. A file that is not there, a folder that cannot be read, a
/// space that was never made: each of them is a repository that has asked for
/// nothing left out, which is what every repository asked for before this
/// existed.
pub(super) fn graph_ignore(dir: &Path) -> Vec<String> {
    let Some(space) = space::find(dir) else {
        return Vec::new();
    };
    let host = Host::of(&space);
    let file = host.join(&host.join(&space, space::DIR), FILE);
    let Ok((bytes, _)) = host.read_head(&file, LIMIT) else {
        return Vec::new();
    };

    String::from_utf8_lossy(&bytes)
        .lines()
        .map(str::trim)
        // Blank lines and comments are the file's own furniture. Dropping them
        // here is what lets the window read the list as a list.
        .filter(|line| !line.is_empty() && !line.starts_with('#'))
        .map(str::to_string)
        .collect()
}
