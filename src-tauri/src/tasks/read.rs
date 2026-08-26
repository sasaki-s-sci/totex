//! The four runners, and what each of them is asked.
//!
//! Three of them answer in JSON and are asked in their own words, because a
//! runner is the only thing that knows the whole of its own file — what an
//! import pulled in, which recipe this platform gets, what is private. The
//! fourth has nothing to ask: `make` has never had a way to say what it can do,
//! so its file is read instead, for the one shape a Makefile written to be read
//! by a person already has.

use std::collections::HashSet;
use std::path::Path;

use serde_json::Value;

use super::ask;
use super::{Param, Task};
use crate::host::Host;

/// What says a folder is a mise project. The directories are in the list
/// because a config can be a file inside one of them, and `.config` is because
/// `.config/mise.toml` is a place mise looks — a folder that has one for some
/// other reason costs one question that comes back empty.
const MISE: [&str; 9] = [
    "mise.toml",
    ".mise.toml",
    "mise.local.toml",
    ".mise.local.toml",
    "mise",
    ".mise",
    "mise-tasks",
    ".mise-tasks",
    ".config",
];

/// Every name Task will open, in any of the spellings it takes.
const TASKFILE: [&str; 6] = [
    "Taskfile.yml",
    "Taskfile.yaml",
    "taskfile.yml",
    "taskfile.yaml",
    "Taskfile.dist.yml",
    "Taskfile.dist.yaml",
];

const JUSTFILE: [&str; 4] = ["justfile", ".justfile", "Justfile", "JUSTFILE"];

/// In the order make itself reads them, which is the order the first one found
/// is the one that counts.
const MAKEFILE: [&str; 3] = ["GNUmakefile", "makefile", "Makefile"];

/// Everything the four say, each runner's list whole and in this order.
///
/// The order is the answer to two runners in one repository: a list that
/// interleaved them by name would be a list where the eye has to check the mark
/// beside every row. mise first because a repository that has one usually has
/// it standing in front of the others.
pub fn everything(dir: &Path) -> Vec<Task> {
    let host = Host::of(dir);
    // One reading of the directory, and every question about what is in it
    // answered out of that. Asked one name at a time this would be twenty
    // crossings, and inside a distribution every one of them is a process.
    let held = names(&host, dir);

    // The three that are asked in their own words are asked at once. Each is a
    // login shell starting, and three of those in a row is most of what stands
    // between the key being pressed and the list being drawn.
    let (mise, taskfile, justfile) = std::thread::scope(|scope| {
        let mise = scope.spawn(|| asked(&held, &MISE, || mise(dir)));
        let taskfile = scope.spawn(|| asked(&held, &TASKFILE, || taskfile(dir)));
        let justfile = scope.spawn(|| asked(&held, &JUSTFILE, || justfile(dir)));
        (
            mise.join().unwrap_or_default(),
            taskfile.join().unwrap_or_default(),
            justfile.join().unwrap_or_default(),
        )
    });

    let mut found = mise;
    found.extend(taskfile);
    found.extend(justfile);
    found.extend(makefile(&host, dir, &held));
    found
}

/// mise, which is asked for its tasks and answers with the whole of each one.
///
/// Its own and not everybody's: a task from the config in somebody's home
/// directory is a task in every repository they open, and what is being drawn
/// here is what this repository says. Hidden ones are hidden for the same
/// reason a private recipe is — they are steps other tasks depend on.
fn mise(dir: &Path) -> Vec<Task> {
    let Some(listed) = ask::say(dir, "mise tasks ls --json")
        .as_deref()
        .and_then(json)
    else {
        return Vec::new();
    };
    let Some(tasks) = listed.as_array() else {
        return Vec::new();
    };

    tasks
        .iter()
        .filter(|task| !flag(task, "hide") && !flag(task, "global"))
        .filter_map(|task| {
            let name = task["name"].as_str()?;
            Some(Task {
                runner: "mise",
                name: name.to_string(),
                about: said(task, "description"),
                line: format!("mise run {name}"),
                // mise says what a task takes in a spec of its own, kept as the
                // text somebody wrote rather than as anything to read. Nothing
                // is claimed about it here.
                params: Vec::new(),
            })
        })
        .collect()
}

/// Task, which is asked for all of them rather than for the ones with a
/// description: a task nobody described is still a task somebody wrote to run.
fn taskfile(dir: &Path) -> Vec<Task> {
    let Some(listed) = ask::say(dir, "task --list-all --json")
        .as_deref()
        .and_then(json)
    else {
        return Vec::new();
    };
    let Some(tasks) = listed["tasks"].as_array() else {
        return Vec::new();
    };

    tasks
        .iter()
        .filter_map(|task| {
            let name = task["name"].as_str()?;
            Some(Task {
                runner: "task",
                name: name.to_string(),
                about: said(task, "desc"),
                line: format!("task {name}"),
                // A Taskfile says what a task needs with `requires: vars:`, and
                // says none of it in what Task will list. Nothing to read.
                params: Vec::new(),
            })
        })
        .collect()
}

/// just, which will hand over the whole justfile as it understood it.
///
/// Worth asking for over the listing it prints for a person: the dump has
/// already chosen between the recipes written twice for two platforms, and it
/// says which are private rather than leaving them out of a list and in the
/// file. A just too old to dump JSON still knows the one thing that matters.
fn justfile(dir: &Path) -> Vec<Task> {
    if let Some(dumped) = ask::say(dir, "just --dump --dump-format json")
        .as_deref()
        .and_then(json)
        && let Some(recipes) = dumped["recipes"].as_object()
    {
        return recipes
            .values()
            .filter(|recipe| !flag(recipe, "private"))
            .filter_map(|recipe| {
                // The path through the modules to it, which is what it is
                // called on the command line. Its own name for a justfile with
                // no modules in it, where the two are the same word.
                let name = recipe["namepath"]
                    .as_str()
                    .or_else(|| recipe["name"].as_str())?;
                Some(Task {
                    runner: "just",
                    name: name.to_string(),
                    about: said(recipe, "doc"),
                    line: format!("just {name}"),
                    params: parameters(recipe),
                })
            })
            .collect();
    }

    let Some(summary) = ask::say(dir, "just --summary") else {
        return Vec::new();
    };
    summary
        .split_whitespace()
        .map(|name| Task {
            runner: "just",
            name: name.to_string(),
            about: String::new(),
            line: format!("just {name}"),
            // The summary is names and nothing else, which is the whole of why
            // it is the fallback rather than the way this is read.
            params: Vec::new(),
        })
        .collect()
}

/// What one recipe takes, in the order just passes them.
///
/// just is the only one of the four that says. A parameter with nothing to
/// stand at is one the recipe cannot run without — which is what turns Return
/// on that row into a question instead of a command — and the two variadic
/// kinds are the difference between "the rest of the line" and "at least one
/// word of it".
fn parameters(recipe: &Value) -> Vec<Param> {
    let Some(taken) = recipe["parameters"].as_array() else {
        return Vec::new();
    };

    taken
        .iter()
        .filter_map(|param| {
            let name = param["name"].as_str()?;
            let kind = param["kind"].as_str().unwrap_or("singular");
            let default = param["default"].as_str().map(str::to_string);
            Some(Param {
                name: name.to_string(),
                about: said(param, "help"),
                // `*name` stands at nothing and needs nothing, which is not the
                // same as standing at the empty string.
                required: default.is_none() && kind != "star",
                default,
                variadic: kind == "plus" || kind == "star",
            })
        })
        .collect()
}

/// make, which is read rather than asked.
///
/// Asking would mean `make -p`, which builds the whole database — and building
/// it runs every `$(shell …)` in the file, which is a scan that can write to
/// the checkout. Reading finds less: nothing from an `include`, and nothing
/// whose name a variable has to be expanded to know. What it does find is every
/// target somebody typed out, which is every target anybody types in.
fn makefile(host: &Host, dir: &Path, held: &HashSet<String>) -> Vec<Task> {
    let Some(name) = MAKEFILE.iter().find(|name| held.contains(**name)) else {
        return Vec::new();
    };
    let Ok(text) = host.read(&host.join(dir, name)) else {
        return Vec::new();
    };
    targets(&String::from_utf8_lossy(&text))
}

/// Every target a Makefile spells out, in the order it spells them: the first
/// one is the one `make` on its own runs, which is worth keeping at the top.
pub fn targets(text: &str) -> Vec<Task> {
    let mut found: Vec<Task> = Vec::new();

    for line in text.lines() {
        // A recipe belongs to the target above it, and a tab is the whole of
        // what says so — the one place in the language where the character
        // matters. Anything indented here is somebody else's line.
        if line.starts_with('\t') || line.starts_with(' ') {
            continue;
        }
        let line = line.trim_end();
        if line.starts_with('#') {
            continue;
        }

        let Some(colon) = line.find(':') else {
            continue;
        };
        let (names, rest) = line.split_at(colon);
        // `x := y` and `x ::= y` are the same line shape with none of the
        // meaning, and so is anything with an `=` before the colon.
        if rest.starts_with(":=") || rest.starts_with("::=") || names.contains('=') {
            continue;
        }

        let about = about(rest);
        for name in names.split_whitespace() {
            if !runnable(name) || found.iter().any(|task| task.name == name) {
                continue;
            }
            found.push(Task {
                runner: "make",
                name: name.to_string(),
                about: about.clone(),
                line: format!("make {name}"),
                // A Makefile is given variables rather than arguments, and
                // never says which ones it wants.
                params: Vec::new(),
            });
        }
    }

    found
}

/// Whether a target is one somebody would type.
fn runnable(name: &str) -> bool {
    !name.is_empty()
        // `.PHONY` and the rest of make's own targets, which say how the file
        // works rather than what it can do.
        && !name.starts_with('.')
        // A pattern rule is how a kind of file is made, not a name to type.
        && !name.contains('%')
        // And a name that has to be expanded to be known is not one this can
        // read without running the file to find out.
        && !name.contains('$')
}

/// What a rule says it is for.
///
/// The `##` after the prerequisites: the convention a Makefile with a `help`
/// target in it already follows, because that target is a `grep` for exactly
/// this. A file that does not follow it says nothing, which is the truth.
fn about(rest: &str) -> String {
    rest.split_once("##")
        .map(|(_, said)| said.trim().to_string())
        .unwrap_or_default()
}

/// The names directly inside a directory, or none of them when it cannot be
/// read — which for this is the same answer as a folder holding no runner.
fn names(host: &Host, dir: &Path) -> HashSet<String> {
    host.read_dir(dir)
        .map(|children| children.into_iter().map(|child| child.name).collect())
        .unwrap_or_default()
}

/// Asks a runner what it can run, but only where the folder says it is one of
/// its own: a runner asked in a folder it has nothing to do with is a login
/// shell started for an answer that was already known.
fn asked(held: &HashSet<String>, wanted: &[&str], ask: impl Fn() -> Vec<Task>) -> Vec<Task> {
    if wanted.iter().any(|name| held.contains(*name)) {
        ask()
    } else {
        Vec::new()
    }
}

/// The first JSON value in what a program said.
///
/// Not the whole of what it said: this went through a login shell, and a login
/// shell is free to print a banner, a version notice, or whatever somebody put
/// at the end of their profile. So the reading starts where JSON starts and
/// stops where the value ends, and whatever is around it is not read at all.
fn json(said: &str) -> Option<Value> {
    let start = said.find(['[', '{'])?;
    serde_json::Deserializer::from_str(&said[start..])
        .into_iter::<Value>()
        .next()?
        .ok()
}

/// One field of a runner's answer, as words. Absent reads as nothing said.
fn said(value: &Value, field: &str) -> String {
    value[field].as_str().unwrap_or_default().trim().to_string()
}

/// One field of a runner's answer, as a yes. Absent reads as no.
fn flag(value: &Value, field: &str) -> bool {
    value[field].as_bool().unwrap_or(false)
}
