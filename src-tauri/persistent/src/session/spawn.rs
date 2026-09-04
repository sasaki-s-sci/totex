//! Starting a shell, and the environment it starts in.

use std::path::Path;
use std::sync::{Arc, Mutex, Weak};

use portable_pty::{CommandBuilder, PtySize, native_pty_system};

use totex_host::host::Host;
use totex_host::sync::lock;
use totex_host::wsl;

use super::backlog::Backlog;
use super::{Event, Session, Sessions};

/// The shell to run: whatever the user has chosen, falling back to something
/// every platform is known to have. The agent side runs its one-shot turns
/// through a login shell of the same name, so this is the app's one answer to
/// "which shell".
pub fn shell() -> String {
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
/// somebody opens a terminal to reach are installed in the distribution.
fn session_command(cwd: &str, dressing: &[(String, String)]) -> CommandBuilder {
    match Host::of_str(cwd) {
        Host::Local => {
            let mut command = CommandBuilder::new(shell());
            command.cwd(cwd);
            // A shell started outside a terminal emulator inherits no answer for
            // this, and without one falls back to a dumb terminal with no colour.
            command.env("TERM", "xterm-256color");
            for (name, value) in dressing {
                command.env(name, value);
            }
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
            for (name, value) in dressing {
                command.env(name, value);
            }
            // The one way a variable crosses into a distribution: `WSLENV` names
            // which of them to carry, and `/u` says this direction only.
            let mut crossing = vec!["TERM"];
            crossing.extend(dressing.iter().map(|(name, _)| name.as_str()));
            command.env("WSLENV", carried(&crossing));
            command
        }
    }
}

/// `WSLENV` with these names on it too, keeping whatever was already there.
fn carried(names: &[&str]) -> String {
    let crossing = names
        .iter()
        .map(|name| format!("{name}/u"))
        .collect::<Vec<String>>()
        .join(":");
    match std::env::var("WSLENV") {
        Ok(existing) if !existing.trim().is_empty() => format!("{existing}:{crossing}"),
        _ => crossing,
    }
}

impl Sessions {
    /// Starts a shell in `cwd` under the name `id`, and leaves it running.
    ///
    /// Idempotent, so opening a session and attaching a terminal to one both
    /// call this. The map is held for the whole of it: two of these arriving
    /// together for the same id would otherwise both spawn a shell, and the
    /// loser would be a process nothing can reach, close, or ever read.
    pub fn open(
        self: &Arc<Self>,
        id: &str,
        cwd: &str,
        rows: u16,
        cols: u16,
        meta: Option<String>,
    ) -> Result<(), String> {
        let rows = rows.max(1);
        let cols = cols.max(1);

        // Asked for out here rather than beside the spawn: whatever answers is
        // the rest of the program, and it would find the map below held
        // against it.
        let dressing = self.dressed(id, cwd);

        {
            let mut sessions = self.lock();
            if sessions.contains_key(id) {
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

            let child = pty
                .slave
                .spawn_command(session_command(cwd, &dressing))
                .map_err(|error| error.to_string())?;
            let writer = pty
                .master
                .take_writer()
                .map_err(|error| error.to_string())?;
            let reader = pty
                .master
                .try_clone_reader()
                .map_err(|error| error.to_string())?;

            let said = Arc::new(Mutex::new(Backlog::default()));
            follow_output(Arc::downgrade(self), id, reader, Arc::clone(&said));

            sessions.insert(
                id.to_string(),
                Session {
                    master: pty.master,
                    writer,
                    child,
                    said,
                    cwd: cwd.to_string(),
                    rows,
                    cols,
                    meta,
                },
            );
        }

        // Outside the lock, like every other one of these: a follower is free
        // to ask what is running, and would find this module holding the map.
        self.tell(id, Event::Opened { rows, cols });
        Ok(())
    }
}

/// Reads the pty away from the caller's thread, keeping what it says and
/// handing it to the followers — in that order, because what is kept is what a
/// terminal built later is handed, and a follower may be one.
///
/// Held weakly: the sessions outlive nothing here, and a reader thread is not
/// what should keep them alive.
fn follow_output(
    sessions: Weak<Sessions>,
    id: &str,
    reader: Box<dyn std::io::Read + Send>,
    keeping: Arc<Mutex<Backlog>>,
) {
    let name = id.to_string();
    let telling = Weak::clone(&sessions);
    let telling_name = name.clone();

    let reading = crate::stream::pump(reader, move |data| {
        // Kept whether or not anybody is there to send it to. This is what makes
        // the session a process rather than a panel: the prompt printed between
        // being started and being drawn waits in here.
        let at = lock(&keeping).keep(&data);
        match telling.upgrade() {
            Some(sessions) => {
                sessions.tell(&telling_name, Event::Said { data: &data, at });
                true
            }
            None => false,
        }
    });

    std::thread::spawn(move || {
        let _ = reading.join();
        // Nobody is coming back for it, so the session is dropped here rather
        // than waiting for a close that will never be asked for.
        if let Some(sessions) = sessions.upgrade() {
            sessions.lock().remove(&name);
            // Said after it is gone, so a follower that looks at what is running
            // finds what is actually left.
            sessions.tell(&name, Event::Ended);
        }
    });
}
