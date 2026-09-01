//! The lines a space keeps, which are read here and nowhere else.
//!
//! Ours from end to end, so it is tested against text alone — the same way the
//! Makefile reading is, and for the same reason: there is no program to ask.

use super::super::read::kept;

#[test]
fn a_blank_line_is_what_separates_them() {
    let found = kept("gh repo create\n\nax bbb ccc\n");

    assert_eq!(found.len(), 2);
    assert_eq!(found[0].line, "gh repo create");
    assert_eq!(found[1].line, "ax bbb ccc");
}

#[test]
fn one_command_may_run_to_several_lines() {
    let found = kept("git tag v1\ngit push --tags\n\nls\n");

    assert_eq!(found.len(), 2);
    assert_eq!(found[0].line, "git tag v1\ngit push --tags");
    // The row is one row, with the break marked rather than dropped.
    assert_eq!(found[0].name, "git tag v1 ⏎ git push --tags");
}

#[test]
fn the_comment_a_block_opens_with_is_what_it_is_for() {
    let found = kept("# make a repository on github\ngh repo create\n");

    assert_eq!(found[0].about, "make a repository on github");
    assert_eq!(found[0].line, "gh repo create");
}

#[test]
fn a_comment_under_the_command_belongs_to_the_command() {
    let found = kept("ls\n# not a description\n");

    assert_eq!(found.len(), 1);
    assert_eq!(found[0].about, "");
    assert_eq!(found[0].line, "ls\n# not a description");
}

#[test]
fn a_comment_nobody_wrote_a_command_under_is_nothing() {
    let found = kept("# just a note\n\nls\n");

    assert_eq!(found.len(), 1);
    assert_eq!(found[0].about, "");
    assert_eq!(found[0].line, "ls");
}

#[test]
fn a_line_with_only_spaces_on_it_separates_too() {
    let found = kept("one\n   \ntwo\n");

    assert_eq!(found.len(), 2);
}

#[test]
fn a_run_of_blank_lines_is_one_separator() {
    let found = kept("one\n\n\n\ntwo\n");

    assert_eq!(found.len(), 2);
}

#[test]
fn a_file_written_on_windows_reads_the_same() {
    let found = kept("one\r\n\r\ntwo\r\n");

    assert_eq!(found.len(), 2);
    assert_eq!(found[0].line, "one");
    assert_eq!(found[1].line, "two");
}

#[test]
fn an_empty_file_keeps_nothing() {
    assert!(kept("").is_empty());
    assert!(kept("\n\n\n").is_empty());
}

#[test]
fn every_line_is_this_windows_own() {
    let found = kept("ls\n");

    assert_eq!(found[0].runner, "totex");
    assert!(found[0].params.is_empty());
}

/// The other half: that a file on disk is found from below it, and that what it
/// keeps comes back at the top of the list.
#[test]
fn a_space_below_the_folder_is_read_and_comes_first() {
    let temp = super::TempDir::new("commands");
    let space = temp.path().join(crate::space::DIR);
    std::fs::create_dir_all(&space).expect("make the space");
    std::fs::write(space.join("commands"), "gh repo create\n\nax bbb ccc\n").expect("write them");
    temp.holding("Makefile", "build:\n\techo built\n");

    let deep = temp.path().join("src");
    std::fs::create_dir_all(&deep).expect("make the folder");

    let found = super::super::read::everything(&deep);
    let ours: Vec<&str> = found
        .iter()
        .take_while(|task| task.runner == "totex")
        .map(|task| task.line.as_str())
        .collect();

    assert_eq!(ours, ["gh repo create", "ax bbb ccc"]);
    // The Makefile beside them is in the space's own folder rather than in the
    // one asked about, so it is the space that carries down and not the runner.
    assert!(found.iter().all(|task| task.runner == "totex"));
}
