mod ask;
mod derived;
mod display;
mod front;
mod fs_browse;
mod fs_watch;
mod git;
mod host;
mod mcp;
mod pty;
mod release;
mod stream;
mod sync;
mod update;
mod wsl;

use std::sync::Arc;

use fs_browse::{FileHead, Listing, Place, Root};

/// Every place an explorer pane can be started at: the home directory, the
/// Windows drives and the WSL distributions this platform can reach.
#[tauri::command(async)]
fn list_roots() -> Vec<Root> {
    fs_browse::list_roots()
}

/// Settles one typed path into a folder to keep beside the roots, or refuses
/// it. Off the UI thread for the same reason as the reading below: the one
/// question it asks the disk can be a question asked over a network.
#[tauri::command(async)]
fn resolve_folder(path: String) -> Result<Place, String> {
    fs_browse::resolve_folder(&path)
}

/// Spells out the folders that were kept, which are stored as paths alone.
/// Nothing here reads a disk — see `fs_browse::describe_folders`.
#[tauri::command(async)]
fn describe_folders(paths: Vec<String>) -> Vec<Place> {
    fs_browse::describe_folders(&paths)
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

#[tauri::command(async)]
fn fs_read_file(path: String) -> Result<Vec<u8>, String> {
    fs_browse::read_file(&path)
}

#[tauri::command(async)]
fn fs_create_entry(parent: String, name: String, directory: bool) -> Result<String, String> {
    fs_browse::create_entry(&parent, &name, directory)
}

#[tauri::command(async)]
fn fs_duplicate_file(path: String) -> Result<String, String> {
    fs_browse::duplicate_file(&path)
}

#[tauri::command(async)]
fn fs_rename_file(path: String, name: String) -> Result<String, String> {
    fs_browse::rename_file(&path, &name)
}

#[tauri::command(async)]
fn fs_delete_file(path: String) -> Result<(), String> {
    fs_browse::delete_file(&path)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Before anything builds a window: the window this app draws is undecorated,
    // and only one of the display servers a WSL session offers honours that.
    display::prefer_wayland();

    // Which pages this run draws itself out of, settled before there is a
    // window to draw. `set_assets` hands back what it replaced, so the built-in
    // front is taken out of the context and put back inside the thing that
    // stands in front of it -- see `front` for the whole of why.
    let mut context = tauri::generate_context!();
    let serving = Arc::new(front::Serving::prepare(
        &context.config().identifier,
        env!("CARGO_PKG_VERSION")
            .parse()
            .expect("the crate's own version"),
    ));
    let built_in = context.set_assets(Box::new(front::Nothing));
    context.set_assets(Box::new(front::Front::new(Arc::clone(&serving), built_in)));

    let builder = tauri::Builder::default();

    // Only a desktop build has anything to replace: the two plugins behind the
    // settings dialog's update button are the download-and-swap and the restart
    // that follows it, and neither exists on a phone.
    #[cfg(desktop)]
    let builder = builder
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build());

    builder
        .manage(serving)
        .manage(fs_watch::BrowseWatch::default())
        .manage(git::WatchState::default())
        .manage(git::SessionState::default())
        .manage(pty::PtyState::default())
        .manage(ask::watch::AskState::default())
        .manage(mcp::McpState::default())
        // What the sessions say is read for the questions agents ask, and the
        // reading is registered here rather than built into the sessions
        // themselves — see `derived` for why the two are kept apart, and
        // `pty::follow` for the whole of what joins them.
        .setup(|app| {
            ask::watch::attend(app.handle());
            // And what a session says of its own accord, which arrives through a
            // door of its own rather than out of anything it drew.
            mcp::attend(app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_roots,
            resolve_folder,
            describe_folders,
            read_directory,
            read_file_head,
            write_file,
            fs_read_file,
            fs_create_entry,
            fs_duplicate_file,
            fs_rename_file,
            fs_delete_file,
            update::update_standing,
            update::take_whole,
            release::fetch::update_versions,
            front::take::take_front,
            front::take::confirm_front,
            derived::rederive,
            fs_watch::watch_directories,
            git::git_version,
            git::repository_counts,
            git::changes::directory_changes,
            git::session::scan_workspace,
            git::session::close_workspace,
            git::workspace::tree::create_workspace,
            git::workspace::tree::open_workspace,
            git::workspace::tree::remove_workspace,
            git::workspace::tree::delete_branch,
            git::workspace::status::workspace_statuses,
            git::workspace::history::merge_branch,
            git::remote::fetch_branch,
            git::workspace::history::revert_commit,
            git::workspace::history::cherry_pick_commit,
            git::workspace::history::undo_commit,
            pty::spawn::pty_open,
            pty::control::pty_sessions,
            pty::control::pty_attach,
            pty::control::pty_write,
            pty::control::pty_resize,
            pty::control::pty_close,
            ask::watch::pty_asking,
            ask::watch::answer::pty_answer,
            ask::watch::answer::pty_reply,
            ask::watch::answer::pty_take,
            ask::watch::adjust::pty_point,
            ask::watch::adjust::pty_pick,
            ask::watch::adjust::pty_compose,
            mcp::mcp_serving,
            mcp::mcp_serve,
            mcp::mcp_stop,
            mcp::mcp_reports,
            mcp::mcp_install,
        ])
        .run(context)
        .expect("error while running tauri application");
}
