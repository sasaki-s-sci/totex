//! The application layer: what the app knows how to ask of the machine.
//!
//! One half of the backend, and the half that moves. The other half is the
//! program above this one — the window, the terminals running under it, the
//! watchers, and everything written to disk — and it is the half that cannot be
//! replaced without ending what it is holding. This one holds nothing: every
//! answer in here is a question about the machine asked and answered on the
//! spot, so replacing it costs nothing but the asking of the next question.
//!
//! That is the whole of the arrangement, and it is a rule rather than a
//! description. Anything that remembers something between two calls belongs
//! above: a running shell, a directory being watched, a file the app keeps for
//! itself. Anything that is a question — what is in this directory, what is
//! this file, where can this window be opened — belongs here.
//!
//! ## Two copies of it
//!
//! The program above links this crate, so it always has one of these to ask.
//! The same code is also a program of its own — see `main.rs` — which is what a
//! release of this layer actually ships: a small binary the app downloads,
//! stands beside itself, and asks instead. Both go through [`answer`], so what
//! is asked and what comes back are the same either way, and the only
//! difference is which process did the work.
//!
//! When the downloaded one is replaced, the app stops asking the old process
//! and starts asking the new one. Nothing else moves: the window is not
//! reloaded, and every terminal the program above is holding goes on running,
//! because none of them were ever in here.

pub mod fs_browse;
pub mod host;
pub mod sync;
pub mod wsl;

mod call;
mod serve;
mod talk;

pub use call::{ANSWERS, PROTOCOL, answer};
pub use serve::serve;
pub use talk::Running;

/// The version of this layer, which is its crate's own.
///
/// Its own and not the app's, because the two are released on cycles that can
/// be set apart -- see `src/update` in the crate above. What the program
/// carrying this copy says it is has nothing to do with what this is.
pub const VERSION: &str = env!("CARGO_PKG_VERSION");
