//! Where a branch lands, and that it always lands in the same place.

use std::path::Path;

use super::super::place::{slug, worktree_path};
use crate::host::Host;

#[test]
fn a_branch_always_lands_in_the_same_directory() {
    let here = Host::Local;
    let root = Path::new("/data");
    let once = worktree_path(&here, root, "/repo/a", "feature/x");
    assert_eq!(once, worktree_path(&here, root, "/repo/a", "feature/x"));

    // The name is readable, and what makes it unique is not.
    let leaf = once.file_name().unwrap().to_string_lossy().into_owned();
    assert!(leaf.starts_with("feature-x-"), "unreadable leaf: {leaf}");

    // Two repositories may share a branch name without sharing a directory.
    assert_ne!(once, worktree_path(&here, root, "/repo/b", "feature/x"));
    // Two branches may slug the same without sharing a directory.
    assert_ne!(once, worktree_path(&here, root, "/repo/a", "feature+x"));
}

/// A repository inside a distribution is keyed by the name the distribution
/// calls it, so opening the folder from the Windows side and from inside lands
/// the same branch in the same worktree.
#[test]
fn a_branch_lands_in_one_place_whichever_side_asked() {
    let inside = Host::Wsl("Ubuntu".to_string());
    let root = inside.canonical("/home/a/.local/share/com.totex.app/worktrees");
    let from_windows = worktree_path(&inside, &root, "/home/a/repo", "topic");
    let from_inside = worktree_path(
        &Host::Local,
        Path::new("/home/a/.local/share/com.totex.app/worktrees"),
        "/home/a/repo",
        "topic",
    );
    assert_eq!(inside.native(&from_windows), from_inside.to_string_lossy());
}

#[test]
fn a_branch_with_no_usable_characters_still_gets_a_name() {
    assert_eq!(slug("///"), "workspace");
    assert_eq!(slug("release/1.2"), "release-1.2");
}
