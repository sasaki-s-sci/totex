//! Asking a layer that is a program of its own.
//!
//! Two pipes and lines of JSON between them — see `layer/src/serve.rs` for the
//! other end of it. Nothing is listening on a port and nothing is on the disk
//! for another program to find: the only thing that can ask this layer anything
//! is the program holding the pipes, which is this one.
//!
//! Answers come back in whatever order they finish in, so every question goes
//! out under a number and waits on a channel of its own. What that buys is a
//! layer that is no slower than the built-in copy: a listing of a directory
//! inside a distribution takes as long as the distribution takes, and the rest
//! of the window is not held behind it.

use std::collections::{HashMap, HashSet};
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{SyncSender, sync_channel};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde_json::{Value, json};

use crate::call::PROTOCOL;
use crate::sync::lock;

/// How long a layer is given to say what it is before it is given up on.
///
/// A program that has been started and has not said anything is one that cannot
/// be talked to, whether it is broken, wedged, or not the program it was
/// supposed to be. Generous, because the wait is paid once at a start and once
/// at a swap, and mean enough that a window is not held open on it.
const HELLO: Duration = Duration::from_secs(10);

/// How long a layer that has been let go of is given to end itself.
const FAREWELL: Duration = Duration::from_secs(5);

/// One answer, as the reading thread hands it over.
enum Said {
    Answered(Value),
    Failed(String),
    /// Not this layer's question — see `wrote` in `layer/src/serve.rs`.
    Unknown,
}

/// The questions that have gone out and not come back.
#[derive(Default)]
struct Waiting {
    at: HashMap<u64, SyncSender<Said>>,
    /// Whether the layer has stopped saying anything, ever.
    ended: bool,
}

/// A layer running beside this program.
///
/// Said as what it is rather than as what it holds: the pipes, the questions
/// still out and the process itself are not things anything outside here can
/// do anything with, and a version and a list of names is the whole of what
/// there is to say about one.
pub struct Running {
    version: String,
    /// What it announced it can answer. A name that is not in here is not sent:
    /// an older layer is not asked for something it was built before, it is
    /// simply not the one that answers that question.
    answers: HashSet<String>,
    next: AtomicU64,
    waiting: Arc<Mutex<Waiting>>,
    asking: Mutex<Option<ChildStdin>>,
    /// Kept so that a layer let go of can be waited for, and killed if it will
    /// not go. Taken out of here on the way into [`Running::drop`].
    child: Mutex<Option<Child>>,
    gone: AtomicBool,
}

impl std::fmt::Debug for Running {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Running")
            .field("version", &self.version)
            .field("answers", &self.answers.len())
            .field("gone", &self.gone())
            .finish()
    }
}

impl Running {
    /// Starts one, and finds out what it is before anything is asked of it.
    ///
    /// `version` is what the layer was taken as, and it is compared with what
    /// the layer says it is: a directory under one version holding the program
    /// of another is a download that went somewhere unexpected, and it is worth
    /// knowing at the handshake rather than through answers from a build nobody
    /// chose.
    pub fn start(program: &std::path::Path, version: &str) -> Result<Self, String> {
        let mut command = Command::new(program);
        command
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            // Whatever it has to say for itself that is not an answer is not
            // this program's to relay. Nothing is written on it -- see `main.rs`
            // in the layer -- and a pipe nobody drains is a program that stops.
            .stderr(Stdio::null());
        // A layer reads and writes on pipes and draws nothing, but Windows
        // hands a console to anything built to have one -- so starting it
        // would flash a black window beside the app, or leave one standing.
        // The same thing every other program this app starts is told.
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt as _;
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            command.creation_flags(CREATE_NO_WINDOW);
        }
        let mut child = command
            .spawn()
            .map_err(|error| format!("{}: {error}", program.display()))?;

        let asking = child.stdin.take().ok_or("the layer took no questions")?;
        let saying = child.stdout.take().ok_or("the layer gave no answers")?;

        let waiting = Arc::new(Mutex::new(Waiting::default()));
        let (said, hears) = sync_channel(1);
        let reading = Arc::clone(&waiting);
        std::thread::spawn(move || read(saying, said, reading));

        let hello = hears
            .recv_timeout(HELLO)
            .map_err(|_| "the layer never said what it is".to_string())?;
        let hello = &hello["layer"];
        if hello["protocol"] != json!(PROTOCOL) {
            return Err(format!(
                "that layer speaks {} and this program speaks {}",
                hello["protocol"], PROTOCOL
            ));
        }
        if hello["version"] != json!(version) {
            return Err(format!(
                "v{version} was taken and the layer under it says {}",
                hello["version"]
            ));
        }
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
            version: version.to_string(),
            answers,
            next: AtomicU64::new(1),
            waiting,
            asking: Mutex::new(Some(asking)),
            child: Mutex::new(Some(child)),
            gone: AtomicBool::new(false),
        })
    }

    pub fn version(&self) -> String {
        self.version.clone()
    }

    /// Whether this layer has stopped being one.
    pub fn gone(&self) -> bool {
        self.gone.load(Ordering::Relaxed)
    }

    /// Asks it, or hands the arguments back for somebody else to answer.
    ///
    /// `Err` is not a failure: it is this layer saying the question is not one
    /// of its own, or that it is no longer able to answer anything — and the
    /// arguments come back with it so that the built-in copy can be asked
    /// without them having been copied on the way past.
    pub fn ask(&self, command: &str, with: Value) -> Result<Result<Value, String>, Value> {
        if self.gone() || !self.answers.contains(command) {
            return Err(with);
        }
        let id = self.next.fetch_add(1, Ordering::Relaxed);
        let mut asked = json!({ "id": id, "do": command, "with": with });
        let line = match serde_json::to_string(&asked) {
            Ok(line) => line,
            Err(error) => return Ok(Err(format!("{command} cannot be asked: {error}"))),
        };

        let (said, hears) = sync_channel(1);
        lock(&self.waiting).at.insert(id, said);
        if self.write(&line).is_err() {
            lock(&self.waiting).at.remove(&id);
            self.ended();
            return Err(asked["with"].take());
        }

        match hears.recv() {
            Ok(Said::Answered(value)) => Ok(Ok(value)),
            Ok(Said::Failed(error)) => Ok(Err(error)),
            Ok(Said::Unknown) => Err(asked["with"].take()),
            // The layer stopped while this question was out. Whatever it was
            // doing is not going to be finished by it, so it is asked again of
            // the copy that cannot stop.
            Err(_) => {
                self.ended();
                Err(asked["with"].take())
            }
        }
    }

    fn write(&self, line: &str) -> std::io::Result<()> {
        let mut asking = lock(&self.asking);
        let asking = asking
            .as_mut()
            .ok_or_else(|| std::io::Error::other("the layer is not being asked anything"))?;
        asking.write_all(line.as_bytes())?;
        asking.write_all(b"\n")?;
        asking.flush()
    }

    fn ended(&self) {
        self.gone.store(true, Ordering::Relaxed);
    }
}

impl Drop for Running {
    /// Lets go, rather than killing.
    ///
    /// Closing the pipe is what tells a layer that nothing more will be asked
    /// of it, and its own answer to that is to finish whatever it is in the
    /// middle of and end — see `serve`. So a layer replaced during a directory
    /// listing is a listing that still gets read. It is given a moment to do
    /// that and then it is not given any longer, because a layer that will not
    /// end on a closed pipe is one that would otherwise be left running for as
    /// long as the app is.
    fn drop(&mut self) {
        drop(lock(&self.asking).take());
        let Some(mut child) = lock(&self.child).take() else {
            return;
        };
        std::thread::spawn(move || {
            let until = std::time::Instant::now() + FAREWELL;
            while std::time::Instant::now() < until {
                match child.try_wait() {
                    Ok(Some(_)) => return,
                    Ok(None) => std::thread::sleep(Duration::from_millis(25)),
                    Err(_) => break,
                }
            }
            let _ = child.kill();
            let _ = child.wait();
        });
    }
}

/// Reads answers until there are no more, and hands each to whoever asked.
///
/// The first line is what the layer says it is, which goes to whoever started
/// it. Everything after is an answer under the number its question went out
/// under. The end of the pipe is the end of the layer, and everything still
/// waiting is told so rather than left waiting for a process that has gone.
fn read(saying: ChildStdout, hello: SyncSender<Value>, waiting: Arc<Mutex<Waiting>>) {
    let mut lines = BufReader::new(saying).lines();
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
        let Some(id) = said["id"].as_u64() else {
            continue;
        };
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
    }

    let mut waiting = lock(&waiting);
    waiting.ended = true;
    // Dropping each sender is what wakes the question waiting on it: what it
    // reads is a channel with nothing coming, which is this layer having gone.
    waiting.at.clear();
}

/// Whether the reading thread has reached the end of the pipe.
///
/// The same fact as [`Running::gone`] from the other side: `gone` is what a
/// question found out, and this is what the reading of the answers found out.
#[cfg(test)]
impl Running {
    pub fn silent(&self) -> bool {
        lock(&self.waiting).ended
    }
}
