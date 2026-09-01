//! Finding a space, and what one says.
//!
//! Everything here is on this machine's own disk. What a distribution changes
//! about any of it is which program answers `read` and `parent`, which is the
//! host layer's business and tested there — the walk, the reading and the
//! writing are the same walk either way.

use std::path::{Path, PathBuf};

use super::settings::tell;
use super::{DIR, Settings, find, home, settings};

/// A temporary directory that removes itself, so a failing test cannot leave a
/// fixture behind.
struct TempDir(PathBuf);

impl TempDir {
    fn new(tag: &str) -> Self {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|elapsed| elapsed.as_nanos())
            .unwrap_or_default();
        let path =
            std::env::temp_dir().join(format!("totex-space-{tag}-{}-{unique}", std::process::id()));
        std::fs::create_dir_all(&path).expect("create temp dir");
        Self(path)
    }

    fn path(&self) -> &Path {
        &self.0
    }

    /// Makes one of the fixture's directories, however deep.
    fn folder(&self, at: &str) -> PathBuf {
        let path = self.0.join(at);
        std::fs::create_dir_all(&path).expect("create the fixture folder");
        path
    }

    /// Writes one of the fixture's files, making the folder it goes in.
    fn holding(&self, at: &str, text: &str) -> &Self {
        let path = self.0.join(at);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).expect("create the fixture folder");
        }
        std::fs::write(&path, text).expect("write the fixture");
        self
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

#[test]
fn a_folder_told_nothing_is_in_no_space() {
    let temp = TempDir::new("none");
    let deep = temp.folder("one/two");
    // The walk goes above the fixture into the machine's temp directory and on
    // up, so this only says what it means where nothing up there has a `.totex`
    // -- which is the case, and is why the fixture is where it is.
    assert_eq!(find(&deep), None);
}

#[test]
fn a_space_is_found_from_below_it() {
    let temp = TempDir::new("below");
    temp.folder(&format!("project/{DIR}"));
    let deep = temp.folder("project/src/inner");

    assert_eq!(find(&deep), Some(temp.path().join("project")));
}

#[test]
fn the_nearest_space_is_the_one() {
    let temp = TempDir::new("nearest");
    temp.folder(&format!("outer/{DIR}"));
    temp.folder(&format!("outer/inner/{DIR}"));

    assert_eq!(
        find(&temp.path().join("outer/inner/deeper")),
        Some(temp.path().join("outer/inner"))
    );
}

#[test]
fn a_folder_holding_one_is_its_own_space() {
    let temp = TempDir::new("own");
    let project = temp.folder(&format!("project/{DIR}"));

    assert_eq!(
        find(project.parent().unwrap()),
        Some(temp.path().join("project"))
    );
}

#[test]
fn a_space_is_made_at_the_checkout() {
    let temp = TempDir::new("checkout");
    temp.folder("project/.git");
    let deep = temp.folder("project/src/inner");

    assert_eq!(home(&deep), temp.path().join("project"));
}

#[test]
fn a_worktree_is_a_checkout_too() {
    let temp = TempDir::new("worktree");
    // What a worktree and a submodule keep under that name is a file, which is
    // the whole reason the walk asks whether anything is there rather than
    // whether a directory is.
    temp.holding("tree/.git", "gitdir: /somewhere/else\n");

    assert_eq!(home(&temp.path().join("tree")), temp.path().join("tree"));
}

#[test]
fn a_folder_in_no_checkout_is_its_own_home() {
    let temp = TempDir::new("loose");
    let loose = temp.folder("notes");

    assert_eq!(home(&loose), loose);
}

#[test]
fn a_space_that_said_nothing_says_the_defaults() {
    let temp = TempDir::new("silent");
    let loose = temp.folder("notes");

    assert_eq!(settings(&loose), Settings::default());
    assert!(settings(&loose).mcp);
}

#[test]
fn a_space_is_read_from_below_it() {
    let temp = TempDir::new("read");
    temp.holding(
        &format!("project/{DIR}/settings.json"),
        "{ \"mcp\": false }\n",
    );
    let deep = temp.folder("project/src");

    assert!(!settings(&deep).mcp);
}

#[test]
fn a_file_that_will_not_parse_says_the_defaults() {
    let temp = TempDir::new("broken");
    temp.holding(
        &format!("project/{DIR}/settings.json"),
        "{ this is not json",
    );

    assert_eq!(settings(&temp.path().join("project")), Settings::default());
}

#[test]
fn telling_a_folder_makes_the_space_at_its_checkout() {
    let temp = TempDir::new("tell");
    temp.folder("project/.git");
    let deep = temp.folder("project/src");

    let space = tell(&deep, Settings { mcp: false }).expect("tell the space");

    assert_eq!(PathBuf::from(&space), temp.path().join("project"));
    assert!(
        temp.path()
            .join("project")
            .join(DIR)
            .join("settings.json")
            .exists()
    );
    assert!(!settings(&deep).mcp);
}

#[test]
fn telling_it_again_writes_over_what_is_there() {
    let temp = TempDir::new("again");
    let loose = temp.folder("notes");

    tell(&loose, Settings { mcp: false }).expect("tell the space");
    tell(&loose, Settings { mcp: true }).expect("tell it again");

    assert!(settings(&loose).mcp);
}
