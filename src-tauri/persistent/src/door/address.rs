//! A session's own door, and whether it can reach it at all.

use std::collections::hash_map::RandomState;
use std::hash::BuildHasher;

use totex_host::host::Host;

use super::{Door, LOOPBACK};

/// What a session is handed so that whatever is run in it can find its own
/// door: the whole address, for an agent that expands one out of its
/// environment, and the same token on its own for an agent that can only be
/// told the name of a variable to read a credential from.
///
/// Both or neither. Which of the two an agent reads is the agent's business,
/// and a terminal is dressed before anybody knows which one will be run in it.
/// Handed to a shell as it starts and never again, so a terminal opened before
/// the server went up has nothing of this in it.
pub fn dressing(door: &Door, id: &str, cwd: &str) -> Vec<(String, String)> {
    let Some((url, token)) = address(door, id, cwd) else {
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
/// The global switch enables every folder whose shell can reach this server.
fn address(door: &Door, id: &str, cwd: &str) -> Option<(String, String)> {
    let (port, keys) = {
        let standing = door.standing();
        (standing.as_ref()?.port, door.keys.clone())
    };
    let host = reachable(cwd)?;
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
/// A session in a WSL distribution is handed the same loopback address. Its
/// agent does not dial it from the distribution, whose loopback is this
/// machine's only under mirrored networking: it is registered there with a
/// bridge that posts through Windows' own curl — see `install` — which is on
/// this machine's loopback whatever networking the distribution has. A
/// session on a machine reached over ssh is never in doubt: that machine's
/// loopback is its own, and this server listens on nothing else.
fn reachable(cwd: &str) -> Option<&'static str> {
    match Host::of_str(cwd) {
        Host::Local | Host::Wsl(_) => Some(LOOPBACK),
        // Another machine cannot reach this server's loopback.
        Host::Ssh(_) => None,
    }
}
