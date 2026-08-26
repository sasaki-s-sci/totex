//! Reading a Makefile for the targets somebody would type.

use super::super::read::targets;

/// The shape of a Makefile written to be read: a target, its prerequisites, and
/// a sentence after `##` saying what it is for.
#[test]
fn a_target_is_found_with_whatever_it_says_about_itself() {
    let found = targets("build: deps ## Build the thing\n\tcargo build\n");

    assert_eq!(found.len(), 1, "one rule is one target: {found:?}");
    assert_eq!(found[0].runner, "make");
    assert_eq!(found[0].name, "build");
    assert_eq!(found[0].about, "Build the thing");
    assert_eq!(found[0].line, "make build");
}

/// A recipe is the target's, not a target of its own — and a tab is the whole
/// of what says which is which, including for a line that would otherwise read
/// exactly like a rule.
#[test]
fn a_recipe_line_is_not_a_target() {
    let found = targets("build:\n\techo one: two\n\tmake other\n");

    assert_eq!(names(&found), ["build"], "the recipe was read as a rule");
}

/// Everything in the file that is shaped like a rule and is not one.
#[test]
fn what_is_not_a_rule_is_left_alone() {
    let found = targets(concat!(
        "CARGO := cargo\n",
        "FLAGS ::= --release\n",
        "EXTRA = a:b\n",
        "# check: a comment about a target\n",
        ".PHONY: build test\n",
        "%.o: %.c\n\tcc $<\n",
        "$(BINARY): build\n",
        "build:\n\tcargo build\n",
    ));

    assert_eq!(names(&found), ["build"], "found: {found:?}");
}

/// Two targets on one line are two things that can be run, and the same target
/// written twice — which is how a Makefile adds prerequisites to a rule — is
/// still one thing.
#[test]
fn a_rule_may_name_more_than_one_target_and_a_target_more_than_one_rule() {
    let found = targets("fmt lint: ## Tidy up\n\ttrue\nfmt: deps\n\ttrue\n");

    assert_eq!(names(&found), ["fmt", "lint"]);
    assert_eq!(found[0].about, "Tidy up");
}

/// The first target is what `make` alone runs, so the file's own order is the
/// order the list keeps.
#[test]
fn the_targets_come_back_in_the_order_the_file_writes_them() {
    let found = targets("all: build\nbuild:\n\ttrue\nclean:\n\ttrue\n");

    assert_eq!(names(&found), ["all", "build", "clean"]);
}

/// A double-colon rule is a rule.
#[test]
fn a_rule_written_with_two_colons_is_read_as_one() {
    let found = targets("clean:: ## Remove what was built\n\trm -rf out\n");

    assert_eq!(names(&found), ["clean"]);
    assert_eq!(found[0].about, "Remove what was built");
}

fn names(found: &[super::super::Task]) -> Vec<&str> {
    found.iter().map(|task| task.name.as_str()).collect()
}
