//! What a ref says about the branch it names, and how much history is read.

use super::super::inspect::refs::{classify, parse_track};
use super::super::model::{BranchKind, Remote};
use super::{TempDir, commit, find, git, git_available, scan};

#[test]
fn parses_upstream_tracking() {
    assert_eq!(parse_track(""), (0, 0, false));
    assert_eq!(parse_track("[ahead 3]"), (3, 0, false));
    assert_eq!(parse_track("[behind 2]"), (0, 2, false));
    assert_eq!(parse_track("[ahead 3, behind 2]"), (3, 2, false));
    assert_eq!(parse_track("[gone]"), (0, 0, true));
}

#[test]
fn classifies_refs_against_configured_remotes() {
    let remotes = vec![
        Remote {
            name: "origin".into(),
            url: "https://example.invalid/a.git".into(),
        },
        // A remote whose name contains a slash must win over the naive split.
        Remote {
            name: "team/fork".into(),
            url: "https://example.invalid/b.git".into(),
        },
    ];

    let (kind, remote, name) = classify("refs/heads/feature/x", &remotes);
    assert_eq!(kind, BranchKind::Local);
    assert_eq!(remote, None);
    assert_eq!(name, "feature/x");

    let (kind, remote, name) = classify("refs/remotes/origin/main", &remotes);
    assert_eq!(kind, BranchKind::Remote);
    assert_eq!(remote.as_deref(), Some("origin"));
    assert_eq!(name, "origin/main");

    let (kind, remote, name) = classify("refs/remotes/team/fork/main", &remotes);
    assert_eq!(kind, BranchKind::Remote);
    assert_eq!(remote.as_deref(), Some("team/fork"));
    assert_eq!(name, "team/fork/main");
}

#[test]
fn history_stops_at_the_commit_limit() {
    if !git_available() {
        eprintln!("skipping: git is not on PATH");
        return;
    }

    let temp = TempDir::new("limit");
    let root = temp.path();
    let repo = root.join("delta");
    std::fs::create_dir_all(&repo).expect("create delta");
    git(&repo, &["init", "-b", "main"]);
    for index in 0..5 {
        commit(&repo, &format!("f{index}.txt"), "x");
    }

    let workspace = scan(root.to_string_lossy().into_owned(), Some(3)).expect("scan");
    let delta = find(&workspace.repositories, "delta");
    assert_eq!(delta.commits.len(), 3, "the newest three commits only");
    assert!(delta.history_truncated);
    // Newest first, so the head commit leads.
    assert_eq!(delta.commits[0].subject, "add f4.txt");
}
