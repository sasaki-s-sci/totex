mod app_layer;
mod ask;
mod derived;
mod display;
mod front;
mod fs_watch;
mod git;
mod mcp;
mod pty;
mod release;
mod stream;
mod update;

/// The application layer, as this program carries it.
///
/// Written as a re-export rather than as modules of this crate because it is a
/// crate of its own -- one that can be built as a program and downloaded, which
/// is what makes it replaceable without this one being replaced. Everything
/// here goes on being `crate::host`, `crate::wsl` and the rest to the program
/// around it, because which crate a question is answered in is not something
/// the asking should have to know. See `app_layer` for the other copy of it.
pub use totex_layer::{fs_browse, host, sync, wsl};

use std::sync::Arc;

use serde_json::json;
use tauri::State;

use app_layer::Layers;
use fs_browse::{FileHead, Listing, Place, Root};

/// Every place an explorer pane can be started at: the home directory, the
/// Windows drives and the WSL distributions this platform can reach.
///
/// The first of eleven that read the same way, and the reason they all do:
/// every one of these is a question about the machine rather than about the
/// app, so none of them is answered here. They are handed to whichever copy of
/// the application layer is in front — see `app_layer` — which is what makes
/// them replaceable while the window and everything running under it stays up.
///
/// Off the UI thread, all of them: some ask a disk that is somebody else's, and
/// one of them may ask a program running beside this one.
#[tauri::command(async)]
fn list_roots(layer: State<'_, Arc<Layers>>) -> Result<Vec<Root>, String> {
    layer.ask("list_roots", json!({}))
}

/// Settles one typed path into a folder to keep beside the roots, or refuses it.
#[tauri::command(async)]
fn resolve_folder(layer: State<'_, Arc<Layers>>, path: String) -> Result<Place, String> {
    layer.ask("resolve_folder", json!({ "path": path }))
}

/// Spells out the folders that were kept, which are stored as paths alone.
/// Nothing here reads a disk — see `fs_browse::describe_folders`.
#[tauri::command(async)]
fn describe_folders(
    layer: State<'_, Arc<Layers>>,
    paths: Vec<String>,
) -> Result<Vec<Place>, String> {
    layer.ask("describe_folders", json!({ "paths": paths }))
}

/// Reads one directory. `\\wsl.localhost\...` and `/mnt/c/...` are
/// network-backed and can take a moment to answer.
#[tauri::command(async)]
fn read_directory(
    layer: State<'_, Arc<Layers>>,
    path: String,
    show_hidden: bool,
) -> Result<Listing, String> {
    layer.ask(
        "read_directory",
        json!({ "path": path, "show_hidden": show_hidden }),
    )
}

/// Reads only enough of a file to draw its preview card on the canvas.
#[tauri::command(async)]
fn read_file_head(layer: State<'_, Arc<Layers>>, path: String) -> Result<FileHead, String> {
    layer.ask("read_file_head", json!({ "path": path }))
}

/// Writes an edited card back to its file, and answers with how long it now is.
#[tauri::command(async)]
fn write_file(
    layer: State<'_, Arc<Layers>>,
    path: String,
    text: String,
    expect_size: u64,
) -> Result<u64, String> {
    layer.ask(
        "write_file",
        json!({ "path": path, "text": text, "expect_size": expect_size }),
    )
}

#[tauri::command(async)]
fn fs_read_file(layer: State<'_, Arc<Layers>>, path: String) -> Result<Vec<u8>, String> {
    layer.ask("fs_read_file", json!({ "path": path }))
}

#[tauri::command(async)]
fn fs_create_entry(
    layer: State<'_, Arc<Layers>>,
    parent: String,
    name: String,
    directory: bool,
) -> Result<String, String> {
    layer.ask(
        "fs_create_entry",
        json!({ "parent": parent, "name": name, "directory": directory }),
    )
}

#[tauri::command(async)]
fn fs_duplicate_file(layer: State<'_, Arc<Layers>>, path: String) -> Result<String, String> {
    layer.ask("fs_duplicate_file", json!({ "path": path }))
}

#[tauri::command(async)]
fn fs_rename_file(
    layer: State<'_, Arc<Layers>>,
    path: String,
    name: String,
) -> Result<String, String> {
    layer.ask("fs_rename_file", json!({ "path": path, "name": name }))
}

#[tauri::command(async)]
fn fs_delete_file(layer: State<'_, Arc<Layers>>, path: String) -> Result<(), String> {
    layer.ask("fs_delete_file", json!({ "path": path }))
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

    // And which copy of the application layer this run asks its questions of,
    // settled the same way and for the same reason -- see `app_layer`.
    let layers = Arc::new(app_layer::Layers::prepare(&context.config().identifier));

    // And what the person left the update rows pointed at, which is this
    // program's to remember because it is the only layer still there after
    // either of the other two has been replaced -- see `update::kept`.
    let kept = Arc::new(update::Kept::prepare(&context.config().identifier));

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
        .manage(layers)
        .manage(kept)
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
        // Every command the window may ask for. The names here and the names
        // the window sends are two lists nothing checks against each other,
        // which is what `update::tests::rows` is for on the ones that matter.
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
            update::update_take,
            update::update_pick,
            update::update_follow,
            release::fetch::update_versions,
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
