//! A shell, running in a directory the window picked.
//!
//! The window draws the terminal; this owns the process. Each session is a
//! pseudo-terminal so the shell believes it has one — without that, a prompt
//! never appears and anything interactive hangs waiting for a tty.
//!
//! The process belongs to whoever opened the session and not to whatever is
//! drawing it: a shell is running from the moment it is asked for, whether or
//! not a terminal has been built for it, and it carries on while the panel is
//! showing something else. So what it says is kept here as well as sent — a
//! terminal built late, or built again, is handed everything it missed instead
//! of coming up blank in front of a live shell.
//!
//! Output is pushed to the window rather than polled, because a shell produces
//! nothing for minutes and then a screenful at once — and it is gathered on the
//! way by `stream`, because the screenful arrives a few bytes at a time.

use std::collections::HashMap;
use std::io::Write;
use std::path::Path;
use std::sync::{Arc, Mutex};

use portable_pty::{Child, CommandBuilder, MasterPty, PtySize, native_pty_system};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, Runtime};

use crate::ask::{Ask, Watcher};
use crate::host::Host;
use crate::wsl;

/// Carries a run of a session's output to the window.
const DATA_EVENT: &str = "pty:data";
/// Carries the session that has ended, so the window can say so.
const EXIT_EVENT: &str = "pty:exit";
/// Carries what a session is asking, and its going away again.
///
/// Sent whether or not a terminal is being drawn for the session: a question is
/// asked of the person at the window, not of the panel, and the graph is where
/// the window has to be able to see it and answer it.
const ASK_EVENT: &str = "pty:ask";

/// How much of what a session has said is kept for a terminal that is not there
/// yet.
///
/// A screenful is a couple of kilobytes, so this is a few hundred of them: what
/// a shell left alone for an hour has to be able to show when it is finally
/// looked at. Anything older is dropped rather than held forever — this is a
/// window's scrollback, not a log of the session.
const KEPT: usize = 256 * 1024;

/// How far past that it may grow before it is cut back.
///
/// Cutting on every run of output would copy the whole backlog per keystroke;
/// cutting once the slack is used up is one copy per screenful of it.
const SLACK: usize = 64 * 1024;

/// What a session has said, and how much of it there has ever been.
#[derive(Default)]
struct Backlog {
    /// The tail of the output — all of it, until there is too much.
    text: String,
    /// Everything the session has ever said, in bytes, of which `text` holds
    /// the last `text.len()`. This is what tells a terminal which of the runs
    /// arriving live are already inside the text it was just handed.
    said: usize,
}

impl Backlog {
    /// Keeps a run of output, and says where it falls in the whole of it.
    fn keep(&mut self, data: &str) -> usize {
        let at = self.said;
        self.said += data.len();
        self.text.push_str(data);
        if self.text.len() > KEPT + SLACK {
            let cut = self.cut();
            self.text.drain(..cut);
        }
        at
    }

    /// Where the kept text begins once it has outgrown its room: a whole
    /// character, and the start of a line wherever one is near enough.
    ///
    /// Replaying from the middle of an escape sequence draws it as the letters
    /// it is written with, so the cut moves on to the next line whenever the
    /// slack holds one — which, for anything a shell prints, it does.
    fn cut(&self) -> usize {
        let mut at = self.text.len() - KEPT;
        while at < self.text.len() && !self.text.is_char_boundary(at) {
            at += 1;
        }
        match self.text[at..].find('\n') {
            Some(line) if line <= SLACK => at + line + 1,
            _ => at,
        }
    }
}

/// A run of output, addressed to the session that said it.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Said {
    id: String,
    data: String,
    /// How much the session had said before this run, which is how a terminal
    /// that has just been handed the backlog knows this is not in it.
    seq: usize,
}

/// What a session is asking, or — with nothing in it — that it has stopped.
///
/// Addressed to the session rather than to a terminal, like everything else
/// here: the question belongs to the process, and the marks that draw it are
/// wherever the graph happens to be drawing that process.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Asking {
    id: String,
    ask: Option<Ask>,
}

/// What a session has said so far, for a terminal that has just attached.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Held {
    text: String,
    /// How far `text` reaches into everything the session has said.
    upto: usize,
}

/// One running shell. The master is kept so the session can be resized.
struct Session {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn Child + Send + Sync>,
    /// Whether a Bourne shell is at the other end, which is what a line typed
    /// at it has to be quoted for. Not a property of this platform: a window on
    /// Windows opens a PowerShell for a Windows folder and a Linux login shell
    /// for one inside a distribution, and the two read a quote differently.
    posix: bool,
    /// Shared with the thread reading the pty, which fills it whether or not
    /// there is a window at the other end of the event.
    said: Arc<Mutex<Backlog>>,
    /// The session's screen, and whatever question is standing on it.
    ///
    /// Shared with the same thread and for the same reason: an agent asks when
    /// it asks, and a window that only followed the sessions somebody happened
    /// to have open would miss exactly the questions worth carrying — the ones
    /// nobody is sitting in front of.
    watch: Arc<Mutex<Watcher>>,
}

#[derive(Default)]
pub struct PtyState {
    sessions: Mutex<HashMap<String, Session>>,
}

impl PtyState {
    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<String, Session>> {
        crate::sync::lock(&self.sessions)
    }
}

/// The shell to run. Whatever the user has chosen, falling back to something
/// every platform is known to have.
///
/// The agent side runs its one-shot turns through a login shell of the same
/// name, so this is the one answer to "which shell" the app has.
pub(crate) fn shell() -> String {
    #[cfg(windows)]
    let fallback = "powershell.exe";
    #[cfg(not(windows))]
    let fallback = "/bin/sh";

    std::env::var("SHELL")
        .ok()
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| fallback.to_string())
}

/// The command a session runs, and what kind of shell it will be.
///
/// A folder inside a WSL distribution gets that distribution's own login shell,
/// started inside it. Not the share: `cmd` refuses a UNC directory to run in,
/// PowerShell in one is a Windows shell looking at Linux files, and the tools
/// somebody opens a terminal to reach — the agents, the language runtimes — are
/// installed in the distribution and not beside the window.
fn session_command(cwd: &str) -> (CommandBuilder, bool) {
    match Host::of_str(cwd) {
        Host::Local => {
            let mut command = CommandBuilder::new(shell());
            command.cwd(cwd);
            // A shell started outside a terminal emulator inherits no answer
            // for this, and without one it falls back to a dumb terminal with
            // no colour.
            command.env("TERM", "xterm-256color");
            (command, !cfg!(windows))
        }
        Host::Wsl(distro) => {
            let host = Host::Wsl(distro.clone());
            let mut command = CommandBuilder::new(wsl::program());
            command.arg("-d");
            command.arg(&distro);
            command.arg("--cd");
            command.arg(host.native(Path::new(cwd)));
            // `wsl.exe` with nothing to run starts the user's login shell.
            command.env("TERM", "xterm-256color");
            // The one way a variable crosses into a distribution: `WSLENV`
            // names which of them to carry, and `/u` says this direction only.
            command.env("WSLENV", carried("TERM/u"));
            (command, true)
        }
    }
}

/// `WSLENV` with one more name on it, keeping whatever was already there.
fn carried(name: &str) -> String {
    match std::env::var("WSLENV") {
        Ok(existing) if !existing.trim().is_empty() => format!("{existing}:{name}"),
        _ => name.to_string(),
    }
}

/// Starts a shell in `cwd` under the name `id`, and leaves it running.
///
/// Idempotent, so opening a session and attaching a terminal to one both call
/// this and neither has to know which of the two it is doing. The map is held
/// for the whole of it rather than looked at and then written to: two of these
/// arriving together for the same id would otherwise both find nothing and both
/// spawn a shell, and the one that lost the race would be a process nothing can
/// reach, nothing can close, and nothing will ever read.
#[tauri::command]
pub fn pty_open<R: Runtime>(
    app: AppHandle<R>,
    id: String,
    cwd: String,
    rows: u16,
    cols: u16,
) -> Result<(), String> {
    let state = app.state::<PtyState>();
    let mut sessions = state.lock();
    if sessions.contains_key(&id) {
        return Ok(());
    }

    let pty = native_pty_system()
        .openpty(PtySize {
            rows: rows.max(1),
            cols: cols.max(1),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|error| error.to_string())?;

    let (command, posix) = session_command(&cwd);

    let child = pty
        .slave
        .spawn_command(command)
        .map_err(|error| error.to_string())?;
    let writer = pty
        .master
        .take_writer()
        .map_err(|error| error.to_string())?;
    let reader = pty
        .master
        .try_clone_reader()
        .map_err(|error| error.to_string())?;

    // Reading blocks until the shell says something, so it happens away from
    // here — and what it says is gathered before it crosses to the window,
    // because a shell under a stream hands over a character at a time.
    let handle = app.clone();
    let name = id.clone();
    let sending = handle.clone();
    let sending_name = name.clone();
    let said = Arc::new(Mutex::new(Backlog::default()));
    let keeping = Arc::clone(&said);
    let watch = Arc::new(Mutex::new(Watcher::new(rows.max(1), cols.max(1))));
    let watching = Arc::clone(&watch);
    let reading = crate::stream::pump(reader, move |data| {
        // Kept before it is sent, and kept whether or not anybody is there to
        // send it to. This is the whole of what makes the session a process
        // rather than a panel: the prompt a shell prints in the moment between
        // being started and being drawn is waiting in here when the terminal
        // finally asks for it.
        let seq = crate::sync::lock(&keeping).keep(&data);
        // Followed as it goes past, which is the only place a question exists:
        // a terminal is a stream of bytes for drawing with, and what the agent
        // is asking is a shape on the screen those bytes draw. Only a change is
        // sent on — an agent writing a paragraph says nothing about any
        // question, and that is nearly all of the output there ever is.
        if let Some(ask) = crate::sync::lock(&watching).keep(&data) {
            let _ = sending.emit(
                ASK_EVENT,
                Asking {
                    id: sending_name.clone(),
                    ask,
                },
            );
        }
        sending
            .emit(
                DATA_EVENT,
                Said {
                    id: sending_name.clone(),
                    data,
                    seq,
                },
            )
            .is_ok()
    });
    std::thread::spawn(move || {
        let _ = reading.join();
        let _ = handle.emit(EXIT_EVENT, name.clone());
        // The window is not coming back for it, so the session is dropped here
        // rather than waiting for a close that will never be asked for.
        if let Some(state) = handle.try_state::<PtyState>() {
            state.lock().remove(&name);
        }
    });

    sessions.insert(
        id,
        Session {
            master: pty.master,
            writer,
            child,
            posix,
            said,
            watch,
        },
    );
    Ok(())
}

/// Everything a session has said that is still kept, for a terminal that has
/// just been built for it.
///
/// `None` when there is no such session — it was never started, or it has ended
/// and the window has not caught up with the exit yet. Either way there is
/// nothing here to attach to.
///
/// What comes back is read alongside the event: a terminal registers for the
/// live output first and asks for this second, so a run that lands between the
/// two arrives twice rather than not at all — and `upto` is how the terminal
/// tells which one that was.
#[tauri::command]
pub fn pty_attach<R: Runtime>(app: AppHandle<R>, id: String) -> Option<Held> {
    let state = app.state::<PtyState>();
    let sessions = state.lock();
    let session = sessions.get(&id)?;
    let said = crate::sync::lock(&session.said);
    Some(Held {
        text: said.text.clone(),
        upto: said.said,
    })
}

/// Sends what was typed. Keystrokes, not lines: the shell does the editing.
#[tauri::command]
pub fn pty_write<R: Runtime>(app: AppHandle<R>, id: String, data: String) -> Result<(), String> {
    let state = app.state::<PtyState>();
    let mut sessions = state.lock();
    let session = sessions.get_mut(&id).ok_or("no-session")?;
    session
        .writer
        .write_all(data.as_bytes())
        .map_err(|error| error.to_string())?;
    session.writer.flush().map_err(|error| error.to_string())
}

/// Types a command at the shell, quoted the way this platform's shell reads it.
///
/// Separate from `pty_write` because quoting is not the window's business: what
/// a shell needs to see to get one argument back unchanged differs between
/// `sh` and PowerShell, and the window would have to know which one is at the
/// other end of the pty to say it. Still typed rather than run for us — it is
/// echoed like anything typed, and a rerun is one arrow key away.
#[tauri::command]
pub fn pty_run<R: Runtime>(app: AppHandle<R>, id: String, argv: Vec<String>) -> Result<(), String> {
    let Some((program, args)) = argv.split_first() else {
        return Ok(());
    };
    let posix = {
        let state = app.state::<PtyState>();
        let sessions = state.lock();
        sessions.get(&id).ok_or("no-session")?.posix
    };

    let mut line = program.clone();
    for arg in args {
        line.push(' ');
        line.push_str(&quote(arg, posix));
    }
    line.push('\n');
    pty_write(app, id, line)
}

/// One argument, as the shell running in the pty has to read it.
///
/// The pty runs the user's own login shell, not the one a command is spawned
/// through — so this is not `agent::quote`, which quotes for `sh -c` and `cmd
/// /C`. Single quotes in both dialects, because what is being quoted here is a
/// person's sentence: `$`, backticks and backslashes all have to come out the
/// far side as themselves. Which dialect is a property of the session and not
/// of the platform: a Windows window opens both kinds.
fn quote(value: &str, posix: bool) -> String {
    if posix {
        // Ending the quoted run, escaping the quote outside it, and opening a
        // new one: the one form every Bourne-family shell, `fish` included,
        // reads back as a single apostrophe.
        format!("'{}'", value.replace('\'', "'\\''"))
    } else {
        // PowerShell, which is what `shell()` falls back to: inside single
        // quotes nothing expands, and a doubled quote is one quote.
        format!("'{}'", value.replace('\'', "''"))
    }
}

/// Tells the shell how much room it has, so that anything full-screen — an
/// editor, a pager — draws to the right size.
#[tauri::command]
pub fn pty_resize<R: Runtime>(
    app: AppHandle<R>,
    id: String,
    rows: u16,
    cols: u16,
) -> Result<(), String> {
    let state = app.state::<PtyState>();
    let sessions = state.lock();
    let Some(session) = sessions.get(&id) else {
        // A resize arriving after the shell exited is not worth an error.
        return Ok(());
    };
    // The screen a question is read off is the shell's own, so it is the same
    // size as the shell's: a box drawn to eighty columns and read against a
    // hundred and twenty is a box with its right-hand side in the middle of a
    // line.
    crate::sync::lock(&session.watch).resize(rows.max(1), cols.max(1));
    session
        .master
        .resize(PtySize {
            rows: rows.max(1),
            cols: cols.max(1),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|error| error.to_string())
}

/// Every question standing right now, for a window that has just come up.
///
/// The event is what carries these from moment to moment; this is the first
/// look, for the same reason the sweep has one — a window that only listened
/// would show nothing until the next time an agent happened to redraw, which
/// for a session sitting on a question is never.
#[tauri::command]
pub fn pty_asking<R: Runtime>(app: AppHandle<R>) -> Vec<Asking> {
    let state = app.state::<PtyState>();
    let sessions = state.lock();
    sessions
        .iter()
        .filter_map(|(id, session)| {
            let ask = crate::sync::lock(&session.watch).asking().cloned()?;
            Some(Asking {
                id: id.clone(),
                ask: Some(ask),
            })
        })
        .collect()
}

/// Answers the question a session is asking, by typing what takes that answer.
///
/// The number is the whole of it: every one of these lists is answered by its
/// own numbers, so this is a keystroke at the agent rather than a walk down the
/// list with the arrow keys — which would depend on where the agent'"'"'s own cursor
/// is standing, and so on a reading that is already a moment old.
///
/// `seq` is what makes that safe. A card is drawn from a question that was on
/// the screen when it was read, and the one thing that must never happen is a
/// press meant for "may I delete this" arriving at whatever the agent went on
/// to ask instead — so an answer names the question it was given for, and is
/// refused outright if that is no longer the one being asked.
#[tauri::command]
pub fn pty_answer<R: Runtime>(
    app: AppHandle<R>,
    id: String,
    seq: u64,
    key: String,
) -> Result<(), String> {
    {
        let state = app.state::<PtyState>();
        let mut sessions = state.lock();
        let session = sessions.get_mut(&id).ok_or("no-session")?;
        // Put away and answered in one go: the question is taken off the graph
        // as the key goes, rather than a redraw later, because the moment
        // between a press and an agent'"'"'s next frame is exactly how long a card
        // that has been answered must not still be standing there.
        if !crate::sync::lock(&session.watch).answered(seq) {
            return Err("asking-something-else".to_string());
        }
        session
            .writer
            .write_all(key.as_bytes())
            .map_err(|error| error.to_string())?;
        session.writer.flush().map_err(|error| error.to_string())?;
    }

    // Said outright rather than left to the next reading: whatever else the
    // window is drawing this session as, the question has been answered.
    let _ = app.emit(ASK_EVENT, Asking { id, ask: None });
    Ok(())
}

/// Ends a session. The reader thread stops on its own once the pty is dropped.
#[tauri::command]
pub fn pty_close<R: Runtime>(app: AppHandle<R>, id: String) {
    if let Some(mut session) = app.state::<PtyState>().lock().remove(&id) {
        let _ = session.child.kill();
        let _ = session.child.wait();
    }
}

#[cfg(test)]
mod tests {
    use std::sync::mpsc;
    use std::time::{Duration, Instant};

    use tauri::Listener;
    use tauri::test::{MockRuntime, mock_builder, mock_context, noop_assets};

    use super::*;

    fn mock_app() -> tauri::App<MockRuntime> {
        mock_builder()
            .manage(PtyState::default())
            .build(mock_context(noop_assets()))
            .expect("mock app")
    }

    /// Collects output until `wanted` shows up, or gives up, answering the one
    /// question a shell asks of the terminal it is starting in.
    ///
    /// A login shell — zsh, and bash under some settings — asks where the
    /// cursor is before it draws its first prompt, and waits for the answer. A
    /// terminal emulator replies; this stands in for one, because without a
    /// reply the shell never reads the line that was typed at it.
    fn wait_answering<R: Runtime>(
        app: &AppHandle<R>,
        id: &str,
        rx: &mpsc::Receiver<String>,
        wanted: &str,
    ) -> String {
        let deadline = Instant::now() + Duration::from_secs(20);
        let mut seen = String::new();
        let mut asked = 0usize;
        while Instant::now() < deadline {
            if let Ok(chunk) = rx.recv_timeout(Duration::from_millis(250)) {
                seen.push_str(&chunk);
                let asks = seen.matches("\u{1b}[6n").count();
                while asked < asks {
                    asked += 1;
                    let _ = pty_write(app.clone(), id.to_string(), "\u{1b}[1;1R".to_string());
                }
                if seen.contains(wanted) {
                    return seen;
                }
            }
        }
        seen
    }

    /// Collects output until `wanted` shows up, or gives up.
    #[cfg(unix)]
    fn wait_for(rx: &mpsc::Receiver<String>, wanted: &str) -> String {
        let deadline = Instant::now() + Duration::from_secs(10);
        let mut seen = String::new();
        while Instant::now() < deadline {
            if let Ok(chunk) = rx.recv_timeout(Duration::from_millis(250)) {
                seen.push_str(&chunk);
                if seen.contains(wanted) {
                    return seen;
                }
            }
        }
        seen
    }

    /// POSIX shell syntax, so it runs where that is what a shell speaks.
    #[cfg(unix)]
    #[test]
    fn a_shell_runs_in_the_directory_it_was_opened_in() {
        let app = mock_app();
        let handle = app.handle().clone();
        let id = "session".to_string();

        let (tx, rx) = mpsc::channel();
        handle.listen(DATA_EVENT, move |event| {
            if let Ok(chunk) = serde_json::from_str::<serde_json::Value>(event.payload())
                && let Some(data) = chunk.get("data").and_then(|value| value.as_str())
            {
                let _ = tx.send(data.to_string());
            }
        });

        let dir = std::env::temp_dir();
        let canonical = dir.canonicalize().unwrap_or(dir.clone());
        // A terminal echoes what is typed, so the marker has to be something
        // only the *answer* can contain — the expanded path, not the command.
        let expected = format!("totex-probe-{}", canonical.display());

        pty_open(
            handle.clone(),
            id.clone(),
            dir.display().to_string(),
            24,
            80,
        )
        .expect("the shell starts");

        // Printing the working directory proves it reached the shell, and the
        // reply coming back at all proves the output is streaming.
        pty_write(
            handle.clone(),
            id.clone(),
            "echo totex-probe-$(pwd)\n".to_string(),
        )
        .expect("the shell takes input");

        let seen = wait_for(&rx, &expected);
        pty_close(handle.clone(), id.clone());

        assert!(
            seen.contains(&expected),
            "the shell did not answer from {}: {seen:?}",
            canonical.display()
        );
    }

    /// The same thing, for a folder that is not on this machine: the session
    /// must be a shell inside the distribution, standing in the Linux directory
    /// the share names — not a Windows shell looking at it over the wire.
    ///
    /// Skipped where there is no WSL to reach, which is every CI machine.
    #[test]
    fn a_session_in_a_distribution_is_that_distribution_s_shell() {
        let Some(distro) = wsl::distros().into_iter().next() else {
            return;
        };
        let app = mock_app();
        let handle = app.handle().clone();
        let id = "inside".to_string();

        let (tx, rx) = mpsc::channel();
        handle.listen(DATA_EVENT, move |event| {
            if let Ok(chunk) = serde_json::from_str::<serde_json::Value>(event.payload())
                && let Some(data) = chunk.get("data").and_then(|value| value.as_str())
            {
                let _ = tx.send(data.to_string());
            }
        });

        pty_open(
            handle.clone(),
            id.clone(),
            wsl::unc(&distro, "/etc"),
            24,
            200,
        )
        .expect("the shell starts");
        // Quoted by this end, so it also proves the line was quoted for the
        // shell that is actually there rather than for this platform's.
        pty_run(
            handle.clone(),
            id.clone(),
            vec!["printf".into(), "totex[%s]".into(), "don't $HOME".into()],
        )
        .expect("the shell takes input");
        let quoted = wait_answering(&handle, &id, &rx, "totex[don't $HOME]");

        pty_write(
            handle.clone(),
            id.clone(),
            "echo totex-at-$(pwd)\n".to_string(),
        )
        .expect("the shell takes input");
        let seen = wait_answering(&handle, &id, &rx, "totex-at-/etc");
        pty_close(handle.clone(), id.clone());

        assert!(
            quoted.contains("totex[don't $HOME]"),
            "the argument did not arrive whole: {quoted:?}"
        );
        assert!(
            seen.contains("totex-at-/etc"),
            "the shell did not answer from inside the distribution: {seen:?}"
        );
    }

    /// What a first message to an agent actually looks like: several lines of
    /// someone's own words, apostrophes and shell metacharacters included. All
    /// of it has to reach the command as one argument.
    #[cfg(unix)]
    #[test]
    fn a_typed_argument_reaches_the_command_whole() {
        let app = mock_app();
        let handle = app.handle().clone();
        let id = "quoting".to_string();

        let (tx, rx) = mpsc::channel();
        handle.listen(DATA_EVENT, move |event| {
            if let Ok(chunk) = serde_json::from_str::<serde_json::Value>(event.payload())
                && let Some(data) = chunk.get("data").and_then(|value| value.as_str())
            {
                let _ = tx.send(data.to_string());
            }
        });

        pty_open(
            handle.clone(),
            id.clone(),
            std::env::temp_dir().display().to_string(),
            24,
            200,
        )
        .expect("the shell starts");

        let message = "don't $HOME `run` \"this\"";
        pty_run(
            handle.clone(),
            id.clone(),
            vec!["printf".into(), "totex[%s]".into(), message.into()],
        )
        .expect("the shell takes input");

        let expected = format!("totex[{message}]");
        let seen = wait_for(&rx, &expected);
        pty_close(handle.clone(), id.clone());

        assert!(
            seen.contains(&expected),
            "the argument did not survive the shell: {seen:?}"
        );
    }

    /// The whole point of the backlog: nothing is listening for the event, and
    /// what the shell said is still there when a terminal finally asks.
    #[cfg(unix)]
    #[test]
    fn a_shell_nobody_is_listening_to_keeps_what_it_said() {
        let app = mock_app();
        let handle = app.handle().clone();
        let id = "unattended".to_string();

        pty_open(
            handle.clone(),
            id.clone(),
            std::env::temp_dir().display().to_string(),
            24,
            80,
        )
        .expect("the shell starts");
        pty_write(handle.clone(), id.clone(), "echo totex-kept\n".to_string())
            .expect("the shell takes input");

        // Asked for the way a terminal built after the fact asks for it, rather
        // than listened for: no handler was ever registered above.
        let deadline = Instant::now() + Duration::from_secs(10);
        let mut held = String::new();
        while Instant::now() < deadline {
            held = pty_attach(handle.clone(), id.clone())
                .expect("a running session has a backlog")
                .text;
            if held.contains("totex-kept") {
                break;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        pty_close(handle.clone(), id.clone());

        assert!(
            held.contains("totex-kept"),
            "nothing was kept for a terminal that was not there: {held:?}"
        );
    }

    /// The whole way through, in one go: a shell draws the box an agent draws,
    /// the window is told what is being asked without anybody having opened a
    /// terminal on it, and the answer is typed back at the session.
    ///
    /// The box is printed rather than an agent run, because what is being
    /// tested is the road between the two — the pty, the screen the output is
    /// followed into, the event, and the answer going the other way. What an
    /// agent actually draws is `ask`'s own business, and is tested there.
    #[cfg(unix)]
    #[test]
    fn a_question_drawn_in_a_session_reaches_the_window_and_is_answered() {
        let app = mock_app();
        let handle = app.handle().clone();
        let id = "asking".to_string();

        // A login shell asks where the cursor is before it draws its prompt and
        // waits for the answer; nothing it is told to do happens until it has
        // one. See `wait_answering`, which does the same for the tests above.
        let answering = handle.clone();
        let answering_id = id.clone();
        handle.listen(DATA_EVENT, move |event| {
            if let Ok(chunk) = serde_json::from_str::<serde_json::Value>(event.payload())
                && let Some(data) = chunk.get("data").and_then(|value| value.as_str())
                && data.contains("\u{1b}[6n")
            {
                let _ = pty_write(
                    answering.clone(),
                    answering_id.clone(),
                    "\u{1b}[1;1R".to_string(),
                );
            }
        });

        let (tx, rx) = mpsc::channel();
        handle.listen(ASK_EVENT, move |event| {
            let _ = tx.send(event.payload().to_string());
        });

        pty_open(
            handle.clone(),
            id.clone(),
            std::env::temp_dir().display().to_string(),
            24,
            80,
        )
        .expect("the shell starts");

        // Drawn and then left standing: a question is the last thing on the
        // screen, which is the whole of what tells one from a list somebody
        // wrote. The sleep is what keeps the shell from printing its next
        // prompt underneath.
        let drawn = [
            "\u{256d}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{256e}\\n",
            "\u{2502} Bash command \u{2502}\\n",
            "\u{2502}              \u{2502}\\n",
            "\u{2502}   ls -la      \u{2502}\\n",
            "\u{2502}              \u{2502}\\n",
            "\u{2502} Proceed?     \u{2502}\\n",
            "\u{2502} \u{276f} 1. Yes     \u{2502}\\n",
            "\u{2502}   2. No      \u{2502}\\n",
            "\u{2570}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{256f}\\n",
        ]
        .concat();
        pty_write(
            handle.clone(),
            id.clone(),
            format!("printf '{drawn}'; sleep 30\n"),
        )
        .expect("the shell takes input");

        let deadline = Instant::now() + Duration::from_secs(20);
        let mut asked = None;
        while Instant::now() < deadline {
            let Ok(payload) = rx.recv_timeout(Duration::from_millis(250)) else {
                continue;
            };
            let said: serde_json::Value = serde_json::from_str(&payload).expect("an ask");
            if said.get("ask").is_some_and(|ask| !ask.is_null()) {
                asked = Some(said);
                break;
            }
        }

        let Some(said) = asked else {
            pty_close(handle.clone(), id.clone());
            panic!("the window was never told a question was being asked");
        };
        let ask = &said["ask"];
        assert_eq!(said["id"], serde_json::json!(id));
        assert_eq!(ask["question"], serde_json::json!("Proceed?"));
        assert_eq!(ask["choices"][0]["key"], serde_json::json!("1"));
        assert_eq!(ask["choices"][1]["label"], serde_json::json!("No"));
        assert_eq!(ask["choices"].as_array().map(Vec::len), Some(2));

        let seq = ask["seq"].as_u64().expect("the question is numbered");
        assert!(
            pty_answer(handle.clone(), id.clone(), seq, "1".to_string()).is_ok(),
            "the answer was refused"
        );
        // And the same answer again, which is now for a question nobody is
        // asking: this is what stops a press landing on whatever came next.
        assert!(
            pty_answer(handle.clone(), id.clone(), seq, "1".to_string()).is_err(),
            "an answer to a question that has been answered went through"
        );

        pty_close(handle.clone(), id.clone());
    }

    #[test]
    fn attaching_to_a_session_that_is_not_running_says_so() {
        let app = mock_app();
        assert!(pty_attach(app.handle().clone(), "nobody".into()).is_none());
    }

    /// A session left running all day: what it says is counted in full, and
    /// what is kept is the end of it, beginning where a line begins.
    #[test]
    fn a_long_session_keeps_its_tail_and_counts_the_whole() {
        let mut backlog = Backlog::default();
        let line = "a line of output\n";
        assert_eq!(backlog.keep(line), 0, "the first run starts at nothing");

        let runs = 40_000;
        let mut at = 0;
        for _ in 1..runs {
            at = backlog.keep(line);
        }

        assert_eq!(backlog.said, line.len() * runs);
        assert_eq!(at, backlog.said - line.len());
        assert!(backlog.text.len() <= KEPT + SLACK);
        assert!(backlog.text.len() >= KEPT);
        assert!(
            backlog.text.starts_with(line),
            "the tail begins part way through a line: {:?}",
            &backlog.text[..line.len().min(backlog.text.len())]
        );
    }

    /// Output with no line breaks in it at all — a full-screen program redrawing
    /// itself. There is nowhere tidy to cut, and the one thing the cut must not
    /// do is land inside a character.
    #[test]
    fn the_tail_is_cut_between_characters() {
        let mut backlog = Backlog::default();
        backlog.keep(&"\u{3042}".repeat(200_000));
        assert!(backlog.text.len() <= KEPT + SLACK);
        assert!(
            backlog.text.chars().all(|letter| letter == '\u{3042}'),
            "a character was cut in half"
        );
    }

    #[test]
    fn writing_to_a_session_that_is_not_running_is_an_error() {
        let app = mock_app();
        let handle = app.handle().clone();
        assert!(pty_write(handle.clone(), "nobody".into(), "hi".into()).is_err());
        // Resizing one is not: it races a shell that just exited.
        assert!(pty_resize(handle, "nobody".into(), 10, 10).is_ok());
    }
}
