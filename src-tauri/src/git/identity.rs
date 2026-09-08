use std::path::Path;

use serde::Serialize;

use super::cmd;

#[derive(Serialize)]
pub struct Identity {
    author: Option<String>,
    committer: Option<String>,
}

// Git resolves includes, per-worktree config, role-specific config and the
// app's inherited environment. The terminal's later exports are not available here.
pub(super) fn read(dir: &Path) -> Result<Identity, String> {
    cmd::run(dir, &["rev-parse", "--git-dir"])?;
    Ok(Identity {
        author: ident(dir, "GIT_AUTHOR_IDENT"),
        committer: ident(dir, "GIT_COMMITTER_IDENT"),
    })
}

fn ident(dir: &Path, role: &str) -> Option<String> {
    let output = cmd::run(dir, &["var", role]).ok()?;
    // Strip the timestamp and timezone without splitting names containing spaces.
    let end = output.rfind('>')?;
    Some(output[..=end].to_string())
}

#[tauri::command(async)]
pub fn git_identity(path: String) -> Result<Identity, String> {
    read(Path::new(&path))
}
