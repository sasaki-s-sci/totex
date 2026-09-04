//! What the sessions have said, and which session said it.

use super::address::token;
use super::{Door, Report, Reported};

/// Which session an address belongs to, out of the ones actually running.
///
/// Nothing is kept to answer this: the addresses are made from the names of the
/// sessions, so a session that has ended stops answering its own door without
/// anything having to be told to forget it.
pub fn session_of(door: &Door, offered: &str) -> Option<String> {
    // The keys are taken and the lock let go of before the sessions are asked
    // about: this side asks that one what is running and that one asks this side
    // what to put in an environment, so neither may be holding anything.
    let keys = {
        door.standing().as_ref()?;
        door.keys.clone()
    };
    door.sessions
        .running()
        .into_iter()
        .find(|session| token(&keys, &session.id) == offered)
        .map(|session| session.id)
}

/// Keeps what a session said, and tells whoever is listening. An empty report
/// is a session saying there is nothing to show, which is the same thing to a
/// window as never having said anything.
pub fn keep(door: &Door, id: &str, report: Report) {
    let report = {
        let mut said = door.said();
        if report.empty() {
            said.remove(id);
            None
        } else {
            if said.get(id) == Some(&report) {
                return;
            }
            said.insert(id.to_string(), report.clone());
            Some(report)
        }
    };

    door.tell(&Reported {
        id: id.to_string(),
        report,
    });
}

/// Everything being worked on right now.
pub fn reports(door: &Door) -> Vec<Reported> {
    door.said()
        .iter()
        .map(|(id, report)| Reported {
            id: id.clone(),
            report: Some(report.clone()),
        })
        .collect()
}
