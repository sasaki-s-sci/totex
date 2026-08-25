//! What a listing, a root and a card are, as the window receives them.
//!
//! Read back as well as written, because these cross one more boundary than
//! they used to: the layer that fills them in may be a program of its own -- see
//! `crate::serve` -- and the program above it reads them back out of the JSON
//! before handing them to the window.

use serde::{Deserialize, Serialize};

/// Where a root comes from, so the frontend can group and label the rail. The
/// frontend knows every variant even though each host only produces some.
#[allow(dead_code)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum RootKind {
    /// The current user's home directory.
    Home,
    /// A drive letter of the Windows host (`C:\`).
    WindowsDrive,
    /// A WSL distribution, reached inside itself rather than over its share.
    WslDistro,
    /// The `/` of the Linux/WSL filesystem.
    UnixRoot,
    /// A Windows drive mounted inside WSL (`/mnt/c`).
    WindowsMount,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Root {
    pub kind: RootKind,
    pub label: String,
    pub path: String,
    /// Secondary line shown under the label, when it adds something.
    pub detail: Option<String>,
}

/// A folder someone typed and kept, spelled out for the row that offers it.
///
/// Not a [`Root`]: those are what the machine has, worked out afresh every time
/// the menu is opened. This is the other kind — a place that exists because a
/// person named it, which between two windows is only ever a path.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Place {
    /// What a pane is started at: folded, and spelled the way every path in
    /// this app is spelled.
    pub path: String,
    /// The folder's own name, which is what the row is read by.
    pub label: String,
    /// The whole of it with the home directory written `~`, for the line under
    /// the name — a column this narrow has no width to spend on every row.
    pub display: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub is_symlink: bool,
    pub is_hidden: bool,
    /// Byte size of files; directories report `null`.
    pub size: Option<u64>,
    /// Modification time as milliseconds since the Unix epoch.
    pub modified_ms: Option<u64>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Listing {
    /// The directory that was actually read, which may differ from the request
    /// once `~` expansion or `..` folding ran.
    pub path: String,
    pub name: String,
    pub parent: Option<String>,
    /// The distribution the directory is inside, when it is inside one — what
    /// the window puts beside a Linux path so it reads as one place and not as
    /// this machine's own `/home`.
    pub distro: Option<String>,
    pub entries: Vec<Entry>,
    /// Set when the directory holds more than [`super::MAX_ENTRIES`] children.
    pub truncated: bool,
}

/// The top of one file, for the card the canvas draws it in.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileHead {
    /// The file that actually answered, which may differ from the request once
    /// `~` expansion or `..` folding ran.
    pub path: String,
    pub name: String,
    /// As much of the file as was read, when the bytes are text at all. `None`
    /// says they are not, which the card draws as a body it cannot show.
    pub text: Option<String>,
    /// The whole file's size, which is what says the card shows part of it.
    pub size: u64,
    /// Set when the file runs past what was read. See [`super::MAX_FILE_HEAD`].
    pub truncated: bool,
}
