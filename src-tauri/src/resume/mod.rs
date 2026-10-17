//! What the window needs to know before it runs a job again.
//!
//! A job is something this window launched in a terminal — a coding agent, or
//! a line somebody registered in their space — and a terminal can go away
//! underneath it: an update that restarts the program, a crash, a tab closed by
//! mistake. Running it again is the window's business and is decided on its
//! side. What is here is the two things it cannot find out on its own, because
//! both are questions about the machine the job ran on rather than about the
//! window.
//!
//! The first is whether the world the job was running in is still the world it
//! would be run in — see `fingerprint`. A job that was halfway through a
//! checkout that has since moved on is not one to start again without asking.
//!
//! The second is which session a codex launch became — see `codex`. claude and
//! opencode are told the id of the session to keep, and codex has no way to be
//! told one, so the one it chose has to be found after the fact.

mod codex;
mod fingerprint;

#[cfg(test)]
mod tests;

/// A hash of the world a job is running in, as `guard` says to take it.
///
/// `none` is no hash and nothing read. `git` is the checkout `cwd` is in — its
/// commit and every change on top of it — and no hash where `cwd` is not in
/// one. `cmd:<line>` is whatever `<line>` says and how it exits, run in `cwd`
/// on the machine `cwd` is on. Each comes back named by its kind, `git:<hex>`
/// or `cmd:<hex>`, so two kinds can never be taken for the same world.
///
/// An error only where the question could not be asked: `missing-directory`
/// for a `cwd` that is no longer there, which is itself the answer to whether
/// the job can be run again.
#[tauri::command(async)]
pub fn resume_fingerprint(cwd: String, guard: String) -> Result<Option<String>, String> {
    fingerprint::take(&cwd, &guard)
}

/// The codex sessions started in `cwd` since `since_ms`, oldest first.
///
/// Never an error. A machine that cannot be reached, a codex that was never
/// run there, a file that will not parse: each of them is a session not found,
/// and a session not found is a launch the window cannot resume rather than
/// something to explain.
#[tauri::command(async)]
pub fn resume_codex_sessions(cwd: String, since_ms: u64) -> Vec<String> {
    codex::sessions(&cwd, since_ms)
}
