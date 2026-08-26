//! What a repository says can be run in it.
//!
//! Four runners and no format of our own: mise, Task, just and make each keep
//! the commands for a project in a file beside the project, and this reads
//! those. A folder is asked what it holds, whichever of the four are there are
//! asked what they can run, and what comes back is a list of lines to type.
//!
//! Lines, and not runs. Nothing here starts anything: a task is a command
//! somebody would have typed into the terminal that is already open in that
//! directory, and it is typed into one — see `useTaskKeys` and `pty_write`.
//! What that buys is that every one of these behaves in the window exactly as
//! it behaves in a shell, prompts and colour and Ctrl-C and all.
//!
//! Asked of a directory rather than of the machine. These files live in the
//! checkout, so two worktrees of one project answer the same, a folder with
//! none of them answers with nothing, and a folder inside a distribution is
//! asked by the runners installed in there.

mod ask;
mod read;

#[cfg(test)]
mod tests;

use std::path::Path;

use serde::Serialize;

/// One thing a repository says can be run in it.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    /// Which of the four said so: `mise`, `task`, `just` or `make`. The only
    /// thing drawn beside a name, because two runners in one repository is
    /// ordinary and `check` under one of them is not `check` under the other.
    pub runner: &'static str,
    pub name: String,
    /// What the file says it is for, empty where it says nothing — which is
    /// most Makefile targets and every recipe nobody wrote a line above.
    pub about: String,
    /// The line that runs it, exactly as it would be typed. What a task takes
    /// goes on the end of it — see `Param` and `runLine` on the window's side.
    pub line: String,
    /// What it takes, where its runner says so and in the order they are
    /// passed. Empty for a task that takes nothing, and empty for the three
    /// runners that have no way to say — see `read::justfile`.
    pub params: Vec<Param>,
}

/// One thing a task is given when it is run.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Param {
    pub name: String,
    /// What the file says it is for, empty where it says nothing.
    pub about: String,
    /// What it stands at when nothing is given, or None where there is nothing
    /// to stand at — which for a required one is the whole of what makes it so.
    pub default: Option<String>,
    /// Whether it takes the rest of the line rather than one word.
    pub variadic: bool,
    /// Whether the task cannot be run without it, which is the one thing here
    /// that changes what a press does: Return on a task that is missing one
    /// asks for it instead of running.
    pub required: bool,
}

/// Everything the runners in `path` say can be run there.
///
/// Never an error. A runner that is not installed, a file that will not parse,
/// a folder that is not there at all: each of them is nothing to run rather
/// than something to explain, and a list that came back empty says the same
/// thing in the one place it would have been read.
#[tauri::command(async)]
pub fn directory_tasks(path: String) -> Vec<Task> {
    read::everything(Path::new(&path))
}
