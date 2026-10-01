//! Passwords typed for a machine, held for as long as the app runs.
//!
//! The one thing in this crate that is remembered between two calls. A machine
//! that takes a password rather than a key would otherwise ask for it on every
//! connection — and the held-open channels, the scans and the watches each open
//! one of their own — so what the user typed once is kept here, in memory only,
//! and handed to `ssh` again each time it asks. Nothing is written anywhere: a
//! restarted app asks again, which is the price of never having a password on
//! disk.
//!
//! Keyed by the host exactly as it is spelled in the path, the same string
//! `ssh` is handed; two spellings of one machine are two entries, which costs
//! nothing worse than a second question.

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

use crate::sync::lock;

type Store = Mutex<HashMap<String, String>>;

fn store() -> &'static Store {
    static STORE: OnceLock<Store> = OnceLock::new();
    STORE.get_or_init(Store::default)
}

/// Keeps `password` for `host`, replacing whatever was kept before.
pub fn remember(host: &str, password: &str) {
    lock(store()).insert(host.to_string(), password.to_string());
}

/// Drops the password kept for `host`, if there was one — after it turned out
/// to be wrong, so that the next connection goes back to asking.
pub fn forget(host: &str) {
    lock(store()).remove(host);
}

/// The password kept for `host`, if one is.
pub fn known(host: &str) -> Option<String> {
    lock(store()).get(host).cloned()
}
