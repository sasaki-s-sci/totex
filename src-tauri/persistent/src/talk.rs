//! Asking the program that holds the terminals, from the window.
//!
//! The other end of [`crate::serve`]: a socket to the port the address file
//! names, the token said first, and then questions under numbers and events
//! under none. Answers come back in whatever order they finish in, so every
//! question goes out under a number and waits on a channel of its own, and the
//! events are handed to whoever registered to follow the sessions — which is
//! the same shape the sessions offer inside the program, so that what reads
//! them does not have to know which side of the socket it is on.
//!
//! ## Finding one, or starting one
//!
//! A window does not know whether a program is already holding terminals for
//! it. It reads the address file and knocks; if nobody answers, it starts one
//! and knocks again. If somebody answers on the same line -- see
//! [`crate::LINE`] -- it is the program this window asks, whatever patch it
//! is: a patch release replaces the window and nothing else. One on the same
//! line holding nothing is still swapped for the one this window brought,
//! because that costs nothing. One on another line is stopped whatever it
//! holds, and the one this window brought is started instead — the one cost
//! here, and one a minor release pays on purpose.

use std::collections::{HashMap, HashSet};
use std::io::{BufRead, BufReader, Write};
use std::net::{SocketAddr, TcpStream};
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{SyncSender, sync_channel};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde_json::{Value, json};
use totex_host::sync::lock;

use crate::door::Reporter;
use crate::session::{Event, Follower};
use crate::wire::{Address, Told};

/// How long the program is given to say what it is before it is given up on.
const HELLO: Duration = Duration::from_secs(5);

/// How long a question is given to be answered. Long, because one of them runs
/// an agent's own setup command through a login shell; and finite, because a
/// program that never answers is a program that has gone.
const PATIENCE: Duration = Duration::from_secs(120);

/// How long a program that was just started is given to write its address.
const STARTING: Duration = Duration::from_secs(10);
const STARTING_PAUSE: Duration = Duration::from_millis(50);

/// How long a program that was told to stop is given to go.
const STOPPING: Duration = Duration::from_secs(5);

/// One answer, as the reading thread hands it over.
enum Said {
    Answered(Value),
    Failed(String),
    /// Not this program's question — see `answer` in `serve.rs`.
    Unknown,
}

/// The questions that have gone out and not come back.
#[derive(Default)]
struct Waiting {
    at: HashMap<u64, SyncSender<Said>>,
}

/// Why there is no program to talk to.
#[derive(Debug)]
pub enum Missing {
    /// No address, or nobody at it.
    Nobody,
    /// Somebody who did not say the right thing in time.
    Refused(String),
}

/// A program holding the terminals, at the other end of a socket.
pub struct Link {
    version: String,
    /// The line it is on -- see [`crate::LINE`].
    line: u32,
    /// What it announced it can answer. A name that is not in here is not sent.
    answers: HashSet<String>,
    next: AtomicU64,
    waiting: Arc<Mutex<Waiting>>,
    asking: Mutex<Option<TcpStream>>,
    gone: Arc<AtomicBool>,
    following: Arc<Mutex<Vec<Follower>>>,
    reporting: Arc<Mutex<Vec<Reporter>>>,
    /// The sessions this side has been told about and not yet told have ended,
    /// so that a program which goes away can be read as every one of them
    /// ending.
    known: Arc<Mutex<HashSet<String>>>,
    relaunching: AtomicBool,
    /// Whoever is waiting to hear how much of a release has come down, while
    /// one is coming.
    coming: Arc<Mutex<Option<Coming>>>,
}

/// Something told how much of a release has come down, as it comes.
pub type Coming = Box<dyn Fn(u64, Option<u64>) + Send + Sync>;

impl std::fmt::Debug for Link {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Link")
            .field("version", &self.version)
            .field("line", &self.line)
            .field("gone", &self.gone())
            .finish()
    }
}

impl Link {
    /// Knocks at the address the file names.
    pub fn connect(home: &Path) -> Result<Self, Missing> {
        let address = Address::read(home).ok_or(Missing::Nobody)?;
        Self::connect_to(&address)
    }

    /// Knocks at one address.
    pub fn connect_to(address: &Address) -> Result<Self, Missing> {
        let at = SocketAddr::from(([127, 0, 0, 1], address.port));
        let stream =
            TcpStream::connect_timeout(&at, Duration::from_secs(1)).map_err(|_| Missing::Nobody)?;
        let _ = stream.set_nodelay(true);
        let mut asking = stream
            .try_clone()
            .map_err(|error| Missing::Refused(error.to_string()))?;
        let line = json!({ "token": address.token }).to_string();
        asking
            .write_all(format!("{line}\n").as_bytes())
            .map_err(|error| Missing::Refused(error.to_string()))?;

        let waiting = Arc::new(Mutex::new(Waiting::default()));
        let gone = Arc::new(AtomicBool::new(false));
        let following: Arc<Mutex<Vec<Follower>>> = Arc::new(Mutex::new(Vec::new()));
        let reporting: Arc<Mutex<Vec<Reporter>>> = Arc::new(Mutex::new(Vec::new()));
        let known: Arc<Mutex<HashSet<String>>> = Arc::new(Mutex::new(HashSet::new()));
        let coming: Arc<Mutex<Option<Coming>>> = Arc::new(Mutex::new(None));

        let (said, hears) = sync_channel(1);
        {
            let waiting = Arc::clone(&waiting);
            let gone = Arc::clone(&gone);
            let following = Arc::clone(&following);
            let reporting = Arc::clone(&reporting);
            let known = Arc::clone(&known);
            let coming = Arc::clone(&coming);
            std::thread::spawn(move || {
                read(
                    stream, said, waiting, gone, following, reporting, known, coming,
                )
            });
        }

        let hello = hears
            .recv_timeout(HELLO)
            .map_err(|_| Missing::Refused("nothing said what it is".to_string()))?;
        let hello = &hello["keep"];
        let version = hello["version"]
            .as_str()
            .ok_or_else(|| Missing::Refused("that is not the program".to_string()))?
            .to_string();
        // Under the name the line was started with -- see `wire::hello`.
        let line = hello["protocol"].as_u64().unwrap_or(0) as u32;
        let answers = hello["answers"]
            .as_array()
            .map(|names| {
                names
                    .iter()
                    .filter_map(|name| name.as_str().map(str::to_string))
                    .collect()
            })
            .unwrap_or_default();

        Ok(Self {
            version,
            line,
            answers,
            next: AtomicU64::new(1),
            waiting,
            asking: Mutex::new(Some(asking)),
            gone,
            following,
            reporting,
            known,
            relaunching: AtomicBool::new(false),
            coming,
        })
    }

    /// Finds the program, or starts `program` and finds that.
    ///
    /// One already running on this window's line is kept whenever it holds
    /// anything, whatever its patch: what it holds is the whole point. One
    /// holding nothing that is not the version this window brought is stopped
    /// and replaced, and one on another line is stopped whatever it holds —
    /// the one cost here, and one a minor release pays on purpose.
    pub fn reach(home: &Path, program: &Path) -> Result<Self, String> {
        Self::reach_version(home, program, crate::VERSION)
    }

    /// The same, for a window that brought a program of another version than
    /// its own -- one it was told to start instead, see the window's settings
    /// page -- so that "the version this window brought" is that one.
    pub fn reach_version(home: &Path, program: &Path, version: &str) -> Result<Self, String> {
        match Self::connect(home) {
            Ok(link) => {
                let same = link.version == version;
                let empty = link.sessions_empty();
                if link.line == crate::LINE && (same || !empty) {
                    return Ok(link);
                }
                link.stop();
                link.wait_gone(STOPPING);
            }
            Err(Missing::Nobody) | Err(Missing::Refused(_)) => {}
        }
        Self::start_and_find(home, program)
    }

    /// Stops whatever is running, whatever it holds, and starts `program` in
    /// its place.
    ///
    /// The one way the program is replaced on purpose while a window is open,
    /// and the one press on the settings page that ends every terminal: the
    /// shells go with the program that held them, and the window that asked
    /// for this is the window that said so first.
    pub fn restart(home: &Path, program: &Path) -> Result<Self, String> {
        if let Ok(link) = Self::connect(home) {
            link.stop();
            link.wait_gone(STOPPING);
        }
        Self::start_and_find(home, program)
    }

    /// Starts `program` beside this window and waits for it to say where it is.
    fn start_and_find(home: &Path, program: &Path) -> Result<Self, String> {
        start(program, home)?;
        let deadline = Instant::now() + STARTING;
        loop {
            match Self::connect(home) {
                Ok(link) if link.line == crate::LINE => return Ok(link),
                Ok(link) => {
                    return Err(format!(
                        "the program that started is on line {} and this window is on {}",
                        link.line,
                        crate::LINE
                    ));
                }
                Err(_) if Instant::now() < deadline => std::thread::sleep(STARTING_PAUSE),
                Err(missing) => return Err(format!("the program did not come up: {missing:?}")),
            }
        }
    }

    pub fn version(&self) -> &str {
        &self.version
    }

    /// The line it is on -- see [`crate::LINE`].
    pub fn line(&self) -> u32 {
        self.line
    }

    /// Whether the program has stopped being one.
    pub fn gone(&self) -> bool {
        self.gone.load(Ordering::Relaxed)
    }

    /// Adds something that is told what every session does, for the life of
    /// the link.
    pub fn follow(&self, follower: Follower) {
        lock(&self.following).push(follower);
    }

    /// Adds something that is told every report through the door.
    pub fn report_to(&self, reporter: Reporter) {
        lock(&self.reporting).push(reporter);
    }

    /// Asks, and waits for the answer.
    pub fn ask(&self, command: &str, with: Value) -> Result<Value, String> {
        if self.gone() {
            return Err("the program holding the terminals has gone".to_string());
        }
        if !self.answers.contains(command) {
            return Err(format!(
                "the program holding the terminals does not answer {command}"
            ));
        }
        let id = self.next.fetch_add(1, Ordering::Relaxed);
        let line = json!({ "id": id, "do": command, "with": with }).to_string();

        let (said, hears) = sync_channel(1);
        lock(&self.waiting).at.insert(id, said);
        if self.write(&line).is_err() {
            lock(&self.waiting).at.remove(&id);
            self.gone.store(true, Ordering::Relaxed);
            return Err("the program holding the terminals has gone".to_string());
        }

        match hears.recv_timeout(PATIENCE) {
            Ok(Said::Answered(value)) => Ok(value),
            Ok(Said::Failed(error)) => Err(error),
            Ok(Said::Unknown) => Err(format!("the program does not answer {command}")),
            Err(_) => {
                lock(&self.waiting).at.remove(&id);
                self.gone.store(true, Ordering::Relaxed);
                Err("the program holding the terminals stopped answering".to_string())
            }
        }
    }

    /// The same, read into a shape.
    pub fn asked<T: for<'a> serde::Deserialize<'a>>(
        &self,
        command: &str,
        with: Value,
    ) -> Result<T, String> {
        let said = self.ask(command, with)?;
        serde_json::from_value(said)
            .map_err(|error| format!("{command} was answered with something else: {error}"))
    }

    fn sessions_empty(&self) -> bool {
        self.ask("sessions", json!({}))
            .ok()
            .and_then(|said| said.as_array().map(Vec::is_empty))
            .unwrap_or(true)
    }

    /// Tells the program to end every shell and go, which is the app closing.
    pub fn stop(&self) {
        let _ = self.ask("stop", json!({}));
    }

    /// Asks the program to start something once this window has gone -- with a
    /// release put in first, where one came down -- and remembers having asked:
    /// a window on its way to being replaced is not one that should take the
    /// shells with it.
    pub fn relaunch(
        &self,
        program: &Path,
        args: &[String],
        install: Option<&crate::update::Install>,
    ) -> Result<(), String> {
        self.ask(
            "relaunch",
            json!({ "program": program, "args": args, "install": install }),
        )?;
        self.relaunching.store(true, Ordering::Relaxed);
        Ok(())
    }

    /// Asks, with somebody told how much has arrived while the answer is
    /// coming -- which is the one question here that takes long enough to be
    /// worth watching.
    pub fn ask_watching(
        &self,
        command: &str,
        with: Value,
        coming: Coming,
    ) -> Result<Value, String> {
        *lock(&self.coming) = Some(coming);
        let answered = self.ask(command, with);
        *lock(&self.coming) = None;
        answered
    }

    /// Whether this window has asked to be replaced.
    pub fn relaunching(&self) -> bool {
        self.relaunching.load(Ordering::Relaxed)
    }

    /// Waits for the socket to close, up to a point.
    pub fn wait_gone(&self, most: Duration) -> bool {
        let deadline = Instant::now() + most;
        while !self.gone() && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(20));
        }
        self.gone()
    }

    fn write(&self, line: &str) -> std::io::Result<()> {
        let mut asking = lock(&self.asking);
        let asking = asking
            .as_mut()
            .ok_or_else(|| std::io::Error::other("nothing is being asked"))?;
        asking.write_all(line.as_bytes())?;
        asking.write_all(b"\n")?;
        asking.flush()
    }
}

/// Reads until there is no more, handing answers to whoever asked and events to
/// whoever is following.
///
/// The events are handed over on a thread of their own. A follower does its
/// own work, and some of that work is asking the program something -- which is
/// an answer this thread would have to read. So this thread only reads and
/// routes, and the telling is queued to one that does nothing else, in the
/// order it arrived.
///
/// The end of the socket is the end of the program. Everything still waiting is
/// told so rather than left waiting, and every session this side knew of is
/// told to have ended -- because from here, it has.
#[allow(clippy::too_many_arguments)]
fn read(
    stream: TcpStream,
    hello: SyncSender<Value>,
    waiting: Arc<Mutex<Waiting>>,
    gone: Arc<AtomicBool>,
    following: Arc<Mutex<Vec<Follower>>>,
    reporting: Arc<Mutex<Vec<Reporter>>>,
    known: Arc<Mutex<HashSet<String>>>,
    coming: Arc<Mutex<Option<Coming>>>,
) {
    let (telling, told) = std::sync::mpsc::channel::<Told>();
    std::thread::spawn(move || tell_each(told, following, reporting, known, coming));

    let mut lines = BufReader::new(stream).lines();
    if let Some(Ok(line)) = lines.next()
        && let Ok(said) = serde_json::from_str::<Value>(&line)
    {
        let _ = hello.send(said);
    }
    drop(hello);

    for line in lines.map_while(Result::ok) {
        let Ok(said) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        if let Some(id) = said["id"].as_u64() {
            let Some(asked) = lock(&waiting).at.remove(&id) else {
                continue;
            };
            let _ = asked.send(if said["unknown"] == json!(true) {
                Said::Unknown
            } else if let Some(but) = said["but"].as_str() {
                Said::Failed(but.to_string())
            } else {
                Said::Answered(said["said"].clone())
            });
            continue;
        }
        if let Ok(told) = serde_json::from_value::<Told>(said)
            && telling.send(told).is_err()
        {
            break;
        }
    }

    gone.store(true, Ordering::Relaxed);
    // Dropping each sender is what wakes the question waiting on it; dropping
    // the telling is what tells the followers the rest.
    lock(&waiting).at.clear();
}

/// Tells the followers what arrived, in order, until nothing more will.
fn tell_each(
    told: std::sync::mpsc::Receiver<Told>,
    following: Arc<Mutex<Vec<Follower>>>,
    reporting: Arc<Mutex<Vec<Reporter>>>,
    known: Arc<Mutex<HashSet<String>>>,
    coming: Arc<Mutex<Option<Coming>>>,
) {
    for told in told {
        match &told {
            Told::Coming { taken, length } => {
                if let Some(watching) = lock(&coming).as_ref() {
                    watching(*taken, *length);
                }
            }
            Told::Report { id, report } => {
                let reported = crate::door::Reported {
                    id: id.clone(),
                    report: report.clone(),
                };
                for reporter in lock(&reporting).clone() {
                    reporter(&reported);
                }
            }
            _ => {
                if let Some((id, event)) = told.event() {
                    match event {
                        Event::Opened { .. } => {
                            lock(&known).insert(id.to_string());
                        }
                        Event::Ended => {
                            lock(&known).remove(id);
                        }
                        _ => {}
                    }
                    tell(&following, id, event);
                }
            }
        }
    }

    // The program has gone, and with it every session this side knew of.
    let ended: Vec<String> = lock(&known).drain().collect();
    for id in ended {
        tell(&following, &id, Event::Ended);
    }
}

/// Tells every follower, with the list copied out first: a follower does its
/// own work, and holding the list across that would put every event behind
/// whatever the slowest of them is doing.
fn tell(following: &Mutex<Vec<Follower>>, id: &str, event: Event<'_>) {
    let following: Vec<Follower> = lock(following).clone();
    for follower in following {
        follower(id, event);
    }
}

/// Starts the program, as nobody's child.
fn start(program: &Path, home: &Path) -> Result<(), String> {
    std::fs::create_dir_all(home).map_err(|error| format!("{}: {error}", home.display()))?;
    let mut command = Command::new(program);
    command
        .arg("--home")
        .arg(home)
        .current_dir(home)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    crate::serve::detach(&mut command);
    command
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("{}: {error}", program.display()))
}

impl Drop for Link {
    /// Closes the socket outright rather than letting it go: the reading thread
    /// holds the other half, and a socket one half of which is still open is a
    /// window the program goes on counting.
    fn drop(&mut self) {
        if let Some(asking) = lock(&self.asking).take() {
            let _ = asking.shutdown(std::net::Shutdown::Both);
        }
    }
}

impl Link {
    /// The sessions this side has been told of, for whatever wants to ask
    /// about each of them again.
    pub fn known(&self) -> Vec<String> {
        lock(&self.known).iter().cloned().collect()
    }

    /// Notes a session this side learned of by asking rather than by being
    /// told, so that the program going away is read as that session ending.
    pub fn know(&self, id: &str) {
        lock(&self.known).insert(id.to_string());
    }
}
