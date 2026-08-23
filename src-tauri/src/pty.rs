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
//!
//! This is the one thing in the app that cannot be worked out again. A folder's
//! snapshot, a watch on the directories git writes, the question an agent is
//! standing on: every one of those can be thrown away and taken afresh, out of
//! what is on disk or out of what a session has already said. A running shell
//! cannot. It is a process with a history nobody else has a copy of, and
//! whatever ends this program ends it too.
//!
//! So nothing that could be derived is kept in here. What wants to follow the
//! sessions registers to be told through `follow` rather than being given a
//! field on one — which is the same thing it would have to do if this were a
//! program of its own and the rest of the app were talking to it down a socket.
//! See `derived`, which is where the line between the two is written down.

use std::collections::HashMap;
use std::io::Write;
use std::path::Path;
use std::sync::{Arc, Mutex};

use portable_pty::{Child, CommandBuilder, MasterPty, PtySize, native_pty_system};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, Runtime};

use crate::host::Host;
use crate::wsl;

/// Carries a run of a session's output to the window.
const DATA_EVENT: &str = "pty:data";
/// Carries the session that has ended, so the window can say so.
const EXIT_EVENT: &str = "pty:exit";

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

/// What a session has said so far, for a terminal that has just attached.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Held {
    pub text: String,
    /// How far `text` reaches into everything the session has said.
    pub upto: usize,
}

/// One session that is still running, for whatever has stopped knowing about
/// it.
///
/// What a window is handed when it comes up in front of shells it did not
/// start — a reload, or one day this whole side of the app being replaced
/// underneath it. The id, the directory and the size are this side's own;
/// `meta` is the window's, and is handed back exactly as it was left.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Running {
    pub id: String,
    pub cwd: String,
    /// The size the shell is at, which is the size a screen has to be rebuilt
    /// at to read the same thing off it.
    pub rows: u16,
    pub cols: u16,
    pub meta: Option<String>,
}

/// What the sessions do, for whatever is following them.
///
/// The window is not the only thing that has to be told. What an agent is
/// asking is read off the screen its own session drew it on, and that reading
/// is fed from here — so it is handed the things a program on the other end of
/// a socket would have to be handed, and nothing else: a session started, a run
/// of what it said and where that falls in the whole of it, a size, an ending.
#[derive(Clone, Copy)]
pub enum Event<'a> {
    /// A shell has started, at the size it was started at.
    Opened { rows: u16, cols: u16 },
    /// A run of output, and how much the session had said before it.
    Said { data: &'a str, at: usize },
    /// The screen it is drawn on has been given a different amount of room.
    Resized { rows: u16, cols: u16 },
    /// The shell has ended, and the session with it.
    Ended,
}

/// Something following the sessions, told what each of them does as it does it.
pub type Follower = Arc<dyn Fn(&str, Event<'_>) + Send + Sync>;

/// One running shell. The master is kept so the session can be resized.
struct Session {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn Child + Send + Sync>,
    /// Shared with the thread reading the pty, which fills it whether or not
    /// there is a window at the other end of the event.
    said: Arc<Mutex<Backlog>>,
    /// Where it was started, and how much room it was last told it has.
    ///
    /// Kept because they are facts about the process rather than about whoever
    /// is drawing it: a window that has forgotten this session — or a window
    /// that was never the one to open it — is handed both back, and a screen
    /// read at the wrong width is a box with its right-hand side in the middle
    /// of a line.
    cwd: String,
    rows: u16,
    cols: u16,
    /// Whatever the window asked to have kept beside this session.
    ///
    /// Never looked at here, and deliberately a string rather than anything
    /// with a shape: what the window needs to put a session back where it was
    /// — which branch's row it belongs on, today — is the window's own business
    /// and changes when the window changes. Holding it unread is what lets it
    /// change without any of this knowing.
    meta: Option<String>,
}

#[derive(Default)]
pub struct PtyState {
    sessions: Mutex<HashMap<String, Session>>,
    /// Whatever is following the sessions besides the window.
    ///
    /// Registered rather than compiled in. What follows them today is the
    /// reading of the questions agents ask, which is derived from their output
    /// and has no business owning a process — and keeping the arrangement this
    /// way round is what lets that reading be thrown away and taken again
    /// without anything in here being disturbed.
    following: Mutex<Vec<Follower>>,
}

impl PtyState {
    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<String, Session>> {
        crate::sync::lock(&self.sessions)
    }

    /// Adds one, for the life of the app.
    pub fn follow(&self, follower: Follower) {
        crate::sync::lock(&self.following).push(follower);
    }

    /// Tells them all.
    ///
    /// The list is copied out before any of it is called: a follower does its
    /// own work here — reading a screen, telling the window what it found — and
    /// holding a lock of this module's across that would put every session
    /// behind whatever the slowest of them is doing.
    fn tell(&self, id: &str, event: Event<'_>) {
        let following: Vec<Follower> = {
            let held = crate::sync::lock(&self.following);
            if held.is_empty() {
                return;
            }
            held.clone()
        };
        for follower in following {
            follower(id, event);
        }
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

/// The command a session runs.
///
/// A folder inside a WSL distribution gets that distribution's own login shell,
/// started inside it. Not the share: `cmd` refuses a UNC directory to run in,
/// PowerShell in one is a Windows shell looking at Linux files, and the tools
/// somebody opens a terminal to reach — the agents, the language runtimes — are
/// installed in the distribution and not beside the window.
fn session_command(cwd: &str) -> CommandBuilder {
    match Host::of_str(cwd) {
        Host::Local => {
            let mut command = CommandBuilder::new(shell());
            command.cwd(cwd);
            // A shell started outside a terminal emulator inherits no answer
            // for this, and without one it falls back to a dumb terminal with
            // no colour.
            command.env("TERM", "xterm-256color");
            command
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
            command
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
///
/// `meta` is kept and never read — see the field.
#[tauri::command]
pub fn pty_open<R: Runtime>(
    app: AppHandle<R>,
    id: String,
    cwd: String,
    rows: u16,
    cols: u16,
    meta: Option<String>,
) -> Result<(), String> {
    let rows = rows.max(1);
    let cols = cols.max(1);
    let state = app.state::<PtyState>();

    {
        let mut sessions = state.lock();
        if sessions.contains_key(&id) {
            return Ok(());
        }

        let pty = native_pty_system()
            .openpty(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|error| error.to_string())?;

        let command = session_command(&cwd);

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
        let reading = crate::stream::pump(reader, move |data| {
            // Kept before it is sent, and kept whether or not anybody is there to
            // send it to. This is the whole of what makes the session a process
            // rather than a panel: the prompt a shell prints in the moment between
            // being started and being drawn is waiting in here when the terminal
            // finally asks for it.
            let at = crate::sync::lock(&keeping).keep(&data);
            // And handed on to whatever is following the sessions, which is
            // where the questions agents ask are read out of it. Told before
            // the window is, because a follower is part of this program and the
            // window is at the end of a message: what it does with the run is
            // done by the time anything is drawn from it.
            if let Some(state) = sending.try_state::<PtyState>() {
                state.tell(&sending_name, Event::Said { data: &data, at });
            }
            sending
                .emit(
                    DATA_EVENT,
                    Said {
                        id: sending_name.clone(),
                        data,
                        seq: at,
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
                // Said after it is gone, so that a follower which looks at what
                // is running finds what is actually left.
                state.tell(&name, Event::Ended);
            }
        });

        sessions.insert(
            id.clone(),
            Session {
                master: pty.master,
                writer,
                child,
                said,
                cwd,
                rows,
                cols,
                meta,
            },
        );
    }

    // Outside the lock, like every other one of these: a follower is free to
    // ask what is running, and would find this module holding the map it is
    // asking about.
    state.tell(&id, Event::Opened { rows, cols });
    Ok(())
}

/// Every session that is still running.
///
/// What a window asks for when it comes up in front of shells it does not know
/// about — its own, from before it was reloaded, or ones it never started. A
/// session is a process, so this is the only place the truth about which of
/// them exist has ever been; a window that kept its own list was keeping a copy.
#[tauri::command]
pub fn pty_sessions<R: Runtime>(app: AppHandle<R>) -> Vec<Running> {
    running(&app)
}

/// The same thing, for the rest of this side of the app.
pub fn running<R: Runtime>(app: &AppHandle<R>) -> Vec<Running> {
    let state = app.state::<PtyState>();
    let sessions = state.lock();
    sessions
        .iter()
        .map(|(id, session)| Running {
            id: id.clone(),
            cwd: session.cwd.clone(),
            rows: session.rows,
            cols: session.cols,
            meta: session.meta.clone(),
        })
        .collect()
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
/// tells which one that was. What reads a screen off the backlog does the same
/// thing with the same two numbers.
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

/// Tells the shell how much room it has, so that anything full-screen — an
/// editor, a pager — draws to the right size.
#[tauri::command]
pub fn pty_resize<R: Runtime>(
    app: AppHandle<R>,
    id: String,
    rows: u16,
    cols: u16,
) -> Result<(), String> {
    let rows = rows.max(1);
    let cols = cols.max(1);
    let state = app.state::<PtyState>();

    {
        let mut sessions = state.lock();
        let Some(session) = sessions.get_mut(&id) else {
            // A resize arriving after the shell exited is not worth an error.
            return Ok(());
        };
        session
            .master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|error| error.to_string())?;
        session.rows = rows;
        session.cols = cols;
    }

    // The screen a question is read off is the shell's own, so it is the same
    // size as the shell's: a box drawn to eighty columns and read against a
    // hundred and twenty is a box with its right-hand side in the middle of a
    // line.
    state.tell(&id, Event::Resized { rows, cols });
    Ok(())
}

/// Ends a session. The reader thread stops on its own once the pty is dropped,
/// and it is that thread — not this — which says the session has gone.
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
            None,
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
            None,
        )
        .expect("the shell starts");

        pty_write(
            handle.clone(),
            id.clone(),
            "echo totex-at-$(pwd)\n".to_string(),
        )
        .expect("the shell takes input");
        let seen = wait_answering(&handle, &id, &rx, "totex-at-/etc");
        pty_close(handle.clone(), id.clone());

        assert!(
            seen.contains("totex-at-/etc"),
            "the shell did not answer from inside the distribution: {seen:?}"
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
            None,
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
