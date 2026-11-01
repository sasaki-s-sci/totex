//! The machine, as the app knows it.
//!
//! Shared machine primitives for the window and the persistent service: local,
//! WSL and SSH paths, file transport and process startup. Window-only browsing,
//! file operations, preferences and themes live in the window crate so that
//! updating them never requires replacing the service.
//!
//! Nothing here remembers anything between two calls, save the passwords typed
//! for machines reached over ssh — see `ssh::secrets`, and why. Every answer is
//! a question about the machine asked and answered on the spot, which is what
//! makes it a library rather than a place anything is kept.

mod base64;
pub mod fs_browse;
pub mod host;
pub mod remote;
pub mod space;
pub mod ssh;
pub mod sync;
pub mod wsl;
