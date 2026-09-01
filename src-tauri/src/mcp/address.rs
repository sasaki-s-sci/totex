//! A session's own door, and whether it can reach it at all.

use std::collections::HashMap;
use std::collections::hash_map::RandomState;
use std::hash::BuildHasher;
use std::path::Path;
use std::sync::{Mutex, OnceLock};

use tauri::{AppHandle, Manager, Runtime};

use super::{LOOPBACK, McpState};
use crate::host::Host;
use crate::wsl;

/// What a session is handed so that whatever is run in it can find its own
/// door: the whole address, for an agent that expands one out of its
/// environment, and the same token on its own for an agent that can only be
/// told the name of a variable to read a credential from.
///
/// Both or neither. Which of the two an agent reads is the agent's business,
/// and a terminal is dressed before anybody knows which one will be run in it.
/// Handed to a shell as it starts and never again, so a terminal opened before
/// the server went up has nothing of this in it.
pub fn dressing<R: Runtime>(app: &AppHandle<R>, id: &str, cwd: &str) -> Vec<(String, String)> {
    let Some((url, token)) = door(app, id, cwd) else {
        return Vec::new();
    };
    vec![
        (super::ADDRESS_VAR.to_string(), url),
        (super::TOKEN_VAR.to_string(), token),
    ]
}

/// A session's own door, as the address it is reached at and as the token that
/// address is made of, or nothing where this session is to have none.
///
/// Three things have to agree, and each of them says a different kind of no: no
/// server was asked for, no route from where this shell is standing, and no
/// wish for one in the folder it is standing in.
fn door<R: Runtime>(app: &AppHandle<R>, id: &str, cwd: &str) -> Option<(String, String)> {
    // Read and let go of before anything else happens: what follows can ask a
    // distribution a question, and every other door would wait on the answer.
    let (port, keys) = {
        let state = app.state::<McpState>();
        let standing = state.standing();
        (standing.as_ref()?.port, state.keys.clone())
    };
    let host = reachable(cwd)?;
    // What the folder itself says, which is the one answer that is nobody's
    // guess: the switch above says there may be a door, `reachable` says it can
    // be got at from here, and this says whether anybody working here wanted
    // one. A space that has never been asked wants one — see `space::Settings`.
    if !crate::space::settings(Path::new(cwd)).mcp {
        return None;
    }
    let token = token(&keys, id);
    Some((format!("http://{host}:{port}/s/{token}"), token))
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
