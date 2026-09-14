//! Every test that runs a command is a real round trip through `wsl.exe` or
//! `ssh`, so it runs over every far machine there is to reach and over none
//! where there are none. On Linux there is always one: the fake ssh host
//! `crate::host::tests` puts in place, which runs the command here. So the
//! channel, the framing and the poll are exercised on CI through exactly the
//! command lines the real bridge would be given; a distribution on Windows is
//! the same tests over the other bridge.

mod channel;
mod paths;
mod watch;

use super::Reach;

/// Every far machine to try things on, as the way there.
pub(super) fn reachable() -> Vec<Reach> {
    crate::host::tests::reachable()
        .iter()
        .filter_map(|host| host.reach())
        .collect()
}
