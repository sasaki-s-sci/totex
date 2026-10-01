//! This program standing in as `ssh`'s askpass.
//!
//! `ssh` has no way to be handed a password on its command line, on purpose.
//! What it does have is `SSH_ASKPASS`: a program it runs with the prompt as its
//! one argument, and whose output it takes as the answer. So when a password
//! is known for a machine, `ssh::command` names this very executable there and
//! puts the password in the child's environment; `ssh` starts a second copy of
//! the app, that copy sees `TOTEX_ASKPASS` and does nothing but answer — see
//! [`intercept`], which `main` calls before anything else — and exits. No
//! window is built and nothing is written anywhere.
//!
//! Only a password prompt is answered. A host-key question, a passphrase for a
//! key, anything else `ssh` might ask is refused by exiting non-zero, which
//! `ssh` reads as the user cancelling: a key that wants a passphrase is skipped
//! and the password is asked for next, and a host key is never accepted on
//! the strength of a password having been typed.

use std::io::Write;

/// Set to `1` in the environment of an `ssh` this app started with a password
/// to give, and so in the environment of the copy `ssh` starts to ask.
pub const FLAG: &str = "TOTEX_ASKPASS";

/// Where that copy finds the password.
pub const SECRET: &str = "TOTEX_ASKPASS_SECRET";

/// What to print for `prompt`, or `None` when it is not a question this
/// answers.
///
/// A password prompt is spelled `user@host's password: ` by OpenSSH and
/// `Password: ` or `Password for user@host: ` by the PAM behind
/// keyboard-interactive, so the test is the word, in any case. A yes/no
/// question that happens to mention a password — none does today — is refused
/// all the same, since the answer to it is never a password. An empty secret
/// answers nothing: an empty line would be a wrong password, and one more
/// failed attempt counted against the account.
pub fn answer(prompt: &str, secret: &str) -> Option<String> {
    let prompt = prompt.to_lowercase();
    if secret.is_empty() || !prompt.contains("password") || prompt.contains("yes/no") {
        return None;
    }
    Some(format!("{secret}\n"))
}

/// Answers for `ssh` and exits, when this process was started to; returns
/// otherwise, having touched nothing.
///
/// Called first thing in `main`, before the window: a copy of the app started
/// as an askpass that went on to build a window would be a second app on the
/// screen every time a machine was connected to.
pub fn intercept() {
    if std::env::var_os(FLAG).is_none_or(|flag| flag != "1") {
        return;
    }
    let prompt = std::env::args_os()
        .nth(1)
        .map(|prompt| prompt.to_string_lossy().into_owned())
        .unwrap_or_default();
    let secret = std::env::var(SECRET).unwrap_or_default();
    let Some(reply) = answer(&prompt, &secret) else {
        std::process::exit(1);
    };
    let mut out = std::io::stdout().lock();
    let written = out.write_all(reply.as_bytes()).and_then(|()| out.flush());
    std::process::exit(if written.is_ok() { 0 } else { 1 });
}
