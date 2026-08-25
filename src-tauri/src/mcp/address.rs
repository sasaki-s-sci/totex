//! A session's own door, and whether it can reach it at all.

use std::collections::HashMap;
use std::collections::hash_map::RandomState;
use std::hash::BuildHasher;
use std::sync::{Mutex, OnceLock};

use tauri::{AppHandle, Manager, Runtime};

use super::{LOOPBACK, McpState};
use crate::host::Host;
use crate::wsl;

/// Where a session running in `cwd` is to say what it is doing, if it can reach
/// the server at all. Handed to a shell as it starts and never again, so a
/// terminal opened before the server went up has no address in it.
pub fn address<R: Runtime>(app: &AppHandle<R>, id: &str, cwd: &str) -> Option<String> {
    // Read and let go of before anything else happens: what follows can ask a
    // distribution a question, and every other door would wait on the answer.
    let (port, keys) = {
        let state = app.state::<McpState>();
        let standing = state.standing();
        (standing.as_ref()?.port, state.keys.clone())
    };
    let host = reachable(cwd)?;
    Some(format!("http://{host}:{port}/s/{}", token(&keys, id)))
}

/// A session's own door, which is the whole of what an address says.
pub(super) fn token(keys: &RandomState, id: &str) -> String {
    format!("{:016x}", keys.hash_one(id))
}

/// The address a session working in `cwd` can reach this server at, or nothing
/// where it cannot reach it at all.
///
/// A session in a WSL distribution is the one case where loopback is not one
/// place. Under the networking WSL starts with, a distribution's `127.0.0.1` is
/// its own and the way across is refused by the firewall — so the honest answer
/// there is that there is no address. Under mirrored networking the two
/// loopbacks are one.
fn reachable(cwd: &str) -> Option<&'static str> {
    match Host::of_str(cwd) {
        Host::Local => Some(LOOPBACK),
        Host::Wsl(distro) => shares_loopback(&distro).then_some(LOOPBACK),
    }
}

/// Whether a distribution's loopback is the same one this server is on. Asked
/// once and remembered: it is a setting of the machine's, it cannot change while
/// a distribution is running, and the question is otherwise asked every time a
/// terminal is opened.
pub(super) fn shares_loopback(distro: &str) -> bool {
    static KNOWN: OnceLock<Mutex<HashMap<String, bool>>> = OnceLock::new();
    let known = KNOWN.get_or_init(Mutex::default);

    if let Some(answer) = crate::sync::lock(known).get(distro) {
        return *answer;
    }

    // Anything that cannot answer is a no: an older distribution without
    // `wslinfo` is one from before mirrored networking existed.
    let answer = wsl::exec(distro, None, &[], &["wslinfo", "--networking-mode"])
        .map(|said| said.ok() && said.text().trim() == "mirrored")
        .unwrap_or(false);
    crate::sync::lock(known).insert(distro.to_string(), answer);
    answer
}
