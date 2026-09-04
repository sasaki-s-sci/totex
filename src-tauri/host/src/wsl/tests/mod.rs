//! Every test that runs a command is a real round trip through `wsl.exe`, so it
//! is skipped rather than failed where there is no WSL to reach — which is
//! every machine the CI builds on.
//!
//! The skip is declared rather than taken quietly. Off Windows there is no
//! `wsl.exe` at all, so those tests carry `#[ignore]` and the run says so in
//! its own output. A test that returned early instead would be counted as one
//! that passed, and a suite where twelve of them do that reports green for work
//! it never did. On Windows they run for real, and the one case left — Windows
//! with no distribution installed — says so on stderr.

mod channel;
mod paths;
mod watch;

use super::distros;

/// A distribution to try things in, or `None` where there is none to reach.
pub(super) fn reachable() -> Option<String> {
    distros().into_iter().next()
}
