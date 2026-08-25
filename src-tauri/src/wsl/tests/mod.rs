//! Every test that runs a command is a real round trip through `wsl.exe`, so it
//! is skipped rather than failed where WSL is not installed — which is every
//! machine the CI builds on.

mod channel;
mod paths;
mod watch;

use super::distros;

/// A distribution to try things in, or `None` where there is none to reach.
pub(super) fn reachable() -> Option<String> {
    distros().into_iter().next()
}
