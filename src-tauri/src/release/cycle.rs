//! The cycle a layer is released on.
//!
//! The pages the window is drawn out of do not have to move with the program
//! that draws them — that is what `src/front` is — so they can be released on
//! their own, and a cycle is the whole of what that means: a tag the versions
//! of that cycle are cut under, and the document a release of it publishes.
//!
//! They are tags on one repository rather than repositories of their own, which
//! is what makes one listing enough to fill every pull-down, and what makes
//! "the newest pages" a thing that can be asked about without a second address
//! being configured anywhere.
//!
//! Which cycle a layer follows is the person's, kept by this program — see
//! `crate::update::kept` — and it starts as the app's own for both, which is
//! the arrangement where one release moves everything and is what a copy that
//! has never been told otherwise should do.

use serde::{Deserialize, Serialize};

/// A cycle, as the window names one.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Cycles {
    /// The app's own: one release, and every layer in it.
    Release,
    /// The pages', for pages that move between releases of the app -- see
    /// `src/front`.
    Front,
}

/// Where the releases of one cycle are, and what each of them publishes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Cycle {
    pub which: Cycles,
    /// What a version of this cycle is tagged under, up to the version itself.
    pub tag: &'static str,
    /// The document a release of it publishes, which is what says where the
    /// downloads are and what they have to be signed with.
    pub manifest: &'static str,
}

/// The two of them.
pub const CYCLES: [Cycle; 2] = [
    Cycle {
        which: Cycles::Release,
        tag: "v",
        manifest: "latest.json",
    },
    Cycle {
        which: Cycles::Front,
        tag: "front-v",
        manifest: "front.json",
    },
];

impl Cycles {
    pub fn cycle(self) -> Cycle {
        CYCLES
            .into_iter()
            .find(|cycle| cycle.which == self)
            .expect("every cycle is in the list of them")
    }
}

impl Cycle {
    /// Whether this is the cycle the app itself is released on, which is the
    /// one whose newest release has an address of its own.
    ///
    /// GitHub keeps one address pointed at the newest release of a repository,
    /// and that is the address the app is configured with. It is the newest
    /// release, not the newest release of a cycle — so for every other cycle,
    /// which version is newest is a thing the listing says and nothing else
    /// does.
    pub fn rides_the_newest(&self) -> bool {
        self.which == Cycles::Release
    }
}
