//! A distribution to try things in, or nothing to try them in at all.

mod parse;
mod paths;
mod remote;

use std::path::PathBuf;

use super::Host;

/// `None` where there is no WSL to reach — every machine the CI builds on — so
/// the tests below skip rather than fail.
pub(super) fn reachable() -> Option<Host> {
    crate::wsl::distros().into_iter().next().map(Host::Wsl)
}

/// One scratch directory inside the distribution, emptied first. Named after the
/// test that asked for it: these run alongside each other, and a shared
/// directory would be one test clearing another's setup.
pub(super) fn scratch(host: &Host, name: &str) -> PathBuf {
    let dir = host.canonical(&format!("/tmp/totex-host-test/{name}"));
    host.exec(None, &[], &["rm", "-rf", &host.native(&dir)])
        .expect("a shell");
    host.create_dir_all(&dir).expect("a directory");
    dir
}
