//! The three runners that answer for themselves, asked for real.
//!
//! Each of these skips itself where its runner is not installed. What is being
//! checked is the one thing no fixture can stand in for: that the words this
//! app asks in are words that program answers to, and that what it answers with
//! is still shaped the way this reads it. A version that changed either would
//! otherwise be a list that quietly came back empty.

use super::super::Task;
use super::super::read::everything;
use super::{TempDir, installed};

#[test]
fn mise_says_what_its_own_config_can_run() {
    if !installed("mise") {
        return;
    }
    let temp = TempDir::new("mise");
    temp.holding(
        "mise.toml",
        concat!(
            "[tasks.hello]\n",
            "description = \"Say hello\"\n",
            "run = \"echo hi\"\n",
            "\n",
            "[tasks.inner]\n",
            "hide = true\n",
            "run = \"echo inner\"\n",
        ),
    );

    let found = everything(temp.path());
    let hello = one(&found, "hello");

    assert_eq!(hello.runner, "mise");
    assert_eq!(hello.about, "Say hello");
    assert_eq!(hello.line, "mise run hello");
    // A hidden task is a step something else depends on, and not a line
    // anybody types.
    assert!(named(&found, "inner").is_none(), "found: {found:?}");
}

#[test]
fn task_says_what_a_taskfile_can_run() {
    if !installed("task") {
        return;
    }
    let temp = TempDir::new("task");
    temp.holding(
        "Taskfile.yml",
        concat!(
            "version: \"3\"\n",
            "tasks:\n",
            "  build:\n",
            "    desc: Build the thing\n",
            "    cmds:\n",
            "      - echo build\n",
            "  quiet:\n",
            "    cmds:\n",
            "      - echo quiet\n",
        ),
    );

    let found = everything(temp.path());
    let build = one(&found, "build");

    assert_eq!(build.runner, "task");
    assert_eq!(build.about, "Build the thing");
    assert_eq!(build.line, "task build");
    // Asked for all of them: a task nobody described is still a task somebody
    // wrote to be run.
    assert_eq!(one(&found, "quiet").about, "");
}

#[test]
fn just_says_what_a_justfile_can_run() {
    if !installed("just") {
        return;
    }
    let temp = TempDir::new("just");
    temp.holding(
        "justfile",
        concat!(
            "# Build the thing\n",
            "build:\n",
            "    echo build\n",
            "\n",
            "_inner:\n",
            "    echo inner\n",
        ),
    );

    let found = everything(temp.path());
    let build = one(&found, "build");

    assert_eq!(build.runner, "just");
    assert_eq!(build.about, "Build the thing");
    assert_eq!(build.line, "just build");
    // A recipe whose name starts with an underscore is just's own way of
    // saying it is a step rather than a thing to run.
    assert!(named(&found, "_inner").is_none(), "found: {found:?}");
    // A recipe that takes nothing says so by taking nothing, which is what
    // makes Return on that row run it rather than ask about it.
    assert_eq!(build.params, Vec::new());
}

/// The one runner of the four that says what a task is given, which is what the
/// window asks for before it runs one.
#[test]
fn just_says_what_a_recipe_is_given() {
    if !installed("just") {
        return;
    }
    let temp = TempDir::new("params");
    temp.holding(
        "justfile",
        concat!(
            "deploy target env=\"staging\" *extra:\n",
            "    echo {{target}} {{env}} {{extra}}\n",
            "\n",
            "push +remotes:\n",
            "    echo {{remotes}}\n",
        ),
    );

    let found = everything(temp.path());
    let taken = &one(&found, "deploy").params;

    assert_eq!(
        names(taken),
        ["target", "env", "extra"],
        "in the order passed"
    );
    // Nothing to stand at, so the recipe cannot run without it.
    assert!(taken[0].required);
    assert_eq!(taken[0].default, None);
    assert!(!taken[0].variadic);
    // Something to stand at, so it can.
    assert!(!taken[1].required);
    assert_eq!(taken[1].default.as_deref(), Some("staging"));
    // `*extra` is the rest of the line and none of it is needed.
    assert!(taken[2].variadic);
    assert!(!taken[2].required);

    // `+remotes` is the rest of the line and at least one word of it.
    let least = &one(&found, "push").params[0];
    assert!(least.variadic);
    assert!(least.required);
}

/// Two runners in one repository is ordinary, and each of them keeps its own
/// name for the thing it runs.
#[test]
fn a_folder_with_two_runners_answers_for_both() {
    if !installed("task") {
        return;
    }
    let temp = TempDir::new("both");
    temp.holding(
        "Taskfile.yml",
        "version: \"3\"\ntasks:\n  check:\n    cmds:\n      - echo check\n",
    );
    temp.holding("Makefile", "check: ## Make's own check\n\techo check\n");

    let found = everything(temp.path());
    let runners: Vec<&str> = found
        .iter()
        .filter(|task| task.name == "check")
        .map(|task| task.runner)
        .collect();

    assert!(runners.contains(&"task"), "found: {found:?}");
    assert!(runners.contains(&"make"), "found: {found:?}");
}

/// A folder with none of the four in it is a folder with nothing to run, and
/// nothing is asked of anything to find that out.
#[test]
fn a_folder_holding_no_runner_says_nothing() {
    let temp = TempDir::new("empty");
    temp.holding("README.md", "Nothing to run in here.\n");

    assert_eq!(everything(temp.path()), Vec::new());
}

fn names(taken: &[super::super::Param]) -> Vec<&str> {
    taken.iter().map(|param| param.name.as_str()).collect()
}

fn named<'a>(found: &'a [Task], name: &str) -> Option<&'a Task> {
    found.iter().find(|task| task.name == name)
}

fn one<'a>(found: &'a [Task], name: &str) -> &'a Task {
    named(found, name).unwrap_or_else(|| panic!("no {name} among {found:?}"))
}
