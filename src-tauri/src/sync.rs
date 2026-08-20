//! Taking a lock the way this app takes them.

use std::sync::{Mutex, MutexGuard};

/// Locks `mutex`, taking the contents back from a thread that panicked holding it.
///
/// Poisoning is not a failure worth propagating here. Every one of these
/// mutexes holds a map of independent things — one per session, one per open
/// folder, one per running agent — so a panic while one entry was being touched
/// says nothing about the others, and refusing to hand the map over again would
/// take the whole window down with it.
pub fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}
