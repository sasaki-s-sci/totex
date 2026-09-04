mod ask;
mod derived;
mod display;
mod front;
mod fs_watch;
mod git;
mod keep;
mod mcp;
mod pty;
mod release;
mod space;
mod tasks;
mod update;

/// The machine, as the app knows it.
///
/// Written as a re-export rather than as modules of this crate because it is a
/// crate of its own, shared with every other program in the workspace.
/// Everything here goes on being `crate::host`, `crate::wsl` and the rest to
/// the program around it, because which crate a question is answered in is not
/// something the asking should have to know.
pub use totex_host::{fs_browse, host, sync, wsl};

use std::sync::Arc;

use fs_browse::{FileData, FileHead, Listing, Place, Root};

/// Every place an explorer pane can be started at: the home directory, the
/// Windows drives and the WSL distributions this platform can reach.
///
/// The first of fifteen that read the same way: every one of these is a
/// question about the machine rather than about the app, and every one of
/// them is answered by `fs_browse` on the spot.
///
/// Off the UI thread, all of them: some ask a disk that is somebody else's.
#[tauri::command(async)]
fn list_roots() -> Vec<Root> {
    fs_browse::list_roots()
}

/// Settles one typed path into a folder to keep beside the roots, or refuses it.
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

/// Reads one directory. `\\wsl.localhost\...` and `/mnt/c/...` are
/// network-backed and can take a moment to answer.
#[tauri::command(async)]
fn read_directory(path: String, show_hidden: bool) -> Result<Listing, String> {
    fs_browse::read_directory(&path, show_hidden)
}

/// Reads only enough of a file to draw its preview card on the canvas.
#[tauri::command(async)]
fn read_file_head(path: String) -> Result<FileHead, String> {
    fs_browse::read_file_head(&path)
}

/// Reads the whole of a file, for a card drawing a picture of it rather than
/// reading it. Bounded, which answers with nothing at all for a file too large
/// to draw.
#[tauri::command(async)]
fn read_file_data(path: String) -> Result<FileData, String> {
    fs_browse::read_file_data(&path)
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

/// The folder itself and everything under it, which is why it is asked for by a
/// name of its own rather than by handing a folder to the one above.
#[tauri::command(async)]
fn fs_delete_folder(path: String) -> Result<(), String> {
    fs_browse::delete_folder(&path)
}

#[tauri::command(async)]
fn fs_download(path: String) -> Result<String, String> {
    fs_browse::download(&path)
}

#[tauri::command(async)]
fn fs_copy_into(paths: Vec<String>, into: String) -> Result<Vec<String>, String> {
    fs_browse::copy_into(&paths, &into)
}

/// Whatever is left to do on the way out, which is one thing: the shells are
/// ended, unless this window is leaving so that another can take its place —
/// see `keep`.
fn on_the_way_out<R: tauri::Runtime>(app: &tauri::AppHandle<R>, event: &tauri::RunEvent) {
    if matches!(event, tauri::RunEvent::Exit) {
        keep::leaving(app);
    }
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
        // The pages' own version and not this program's. They are the same
        // number in a release that moves everything at once, and they are not
        // in a release of the pages alone -- see `release::cycle`. Which front
        // is newer than the built-in one is a question about the pages, so it
        // is the pages' number that answers it.
        env!("FRONT_VERSION")
            .parse()
            .expect("build.rs writes this out of package.json"),
    ));
    let built_in = context.set_assets(Box::new(front::Nothing));
    context.set_assets(Box::new(front::Front::new(Arc::clone(&serving), built_in)));

    // And what the person left the update rows pointed at, which is this
    // program's to remember because it is the layer still there after the
    // pages have been replaced -- see `update::kept`.
    let kept = Arc::new(update::Kept::prepare(&context.config().identifier));

    // And the program holding the terminals, found or started before there is
    // a window to draw them in -- see `keep`. A window that cannot reach one
    // is a window with nothing to draw a terminal of, which is not a window
    // worth opening.
    let link = keep::reach(&context.config().identifier)
        .expect("the program holding the terminals is beside this one");

    tauri::Builder::default()
        .manage(serving)
        .manage(kept)
        .manage(link)
        // A release that has come down and is waiting for the restart -- see
        // `update::ready`.
        .manage(Arc::new(update::Ready::default()))
        .manage(fs_watch::BrowseWatch::default())
        .manage(git::WatchState::default())
        .manage(git::SessionState::default())
        .manage(ask::watch::AskState::default())
        // What the sessions say is read for the questions agents ask, and the
        // reading is registered here rather than built into the sessions
        // themselves — see `derived` for why the two are kept apart, and
        // `keep` for the whole of what joins them. The reading first and the
        // pages second, so that a run of output has been read before it is
        // drawn; and then the sessions already running are read, because a
        // window that has just come up is standing in front of them.
        .setup(|app| {
            ask::watch::attend(app.handle());
            keep::deliver(app.handle());
            ask::watch::rederive(app.handle());
            Ok(())
        })
        // Every command the window may ask for. The names here and the names
        // the window sends are two lists nothing checks against each other,
        // which is what `update::tests::rows` is for on the ones that matter.
        .invoke_handler(tauri::generate_handler![
            list_roots,
            resolve_folder,
            describe_folders,
            read_directory,
            read_file_head,
            read_file_data,
            write_file,
            fs_read_file,
            fs_create_entry,
            fs_duplicate_file,
            fs_rename_file,
            fs_delete_file,
            fs_delete_folder,
            fs_download,
            fs_copy_into,
            update::update_standing,
            update::update_take,
            update::update_pick,
            update::update_follow,
            update::update_restart,
            release::fetch::update_versions,
            release::fetch::update_choices,
            front::take::confirm_front,
            derived::rederive,
            fs_watch::watch_directories,
            git::git_version,
            git::repository_counts,
            git::changes::directory_changes,
            git::patch::file_diff,
            git::message::commit_message,
            git::session::scan_workspace,
            git::session::close_workspace,
            git::workspace::tree::create_workspace,
            git::workspace::tree::open_workspace,
            git::workspace::tree::remove_workspace,
            git::workspace::tree::delete_branch,
            git::workspace::status::workspace_statuses,
            git::workspace::history::merge_branch,
            git::workspace::history::sync_branch,
            git::remote::fetch_branch,
            git::workspace::follow::follow_repository,
            git::workspace::follow::fetch_repository,
            git::workspace::history::revert_commit,
            git::workspace::history::cherry_pick_commit,
            git::workspace::history::undo_commit,
            tasks::directory_tasks,
            space::space_standing,
            space::space_tell,
            pty::pty_open,
            pty::pty_sessions,
            pty::pty_attach,
            pty::pty_write,
            pty::pty_resize,
            pty::pty_close,
            ask::watch::pty_asking,
            ask::watch::pty_typed,
            ask::watch::pty_doing,
            ask::watch::answer::pty_answer,
            ask::watch::answer::pty_reply,
            ask::watch::answer::pty_take,
            ask::watch::adjust::pty_point,
            ask::watch::adjust::pty_pick,
            mcp::mcp_serving,
            mcp::mcp_serve,
            mcp::mcp_stop,
            mcp::mcp_reports,
            mcp::mcp_setups,
            mcp::mcp_install,
        ])
        .build(context)
        .expect("error while building tauri application")
        // Built and then run rather than run outright, for the sake of the one
        // event this app has anything to say about. Nothing else about the
        // loop is any different for it.
        .run(|app, event| on_the_way_out(app, &event));
}
