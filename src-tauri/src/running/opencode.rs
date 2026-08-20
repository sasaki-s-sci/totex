//! What opencode can be told about, which is less than the other two.
//!
//! Its sessions live in a SQLite database rather than in files — one row per
//! session, with the directory, the parent session and the running cost all in
//! it — and reading that would mean carrying a database engine in this app for
//! one panel. A running `opencode serve` publishes the same thing over HTTP,
//! `GET /session` and `GET /project`, but a terminal session starts no server.
//!
//! So opencode contributes what its command line says: which of its modes is
//! running, and which of its agents was asked for. The directory comes from the
//! process like everyone else's, which is the part the graph is actually drawn
//! from — the rest of what opencode knows is simply not on offer from outside.

/// A run of opencode, as far as its arguments say.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Run {
    /// `serve`, `run`, `web`… or `None` for the terminal it opens by default.
    pub mode: Option<String>,
    /// The agent it was told to use, when it was told.
    pub agent: Option<String>,
}

/// Reads a command line, which is everything opencode says from outside.
pub fn read(args: &[String]) -> Run {
    let mut run = Run::default();
    let mut rest = args.iter().skip(1);
    while let Some(arg) = rest.next() {
        match arg.as_str() {
            "--agent" => run.agent = rest.next().cloned(),
            _ => {
                if let Some(value) = arg.strip_prefix("--agent=") {
                    run.agent = Some(value.to_string());
                } else if run.mode.is_none() && !arg.starts_with('-') {
                    // The first bare word is the subcommand, except that the
                    // default one takes a directory there instead — and a
                    // directory is already known from the process itself.
                    if !arg.contains('/') {
                        run.mode = Some(arg.clone());
                    }
                }
            }
        }
    }
    run
}
