//! Getting into a machine over ssh: whether it lets this app in, and the
//! password for one that will not without it.
//!
//! The answers are the words the window branches on. `"ok"` is a machine a
//! command ran on; `"password"` is one that wants a password typed — or, after
//! one was, wants a different one. A changed host key and a machine that could
//! not be reached at all are errors, because there is nothing the window can
//! put to the user that would fix them from here.

use totex_host::ssh::{self, Reached, secrets};

/// Tries `host` with whatever is known for it, and says what came of it.
///
/// Off the UI thread: a machine that is not there takes the connect timeout to
/// say so.
#[tauri::command(async)]
pub fn ssh_reach(host: String) -> Result<String, String> {
    answer(ssh::reach(&host))
}

/// Keeps `password` for `host` and tries it.
///
/// A password that does not get in is forgotten again straight away, so that
/// it is never handed to `ssh` behind the user's back on the next connection —
/// each one a failed attempt the machine may count against the account.
#[tauri::command(async)]
pub fn ssh_password(host: String, password: String) -> Result<String, String> {
    secrets::remember(&host, &password);
    let reached = ssh::reach(&host);
    if reached != Reached::Ok {
        secrets::forget(&host);
    }
    answer(reached)
}

/// The word the window is given for what trying a machine came to.
fn answer(reached: Reached) -> Result<String, String> {
    match reached {
        Reached::Ok => Ok("ok".to_string()),
        Reached::NeedsPassword => Ok("password".to_string()),
        Reached::HostKey => Err("ssh-host-key".to_string()),
        Reached::Unreachable(said) => Err(format!("ssh-unreachable: {said}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn each_outcome_is_the_word_the_window_branches_on() {
        assert_eq!(answer(Reached::Ok), Ok("ok".to_string()));
        assert_eq!(answer(Reached::NeedsPassword), Ok("password".to_string()));
        assert_eq!(answer(Reached::HostKey), Err("ssh-host-key".to_string()));
        assert_eq!(
            answer(Reached::Unreachable(
                "ssh: connect to host box port 22: Connection refused".to_string()
            )),
            Err(
                "ssh-unreachable: ssh: connect to host box port 22: Connection refused".to_string()
            )
        );
    }
}
