//! Being asked down a socket, and telling every window what the sessions do.
//!
//! One loopback listener, one thread per window connected. A window says the
//! token first — read out of the address file this program wrote, which is a
//! file only this account can read — and is then told what this program is and
//! what it answers to. From there it asks by name under a number and is answered
//! under the same number, and everything the sessions do is written to it
//! unasked, under no number at all, as it happens.
//!
//! ## When this program ends
//!
//! Either when a window says `stop`, which is the app being closed by the
//! person — every shell ends with it, as it always did — or when there is
//! nothing left to hold: the last window has gone and the last shell has
//! ended. A window that goes with shells still running is a window that is
//! coming back, whether it meant to or not, and what it comes back to is
//! exactly what it left.
//!
//! A window may also say, on its way out, what should be started once it has
//! gone — see [`Relaunch`]. That is what an update is: the window that
//! downloaded a release asks for the new one to be started, and leaves.

use std::io::{BufRead, BufReader, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::Deserialize;
use serde_json::Value;
use totex_host::sync::lock;

use crate::session::Event;
use crate::wire::{Address, Asked, Told, answered, hello};
use crate::{Persistent, door, update};

/// The one address this listens on. Never the machine's own address on a
/// network: what stands behind this socket is every terminal somebody has open.
const LOOPBACK: &str = "127.0.0.1";

/// How long a connection is given to say the token before it is dropped.
const HELLO: Duration = Duration::from_secs(5);

/// What ends this program, handed in by whoever started it: the real one exits
/// the process, and a test sets a flag.
pub type Ending = Box<dyn Fn() + Send + Sync>;

/// What a window asked to be started once it has gone — and, where a release
/// came down first, what is to be put in before it is.
#[derive(Clone, Debug, Deserialize)]
pub struct Relaunch {
    pub program: PathBuf,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub install: Option<update::Install>,
}

/// One window, for as long as it is connected.
struct Client {
    id: u64,
    writing: Mutex<TcpStream>,
    /// What this window asked to be started once it has gone, if anything.
    relaunch: Mutex<Option<Relaunch>>,
}

impl Client {
    fn say(&self, line: &str) -> std::io::Result<()> {
        let mut writing = lock(&self.writing);
        writing.write_all(line.as_bytes())?;
        writing.write_all(b"\n")?;
        writing.flush()
    }
}

/// The listener and everyone connected to it.
pub struct Serving {
    held: Arc<Persistent>,
    clients: Mutex<Vec<Arc<Client>>>,
    next: AtomicU64,
    ending: Ending,
    port: u16,
    token: String,
    home: PathBuf,
}

/// Binds, writes down where, and starts taking windows.
///
/// The address file is written whole or not at all — beside where it goes and
/// moved into place — because a window reads it the moment it appears, and
/// half a port number is not one.
pub fn stand(held: Arc<Persistent>, home: &Path, ending: Ending) -> Result<Arc<Serving>, String> {
    let listener =
        TcpListener::bind((LOOPBACK, 0)).map_err(|error| format!("nowhere to listen: {error}"))?;
    let port = listener
        .local_addr()
        .map_err(|error| error.to_string())?
        .port();
    let token = token();

    let serving = Arc::new(Serving {
        held: Arc::clone(&held),
        clients: Mutex::new(Vec::new()),
        next: AtomicU64::new(1),
        ending,
        port,
        token: token.clone(),
        home: home.to_path_buf(),
    });

    // What the sessions do goes to every window, and the door's reports with
    // it. Registered before the address is written, so that no window can
    // connect to a program that is not yet telling.
    let telling = Arc::clone(&serving);
    held.sessions.follow(Arc::new(move |id, event| {
        telling.broadcast(&Told::of(id, event));
        if matches!(event, Event::Ended) {
            telling.end_if_empty();
        }
    }));
    let reporting = Arc::clone(&serving);
    held.door.follow(Arc::new(move |reported| {
        reporting.broadcast(&Told::Report {
            id: reported.id.clone(),
            report: reported.report.clone(),
        });
    }));

    write_address(
        home,
        &Address {
            port,
            token,
            pid: std::process::id(),
            version: crate::VERSION.to_string(),
            line: crate::LINE,
        },
    )?;

    let accepting = Arc::clone(&serving);
    std::thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            let serving = Arc::clone(&accepting);
            std::thread::spawn(move || talk(serving, stream));
        }
    });

    Ok(serving)
}

impl Serving {
    pub fn port(&self) -> u16 {
        self.port
    }

    /// How many windows are connected.
    pub fn clients(&self) -> usize {
        lock(&self.clients).len()
    }

    /// Tells every window, and lets go of any that cannot be told.
    fn broadcast(&self, told: &Told) {
        let Ok(line) = serde_json::to_string(told) else {
            return;
        };
        let clients: Vec<Arc<Client>> = lock(&self.clients).clone();
        for client in clients {
            if client.say(&line).is_err() {
                self.forget(client.id);
            }
        }
    }

    fn forget(&self, id: u64) {
        lock(&self.clients).retain(|client| client.id != id);
    }

    /// Ends this program if there is nothing left to hold.
    fn end_if_empty(&self) {
        if self.clients() == 0 && self.held.sessions.count() == 0 {
            (self.ending)();
        }
    }
}

/// One window, from the token to the end of the socket.
fn talk(serving: Arc<Serving>, stream: TcpStream) {
    let Ok(writing) = stream.try_clone() else {
        return;
    };
    let mut reading = BufReader::new(stream);

    // The token, or nothing at all: a connection that does not say it in time
    // is not a window.
    let _ = reading.get_ref().set_read_timeout(Some(HELLO));
    let mut first = String::new();
    if reading.read_line(&mut first).is_err() {
        return;
    }
    let said: Value = serde_json::from_str(&first).unwrap_or(Value::Null);
    if said["token"].as_str() != Some(&serving.token) {
        return;
    }
    let _ = reading.get_ref().set_read_timeout(None);

    let client = Arc::new(Client {
        id: serving.next.fetch_add(1, Ordering::Relaxed),
        writing: Mutex::new(writing),
        relaunch: Mutex::new(None),
    });
    // Counted before the hello has gone, under the lock a broadcast would
    // need, so that the first line the window reads is the hello and the
    // window is one of the clients by the time it has read it.
    {
        let mut writing = lock(&client.writing);
        let line = hello(crate::VERSION).to_string();
        if writing
            .write_all(format!("{line}\n").as_bytes())
            .and_then(|()| writing.flush())
            .is_err()
        {
            return;
        }
        lock(&serving.clients).push(Arc::clone(&client));
    }

    let mut lines = reading.lines();
    while let Some(Ok(line)) = lines.next() {
        if line.trim().is_empty() {
            continue;
        }
        let Ok(asked) = serde_json::from_str::<Asked>(&line) else {
            // A line that is not a question cannot be answered to anybody in
            // particular, because the number it would be answered under is the
            // part that would not read. Dropped rather than guessed at.
            continue;
        };
        let Asked { id, command, with } = asked;
        let (answer, then) = answer(&serving, &client, &command, with);
        if client.say(&answered(id, answer).to_string()).is_err() {
            break;
        }
        // What is left to do after `stop` ends this program, and the socket
        // with it: closed here as well, so that a program which is not the
        // real one -- a test's -- reads the same way from the other end.
        if let Some(then) = then {
            then(&serving);
            break;
        }
    }

    // The window has gone. Whatever it asked to have started is started -- with
    // whatever came down put in first -- and if there is nothing left to hold,
    // this program goes too.
    serving.forget(client.id);
    if let Some(relaunch) = lock(&client.relaunch).take() {
        if let Some(install) = &relaunch.install
            && let Err(error) = update::install(install)
        {
            // The old program is started instead: a window that says the
            // release did not go in is better than no window at all.
            update::note(
                &serving.home,
                &format!("the release did not go in: {error}"),
            );
        }
        launch(&relaunch);
    }
    serving.end_if_empty();
}

/// Something to do after an answer has been written.
type Then = Box<dyn FnOnce(&Serving) + Send>;

/// Whether a name is one the table below answers to.
pub fn answers(command: &str) -> bool {
    crate::wire::ANSWERS.contains(&command)
}

/// Answers one question, or says it is not one of this program's.
///
/// `None` is "not mine": a newer window asking an older program for something
/// it was never taught. The window is told so rather than left waiting.
fn answer(
    serving: &Arc<Serving>,
    client: &Arc<Client>,
    command: &str,
    with: Value,
) -> (Option<Result<Value, String>>, Option<Then>) {
    let held = &serving.held;
    let answer = match command {
        "open" => read::<Opened>(with).and_then(|at| {
            held.sessions
                .open(&at.id, &at.cwd, at.rows, at.cols, at.meta)
                .map(|()| Value::Null)
        }),
        "sessions" => said(held.sessions.running()),
        "attach" => read::<Named>(with).and_then(|at| said(held.sessions.attach(&at.id))),
        "write" => read::<Written>(with)
            .and_then(|at| held.sessions.write(&at.id, &at.data).map(|()| Value::Null)),
        "resize" => read::<Resized>(with).and_then(|at| {
            held.sessions
                .resize(&at.id, at.rows, at.cols)
                .map(|()| Value::Null)
        }),
        "close" => read::<Named>(with).map(|at| {
            held.sessions.close(&at.id);
            Value::Null
        }),
        "door_serving" => said(held.door.serving()),
        "door_serve" => held.door.serve().and_then(said),
        "door_stop" => {
            held.door.unserve();
            Ok(Value::Null)
        }
        "door_reports" => said(held.door.reports()),
        "door_setups" => said(held.door.setups()),
        "door_install" => {
            read::<Installing>(with).and_then(|at| held.door.install(at.agent).and_then(said))
        }
        "store_get" => read::<Stored>(with).and_then(|at| said(held.store.get(&at.name)?)),
        "store_put" => read::<Putting>(with)
            .and_then(|at| held.store.put(&at.name, at.value).map(|()| Value::Null)),
        "store_list" => said(held.store.list()),
        "take_program" => read::<update::Taking>(with).and_then(|taking| {
            let telling = Arc::clone(serving);
            update::take(&serving.home, &taking, move |taken, length| {
                telling.broadcast(&Told::Coming { taken, length });
            })
            .and_then(said)
        }),
        "relaunch" => read::<Relaunch>(with).map(|relaunch| {
            *lock(&client.relaunch) = Some(relaunch);
            Value::Null
        }),
        "stop" => {
            // Answered first, ended second: the window is waiting to hear that
            // it was heard, and a socket closed by a process that has exited is
            // not an answer.
            let then: Then = Box::new(|serving| {
                serving.held.sessions.close_all();
                serving.held.door.unserve();
                (serving.ending)();
            });
            return (Some(Ok(Value::Null)), Some(then));
        }
        _ => return (None, None),
    };
    (Some(answer), None)
}

/// The arguments of one question, or the same complaint however they are wrong.
fn read<T: for<'a> Deserialize<'a>>(with: Value) -> Result<T, String> {
    serde_json::from_value(with).map_err(|error| format!("asked wrongly: {error}"))
}

/// One answer, on its way back as JSON.
fn said<T: serde::Serialize>(answer: T) -> Result<Value, String> {
    serde_json::to_value(answer).map_err(|error| format!("cannot say that: {error}"))
}

#[derive(Deserialize)]
struct Opened {
    id: String,
    cwd: String,
    rows: u16,
    cols: u16,
    #[serde(default)]
    meta: Option<String>,
}

#[derive(Deserialize)]
struct Named {
    id: String,
}

#[derive(Deserialize)]
struct Written {
    id: String,
    data: String,
}

#[derive(Deserialize)]
struct Resized {
    id: String,
    rows: u16,
    cols: u16,
}

#[derive(Deserialize)]
struct Installing {
    agent: door::Agent,
}

#[derive(Deserialize)]
struct Stored {
    name: String,
}

#[derive(Deserialize)]
struct Putting {
    name: String,
    value: Value,
}

/// A token nothing outside this run could guess.
///
/// Two hashes out of two fresh `RandomState`s, which are seeded by the machine
/// and not by anything in this program.
fn token() -> String {
    use std::collections::hash_map::RandomState;
    use std::hash::BuildHasher;
    format!(
        "{:016x}{:016x}",
        RandomState::new().hash_one(std::process::id()),
        RandomState::new().hash_one(std::time::SystemTime::now())
    )
}

/// Writes the address file, readable by this account and nobody else.
fn write_address(home: &Path, address: &Address) -> Result<(), String> {
    std::fs::create_dir_all(home).map_err(|error| format!("{}: {error}", home.display()))?;
    let at = Address::path(home);
    let writing = at.with_extension("json.writing");
    let bytes = serde_json::to_vec(address).map_err(|error| error.to_string())?;
    std::fs::write(&writing, bytes).map_err(|error| format!("{}: {error}", writing.display()))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&writing, std::fs::Permissions::from_mode(0o600));
    }
    std::fs::rename(&writing, &at).map_err(|error| format!("{}: {error}", at.display()))
}

/// Starts what a window asked for on its way out, on its own.
///
/// Not this program's child in any sense the operating system would act on: it
/// is given no pipes, its own process group, and on Windows its own console
/// arrangements, so that neither of the two ending takes the other with it.
pub fn launch(relaunch: &Relaunch) {
    let mut command = Command::new(&relaunch.program);
    command
        .args(&relaunch.args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    detach(&mut command);
    let _ = command.spawn();
}

/// Leaves a program to be started as nobody's child.
#[cfg(unix)]
pub fn detach(command: &mut Command) {
    use std::os::unix::process::CommandExt;
    command.process_group(0);
}

/// The same on Windows, where a process is otherwise tied to its parent's
/// console and, under an installer, to its parent's job.
#[cfg(windows)]
pub fn detach(command: &mut Command) {
    use std::os::windows::process::CommandExt;
    const DETACHED_PROCESS: u32 = 0x0000_0008;
    const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
    const CREATE_BREAKAWAY_FROM_JOB: u32 = 0x0100_0000;
    command.creation_flags(DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP | CREATE_BREAKAWAY_FROM_JOB);
}
