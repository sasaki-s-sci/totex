mod agent;
mod display;
mod fs_browse;
mod fs_watch;
mod git;
mod pty;
mod running;
mod stream;
mod sync;

use fs_browse::{FileHead, Listing, Root};

/// Every place an explorer pane can be started at: the home directory, the
/// Windows drives and the WSL distributions this platform can reach.
#[tauri::command(async)]
fn list_roots() -> Vec<Root> {
    fs_browse::list_roots()
}

/// Reads one directory. Run off the UI thread because `\\wsl.localhost\...`
/// and `/mnt/c/...` are network-backed and can take a moment to answer.
#[tauri::command(async)]
fn read_directory(path: String, show_hidden: bool) -> Result<Listing, String> {
    fs_browse::read_directory(&path, show_hidden)
}

/// Reads only enough of a file to draw its preview card on the canvas.
#[tauri::command(async)]
fn read_file_head(path: String) -> Result<FileHead, String> {
    fs_browse::read_file_head(&path)
}

/// Writes an edited card back to its file, and answers with how long it now is.
#[tauri::command(async)]
fn write_file(path: String, text: String, expect_size: u64) -> Result<u64, String> {
    fs_browse::write_file(&path, &text, expect_size)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Before anything builds a window: the window this app draws is undecorated,
    // and only one of the display servers a WSL session offers honours that.
    display::prefer_wayland();

    tauri::Builder::default()
        .manage(fs_watch::BrowseWatch::default())
        .manage(git::WatchState::default())
        .manage(git::SessionState::default())
        .manage(pty::PtyState::default())
        .manage(agent::AgentState::default())
        .manage(running::RunningWatch::default())
        .invoke_handler(tauri::generate_handler![
            list_roots,
            read_directory,
            read_file_head,
            write_file,
            fs_watch::watch_directories,
            git::git_version,
            git::repository_counts,
            git::session::scan_workspace,
            git::session::close_workspace,
            git::workspace::create_workspace,
            git::workspace::open_workspace,
            git::workspace::remove_workspace,
            git::workspace::delete_branch,
            git::workspace::workspace_status,
            git::workspace::workspace_statuses,
            git::workspace::merge_branch,
            git::workspace::revert_commit,
            git::workspace::cherry_pick_commit,
            git::workspace::undo_commit,
            pty::pty_open,
            pty::pty_attach,
            pty::pty_write,
            pty::pty_run,
            pty::pty_resize,
            pty::pty_close,
            agent::agent_send,
            agent::agent_cancel,
            running::running_scan,
            running::running_watch,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
