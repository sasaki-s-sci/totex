//! Filesystem browsing primitives shared by the folder picker window and the
//! folder tree of the main window.
//!
//! Paths cross the IPC boundary as plain strings so that Windows locations
//! (`C:\Users\...`, `\\wsl.localhost\Ubuntu\home\...`) and WSL locations
//! (`/home/...`, `/mnt/c/...`) both survive the round trip untouched.
//!
//! A path that names a WSL distribution is not read through the share Windows
//! publishes it under — it is read inside the distribution, by [`crate::host`].
//! The share is bytes over a network filesystem, which is slow enough to be felt
//! in a listing; reaching in is the same reading the distribution's own tools
//! would get.

mod copy;
mod download;
pub mod model;
mod operate;
mod path;
mod read;
mod roots;

#[cfg(test)]
mod tests;

pub use download::download;
pub use model::{FileData, FileHead, Listing, Place, Root};
pub use operate::{
    copy_into, create_entry, delete_file, delete_folder, duplicate_file, read_file, rename_file,
};
pub use path::{describe_folders, home_dir, resolve_folder};
pub use read::{read_directory, read_file_data, read_file_head, write_file};
pub use roots::list_roots;

/// The picker and the tree are interactive views, so oversized directories are
/// cut short instead of shipping a million rows to the webview.
const MAX_ENTRIES: usize = 5_000;

/// How much of a file a card on the canvas is given. A card is the top of a
/// file, not a document view, and reading a gigabyte off a network share to draw
/// twenty lines of it is what this number prevents.
const MAX_FILE_HEAD: u64 = 64 * 1024;

/// How large a picture a card will draw. Nothing of a picture can be left out —
/// see [`read_file_data`] — so the whole of it crosses to the window and stays
/// there while the card stands, and this is where that stops being a thing to
/// do without asking.
const MAX_FILE_DATA: u64 = 16 * 1024 * 1024;
