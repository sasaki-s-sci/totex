//! The machine, as the app knows it.
//!
//! Which host a path is on and how to reach it — this machine, or a WSL
//! distribution reached from Windows — and everything the app asks of a folder
//! through that: listing it, reading a file off it, writing one back. A crate
//! of its own so that every program in the workspace can link it without
//! linking the window.
//!
//! Nothing here remembers anything between two calls. Every answer is a
//! question about the machine asked and answered on the spot, which is what
//! makes it a library rather than a place anything is kept.

mod base64;
pub mod fs_browse;
pub mod host;
pub mod space;
pub mod sync;
pub mod wsl;
