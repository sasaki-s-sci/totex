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
use std::sync::{Arc, Mutex};

use portable_pty::{Child, CommandBuilder, MasterPty, PtySize, native_pty_system};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, Runtime};

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
    text: String,
    /// How far `text` reaches into everything the session has said.
    upto: usize,
}

/// One running shell. The master is kept so the session can be resized.
struct Session {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn Child + Send + Sync>,
    /// Shared with the thread reading the pty, which fills it whether or not
    /// there is a window at the other end of the event.
    said: Arc<Mutex<Backlog>>,
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

    let mut command = CommandBuilder::new(shell());
    command.cwd(&cwd);
    // A shell started outside a terminal emulator inherits no answer for this,
    // and without one it falls back to a dumb terminal with no colour.
    command.env("TERM", "xterm-256color");

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
        let seq = crate::sync::lock(&keeping).keep(&data);
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
            said,
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
    let mut line = program.clone();
    for arg in args {
        line.push(' ');
        line.push_str(&quote(arg));
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
/// far side as themselves.
#[cfg(not(windows))]
fn quote(value: &str) -> String {
    // Ending the quoted run, escaping the quote outside it, and opening a new
    // one: the one form every Bourne-family shell, `fish` included, reads back
    // as a single apostrophe.
    format!("'{}'", value.replace('\'', "'\\''"))
}

#[cfg(windows)]
fn quote(value: &str) -> String {
    // PowerShell, which is what `shell()` falls back to: inside single quotes
    // nothing expands, and a doubled quote is one quote.
    format!("'{}'", value.replace('\'', "''"))
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

    /// Collects output until `wanted` shows up, or gives up.
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
