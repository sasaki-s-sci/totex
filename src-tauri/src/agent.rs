//! One turn of a coding agent, run to completion.
//!
//! The window's chat panel is a conversation; the CLI underneath it is not — it
//! is a command that answers once and exits. So one message here is one whole
//! run of the agent, and the agent's own session store is what carries the
//! thread between them. Nothing about the conversation is kept on this side.
//!
//! The command goes through the user's login shell rather than being spawned
//! directly. A window started from the desktop inherits none of the profile,
//! and these agents live wherever their installer put them — `~/.local/bin`,
//! a version manager's shims — so looking them up any other way finds nothing.

use std::collections::HashMap;
use std::io::Read;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, Runtime};

use crate::stream::Chunk;

/// Carries a chunk of a run's output to the window.
const DATA_EVENT: &str = "agent:data";
/// Carries the run that has finished, and whether it worked.
const EXIT_EVENT: &str = "agent:exit";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Ended {
    id: String,
    ok: bool,
    code: Option<i32>,
}

#[derive(Default)]
pub struct AgentState {
    runs: Mutex<HashMap<String, Child>>,
}

impl AgentState {
    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<String, Child>> {
        crate::sync::lock(&self.runs)
    }
}

// ---------------------------------------------------------------- the shell

/// One argument, as the shell has to read it to get it back unchanged.
#[cfg(not(windows))]
fn quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

#[cfg(windows)]
fn quote(value: &str) -> String {
    format!("\"{}\"", value.replace('"', "\"\""))
}

/// The command line, as a shell would read it.
fn line(program: &str, args: &[String]) -> String {
    let mut rendered = String::from(program);
    for arg in args {
        rendered.push(' ');
        rendered.push_str(&quote(arg));
    }
    rendered
}

/// A login shell running one command, which is where the agent is found.
#[cfg(not(windows))]
fn shell_command(line: &str) -> Command {
    let mut command = Command::new(crate::pty::shell());
    // Separate flags rather than `-lc`: not every shell bundles short options.
    command.arg("-l").arg("-c").arg(line);
    command
}

#[cfg(windows)]
fn shell_command(line: &str) -> Command {
    use std::os::windows::process::CommandExt;

    let mut command = Command::new("cmd");
    command.arg("/C").arg(line);
    // Without this the shell flashes up a console window of its own.
    command.creation_flags(0x0800_0000);
    command
}

// ---------------------------------------------------------------- streaming

/// Forwards everything one pipe says, until it says nothing more.
///
/// What an agent writes it writes a token at a time, so the reading is left to
/// `stream`, which gathers a frame of it before handing any of it over.
fn pump<R: Runtime>(
    app: AppHandle<R>,
    id: String,
    source: impl Read + Send + 'static,
) -> std::thread::JoinHandle<()> {
    crate::stream::pump(source, move |data| {
        app.emit(
            DATA_EVENT,
            Chunk {
                id: id.clone(),
                data,
            },
        )
        .is_ok()
    })
}

// ---------------------------------------------------------------- commands

/// Runs one turn of an agent in `cwd`, under the name `id`.
///
/// Returns as soon as the process is up. What it says arrives on `agent:data`
/// as it is said — an agent produces nothing for a minute and then a screenful
/// — and `agent:exit` says it is done.
#[tauri::command]
pub fn agent_send<R: Runtime>(
    app: AppHandle<R>,
    id: String,
    cwd: String,
    program: String,
    args: Vec<String>,
) -> Result<(), String> {
    let state = app.state::<AgentState>();
    if state.lock().contains_key(&id) {
        return Err("busy".to_string());
    }

    let mut child = shell_command(&line(&program, &args))
        .current_dir(&cwd)
        // Nothing to type at: this is a run, not a session. An agent that asks
        // would otherwise wait on a terminal that is never coming.
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| error.to_string())?;

    let stdout = child.stdout.take().ok_or_else(|| "no-output".to_string())?;
    let stderr = child.stderr.take().ok_or_else(|| "no-output".to_string())?;

    // Handed over before anything is watching it: a command that is not there
    // exits before the next line runs, and a run put into the map after its own
    // end would sit there forever refusing the next message.
    state.lock().insert(id.clone(), child);

    let handle = app.clone();
    let name = id;
    std::thread::spawn(move || {
        let out = pump(handle.clone(), name.clone(), stdout);
        let err = pump(handle.clone(), name.clone(), stderr);
        let _ = out.join();
        let _ = err.join();

        // Taken back out here so that `agent_cancel` has something to kill for
        // as long as the run is going, and nothing to kill once it is not.
        let mut taken = None;
        if let Some(state) = handle.try_state::<AgentState>() {
            taken = state.lock().remove(&name);
        }
        // Nothing to wait on means it was already taken away and killed, which
        // is what a cancelled run looks like from here.
        let code = taken.and_then(|mut child| child.wait().ok().and_then(|status| status.code()));

        let _ = handle.emit(
            EXIT_EVENT,
            Ended {
                id: name,
                ok: code == Some(0),
                code,
            },
        );
    });

    Ok(())
}

/// Stops a run that is still going. Doing it to a finished one is a no-op.
///
/// Kills the shell, which — having exec'd the agent over itself, as a shell
/// running one command does — is the agent.
#[tauri::command]
pub fn agent_cancel<R: Runtime>(app: AppHandle<R>, id: String) {
    let taken = app.state::<AgentState>().lock().remove(&id);
    if let Some(mut child) = taken {
        let _ = child.kill();
        let _ = child.wait();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_argument_survives_the_shell_unchanged() {
        // The prompt is whatever was typed, quotes and all, and the shell must
        // hand it to the agent as one word.
        let rendered = line("claude", &["-p".to_string(), "it's \"fine\"".to_string()]);
        assert!(rendered.starts_with("claude "));
        assert!(rendered.contains("-p"));
        assert!(
            !rendered.contains("it's \"fine\""),
            "quoted nothing: {rendered}"
        );
    }

    #[cfg(unix)]
    #[test]
    fn the_shell_reads_back_exactly_what_was_quoted() {
        let awkward = "a 'b' \"c\" $d `e` \\f";
        let rendered = line("printf", &["%s".to_string(), awkward.to_string()]);
        let output = Command::new("/bin/sh")
            .arg("-c")
            .arg(&rendered)
            .output()
            .expect("run the shell");
        assert_eq!(String::from_utf8_lossy(&output.stdout), awkward);
    }
}
