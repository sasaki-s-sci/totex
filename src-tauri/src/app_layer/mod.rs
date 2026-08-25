//! Which copy of the application layer answers, and replacing it while the app
//! goes on running.
//!
//! The backend comes in two halves and only one of them can be replaced cheaply.
//! This program is the other one: it owns the window, every terminal running
//! under it, the watchers, and everything the app keeps on disk — so replacing
//! it means an installer and a restart, and the restart ends every terminal.
//! The application layer owns none of that. Every question in it is asked and
//! answered on the spot — see [`totex_layer`] — so a newer one can be put in
//! front of the old one between two questions, and nothing that was running is
//! any the wiser.
//!
//! ## Two copies, one table
//!
//! This program links the layer, so it always has one to ask. A release of the
//! layer is the same code built as a program of its own, which is downloaded,
//! kept under its version, and started beside this one; both are asked the same
//! way, through the same table of names — [`totex_layer::answer`] — so the
//! answer to a question does not depend on which of them was asked.
//!
//! That is also why the built-in copy is asked through JSON rather than called
//! outright, which it plainly could be. A layer standing in front is asked down
//! a pipe and can only be asked in JSON; if the built-in one were called
//! directly it would be a second way of asking, and a disagreement between the
//! two would be a bug that only appears once a layer has been taken. One way of
//! asking is worth more than the conversion it costs.
//!
//! ## Falling back rather than failing
//!
//! A layer that will not start, that stops, or that is asked something it was
//! built before is never an error the window sees. The built-in copy is behind
//! every question, and it is what answers — which is what makes taking one of
//! these a thing that can be done to a running app at all. The row in the
//! settings dialog says which one is actually answering, so a layer that quietly
//! went away is a thing somebody can see rather than a thing they cannot.

mod take;
#[cfg(test)]
mod tests;

use std::path::PathBuf;
use std::sync::{Arc, RwLock};

use serde::Serialize;
use serde_json::Value;

use totex_layer::Running;

/// The name of the layer's program, as `cargo build` leaves it.
#[cfg(windows)]
const PROGRAM: &str = "totex-layer.exe";
#[cfg(not(windows))]
const PROGRAM: &str = "totex-layer";

/// What is written beside a layer that has been taken, saying what it is.
///
/// The layer keeps nothing itself — that is the whole of what makes it
/// replaceable — so what it is, is remembered here, by the half of the app that
/// remembers things.
#[derive(Serialize, serde::Deserialize)]
struct Taken {
    /// The release the layer came out of.
    version: String,
    /// The conversation it speaks — see [`totex_layer::PROTOCOL`]. Written down
    /// rather than trusted, because the program above it can be replaced with
    /// an older one afterwards, and a layer this program cannot talk to is one
    /// it must not start.
    protocol: u32,
}

/// The name that file is kept under.
const TAKEN: &str = "taken.json";

/// Which copy of the layer is answering.
pub struct Layers {
    /// Where taken layers are kept, or nothing on a machine with no data
    /// directory — which is a machine that can only ever run the layer it was
    /// installed with.
    home: Option<PathBuf>,
    /// The version of the layer this program carries, which is the crate's own
    /// — held rather than read so that a test can say what it is, since what a
    /// row does about a release depends entirely on what is already here.
    built: String,
    /// The one standing in front of the built-in copy, if any.
    front: RwLock<Option<Arc<Running>>>,
}

impl Layers {
    /// Settles which layer this run starts with, and clears away the rest.
    ///
    /// A layer that will not start is deleted on the way past rather than left
    /// to be tried again on every start: what is drawn instead is the copy this
    /// program carries, which is the one it was built against.
    pub fn prepare(identifier: &str) -> Self {
        Self::at(dirs::data_dir().map(|dir| dir.join(identifier).join("layer")))
    }

    /// The same, told where to keep them.
    ///
    /// Where a machine keeps things is one question and what is kept there is
    /// another, and only the second one is worth running a test against.
    pub fn at(home: Option<PathBuf>) -> Self {
        Self::carrying(home, totex_layer::VERSION)
    }

    /// The same, told which layer this program carries.
    ///
    /// The version of the built-in copy decides what every press on the layer's
    /// row does — a release that is the version already here is a press with
    /// nothing to do — so it is the one thing a test of that row has to be able
    /// to say.
    pub fn carrying(home: Option<PathBuf>, built: &str) -> Self {
        let layers = Self {
            home,
            built: built.to_string(),
            front: RwLock::new(None),
        };
        match layers.kept() {
            None => layers.forget(),
            Some(taken) => match layers.start(&taken.version) {
                Ok(()) => layers.clear_away(Some(&taken.version)),
                // One that will not start is one no later run will get any
                // further with: what answers instead is the copy this program
                // carries, which is the one it was built against.
                Err(_) => layers.forget(),
            },
        }
        layers
    }

    /// Whether this machine has anywhere to keep a layer at all.
    pub fn keeps(&self) -> bool {
        self.home.is_some()
    }

    /// The version actually answering questions.
    pub fn version(&self) -> String {
        self.running()
            .map_or_else(|| self.built.clone(), |running| running.version())
    }

    fn running(&self) -> Option<Arc<Running>> {
        self.front.read().ok().and_then(|front| front.clone())
    }

    /// Whether a layer of its own is what is answering, rather than the copy
    /// this program carries.
    ///
    /// The two say the same version whenever the taken one is the same release
    /// as the built-in one, which is the ordinary case and the reason this is
    /// asked at all rather than read off [`Layers::version`].
    #[cfg(test)]
    pub(crate) fn beside(&self) -> bool {
        self.running().is_some()
    }

    /// Asks whichever layer is in front, and answers out of the built-in copy
    /// wherever that one cannot.
    pub fn ask<T: for<'a> serde::Deserialize<'a>>(
        &self,
        command: &str,
        with: Value,
    ) -> Result<T, String> {
        let said = self.answer(command, with)?;
        serde_json::from_value(said)
            .map_err(|error| format!("the layer answered {command} with something else: {error}"))
    }

    /// The same, as far as the JSON.
    fn answer(&self, command: &str, with: Value) -> Result<Value, String> {
        let with = match self.running() {
            None => with,
            // A layer hands the arguments back rather than an error when the
            // question is not one of its own, which is the one answer that is
            // not an answer: it is an older layer being asked for something
            // this program learned later.
            Some(running) => match running.ask(command, with) {
                Ok(answer) => return answer,
                Err(with) => {
                    // Whatever it was, it is not answering this. Nothing is left
                    // in front of the built-in copy, and the row in the settings
                    // dialog says so from here on.
                    if running.gone() {
                        self.drop_front();
                    }
                    with
                }
            },
        };
        totex_layer::answer(command, with)
            .unwrap_or_else(|| Err(format!("nothing in this app answers {command}")))
    }

    /// Puts a layer in front of the built-in copy, and lets go of the one it
    /// replaced.
    ///
    /// The old one is not killed. It is let go of, which closes the pipe it is
    /// being asked down — and a layer whose pipe has closed finishes whatever it
    /// was in the middle of and ends itself. So a swap in the middle of a
    /// directory being read is a directory that is still read.
    fn point_at(&self, running: Arc<Running>) {
        if let Ok(mut front) = self.front.write() {
            *front = Some(running);
        }
    }

    fn drop_front(&self) {
        if let Ok(mut front) = self.front.write() {
            *front = None;
        }
    }
}
