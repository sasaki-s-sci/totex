//! What the checkouts under a folder that is not one come to.
//!
//! A folder outside every repository has nothing for git to say about its
//! rows, but a row leading down to a checkout that has moved is worth seeing
//! from up there: the colour climbs out of the repository and through every
//! folder above it, as it climbs from a ring to a folder on the graph. A row
//! takes what the checkouts under it come to, by the graph's rule rather than
//! the column's — a checkout is one place, so it is weighed by its counts as
//! its ring is.

use std::collections::HashMap;
use std::path::{Component, Path, PathBuf};
use std::sync::{LazyLock, Mutex, MutexGuard, PoisonError};
use std::time::{Duration, Instant};

use super::{Change, note};
use crate::git::workspace::WorktreeStatus;
use crate::git::workspace::status::read_status;
use crate::git::{HOLDING_BUDGET, SCAN_DEPTH, discover, parallel_map};

/// How long a walk for the checkouts under a folder is believed.
///
/// The column asks every few seconds and the walk is the expensive half: a
/// repository appearing is rarer than a file changing in one, and it is seen
/// within this much anyway.
const WALK_KEPT: Duration = Duration::from_secs(30);

/// The checkouts each folder was last found to hold, and when.
type Walks = HashMap<PathBuf, (Instant, Vec<PathBuf>)>;

static WALKS: LazyLock<Mutex<Walks>> = LazyLock::new(Mutex::default);

/// What became of each row of `dir` that leads to a checkout that has moved.
///
/// `None` when there is no checkout under it at all, which is the folder git
/// would not answer for that it was before this was asked.
pub(super) fn read_above(dir: &Path) -> Option<HashMap<String, Change>> {
    let checkouts = checkouts_under(dir);
    if checkouts.is_empty() {
        return None;
    }

    let mut changed = HashMap::new();
    let read = parallel_map(checkouts, |checkout| {
        let change = read_status(&checkout).and_then(|status| change_of(&status));
        (checkout, change)
    });
    for (checkout, change) in read {
        let Some(change) = change else { continue };
        if let Some(name) = row_of(dir, &checkout) {
            note(&mut changed, &name, change);
        }
    }
    Some(changed)
}

/// The graph's rule for a checkout: the one colour its files agree on, and
/// amber when they do not. See `changeOf` in the window.
fn change_of(status: &WorktreeStatus) -> Option<Change> {
    let WorktreeStatus {
        added,
        deleted,
        modified,
    } = *status;
    match (added, deleted, modified) {
        (0, 0, 0) => None,
        (_, 0, 0) => Some(Change::Added),
        (0, _, 0) => Some(Change::Deleted),
        _ => Some(Change::Modified),
    }
}

/// The name of the row in `dir` that leads to `checkout`.
fn row_of(dir: &Path, checkout: &Path) -> Option<String> {
    match checkout.strip_prefix(dir).ok()?.components().next()? {
        Component::Normal(name) => Some(name.to_string_lossy().into_owned()),
        _ => None,
    }
}

/// The checkouts under `dir`, as the repository pane would list them, walked
/// at most once per `WALK_KEPT`.
fn checkouts_under(dir: &Path) -> Vec<PathBuf> {
    let now = Instant::now();
    if let Some((at, held)) = walks().get(dir)
        && now.duration_since(*at) < WALK_KEPT
    {
        return held.clone();
    }

    // Short rather than missing when the budget runs out: what was found near
    // the top is still worth colouring.
    let listed = discover::list_repositories(dir, SCAN_DEPTH, HOLDING_BUDGET, |_| {}, || true);

    let mut walks = walks();
    walks.retain(|_, (at, _)| now.duration_since(*at) < WALK_KEPT);
    walks.insert(dir.to_path_buf(), (now, listed.repositories.clone()));
    listed.repositories
}

fn walks() -> MutexGuard<'static, Walks> {
    WALKS.lock().unwrap_or_else(PoisonError::into_inner)
}
