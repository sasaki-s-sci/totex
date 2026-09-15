//! Every far machine there is to try things on, or none to try them on at all.
//!
//! A distribution is real or absent: every machine the CI builds on has none,
//! and the tests over one skip rather than fail there. The ssh host is a fake
//! on every Linux build — an `ssh` that runs the command it was handed on this
//! machine instead of anywhere — so the whole remote layer is exercised on CI
//! through exactly the command lines the real `ssh` would be given.

mod parse;
mod paths;
mod remote;

use std::path::PathBuf;

use super::Host;

/// Every far machine to try things on: the first WSL distribution when there
/// is one, and the fake ssh host on Linux. Empty where there is nothing to
/// reach, so a test over it does nothing rather than fails.
pub(crate) fn reachable() -> Vec<Host> {
    let mut hosts: Vec<Host> = crate::wsl::distros()
        .into_iter()
        .next()
        .map(Host::Wsl)
        .into_iter()
        .collect();
    #[cfg(unix)]
    hosts.push(Host::Ssh(fake_ssh().to_string()));
    hosts
}

/// One scratch directory on the far machine, emptied first. Named after the
/// test that asked for it and the machine it is on: the tests run alongside
/// each other, and a shared directory would be one test clearing another's
/// setup — and on a Linux build inside a distribution, that distribution's
/// `/tmp` and the fake ssh host's are the same directory.
pub(crate) fn scratch(host: &Host, name: &str) -> PathBuf {
    // The fake ssh host is this machine, and a sandboxed run of the tests is
    // allowed to write only where this machine's temp dir points; a real
    // distribution has a `/tmp` of its own.
    let base = match host {
        Host::Ssh(_) => std::env::temp_dir().to_string_lossy().into_owned(),
        _ => "/tmp".to_string(),
    };
    let machine = host.remote_name().unwrap_or("here");
    let dir = host.canonical(&format!("{base}/totex-host-test/{machine}/{name}"));
    host.exec(None, &[], &["rm", "-rf", &host.native(&dir)])
        .expect("a shell");
    host.create_dir_all(&dir).expect("a directory");
    dir
}

/// The name the fake ssh host goes by, once the fake is in place.
///
/// The fake is a script that reads the command line `ssh` would be given —
/// its own options, the host, `--` and the command — and runs the command
/// here. `TOTEX_SSH` points `ssh::program` at it. Setting an environment
/// variable is unsafe in this edition because another thread reading the
/// environment through libc at the same moment is a data race; it is
/// acceptable here because the variable is set exactly once, inside this lock,
/// before any test opens an ssh channel, every test that would set it sets the
/// same value, and the readers that exist in this process are std's own, which
/// take std's environment lock.
#[cfg(unix)]
pub(crate) fn fake_ssh() -> &'static str {
    use std::sync::OnceLock;
    static FAKE: OnceLock<()> = OnceLock::new();
    FAKE.get_or_init(|| {
        let script = write_fake_ssh();
        // SAFETY: see above — once, under this lock, and before any channel
        // to the fake has been opened.
        unsafe { std::env::set_var("TOTEX_SSH", &script) };
    });
    "fake"
}

/// Writes the script into a temp dir of this process's own, and answers with
/// where. The options `ssh::command` passes are skipped rather than parsed:
/// the fake is a stand-in for the far end, not a check on the near one — the
/// command line itself is pinned by `ssh::tests`. One host is special: a
/// machine called `unreachable` is answered the way `ssh` answers a machine it
/// cannot connect to, by exiting 255 before anything is run.
#[cfg(unix)]
fn write_fake_ssh() -> PathBuf {
    use std::os::unix::fs::PermissionsExt;
    let dir = std::env::temp_dir().join(format!("totex-fake-ssh-{}", std::process::id()));
    std::fs::create_dir_all(&dir).expect("a temp dir for the fake");
    let script = dir.join("ssh");
    std::fs::write(
        &script,
        "#!/bin/sh\n\
         while [ $# -gt 0 ]; do\n\
         \x20 case \"$1\" in\n\
         \x20   -T|-t) shift ;;\n\
         \x20   -o) shift 2 ;;\n\
         \x20   --) shift ;;\n\
         \x20   *) break ;;\n\
         \x20 esac\n\
         done\n\
         [ \"$1\" = unreachable ] && exit 255\n\
         shift\n\
         [ \"$1\" = \"--\" ] && shift\n\
         exec sh -c \"$*\"\n",
    )
    .expect("write the fake");
    std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755))
        .expect("make it runnable");
    script
}
