//! What the walk finds, and what it refuses to walk into.

use super::*;

fn temp_dir(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("totex-walk-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).expect("temp dir");
    dir
}

fn checkout(at: &Path) {
    std::fs::create_dir_all(at.join(".git")).expect("a checkout");
}

/// What was found, named relative to the root, in one spelling.
///
/// On the string rather than through `Path::strip_prefix`, because half of
/// these paths are a distribution's — and a Linux build reads one of those
/// as a single component with no prefix to strip.
fn under(root: &Path, found: &[PathBuf]) -> Vec<String> {
    let root = format!("{}", root.to_string_lossy());
    let mut named: Vec<String> = found
        .iter()
        .map(|path| {
            path.to_string_lossy()
                .strip_prefix(&root)
                .unwrap_or_default()
                .trim_start_matches(['/', '\\'])
                .replace('\\', "/")
        })
        .collect();
    named.sort();
    named
}

#[test]
fn finds_a_repository_at_every_depth_it_is_allowed() {
    let dir = temp_dir("depth");
    checkout(&dir.join("one"));
    checkout(&dir.join("nested/two"));
    std::fs::create_dir_all(dir.join("node_modules/three/.git")).expect("noise");

    let found = discover(&dir, 12);
    assert_eq!(
        under(&dir, &found.candidates),
        ["nested/two", "one"],
        "and never into node_modules"
    );

    assert_eq!(discover(&dir, 1).candidates.len(), 1, "one level only");
    std::fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn counts_projects_rather_than_checkouts_of_them() {
    let dir = temp_dir("count");
    checkout(&dir.join("one"));
    // A linked worktree keeps a line of text where its `.git` would be.
    std::fs::create_dir_all(dir.join("one-topic")).expect("a worktree");
    std::fs::write(
        dir.join("one-topic/.git"),
        "gitdir: ../one/.git/worktrees/topic",
    )
    .expect("a pointer");
    // A submodule belongs to the project holding it.
    checkout(&dir.join("one/sub"));

    assert_eq!(count_repositories(&dir, 12, 1_000), 1);
    // The walk still offers all three to the scan, which resolves them.
    assert_eq!(discover(&dir, 12).candidates.len(), 3);
    std::fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn a_bare_repository_is_one_too() {
    let dir = temp_dir("bare");
    let bare = dir.join("thing.git");
    std::fs::create_dir_all(bare.join("objects")).expect("a bare repo");
    std::fs::create_dir_all(bare.join("refs")).expect("a bare repo");
    std::fs::write(bare.join("HEAD"), "ref: refs/heads/main\n").expect("a head");

    assert_eq!(discover(&dir, 12).candidates, vec![bare.clone()]);
    assert_eq!(count_repositories(&dir, 12, 1_000), 1);
    std::fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn a_walk_that_runs_out_of_budget_says_so() {
    let dir = temp_dir("budget");
    for index in 0..8 {
        std::fs::create_dir_all(dir.join(format!("folder-{index}"))).expect("a folder");
    }
    let mut warnings = Vec::new();
    walk(&Host::Local, &dir, 12, 3, &mut warnings, |_, _| {
        Descend::Yes
    });
    assert_eq!(warnings, vec!["directory-budget".to_string()]);
    std::fs::remove_dir_all(&dir).unwrap();
}

/// The same walk, over a folder inside a distribution. Skipped where there
/// is no WSL to reach, which is every machine the CI builds on.
#[test]
fn walks_a_folder_inside_a_distribution() {
    let Some(distro) = crate::wsl::distros().into_iter().next() else {
        return;
    };
    let host = Host::Wsl(distro);
    let root = host.canonical("/tmp/totex-walk-remote");
    host.exec(None, &[], &["rm", "-rf", "/tmp/totex-walk-remote"])
        .expect("a shell");
    host.exec(
        None,
        &[],
        &[
            "mkdir",
            "-p",
            "/tmp/totex-walk-remote/one/.git",
            "/tmp/totex-walk-remote/deep/two/.git",
            "/tmp/totex-walk-remote/node_modules/three/.git",
        ],
    )
    .expect("a shell");

    let found = discover(&root, 12);
    assert_eq!(under(&root, &found.candidates), ["deep/two", "one"]);
    assert_eq!(count_repositories(&root, 12, 1_000), 2);
    assert_eq!(
        levels(&host, &root, 1).len(),
        3,
        "the root and the two folders under it that are not noise"
    );
}
