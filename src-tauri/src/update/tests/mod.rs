//! Three layers taken against a release page that is not somebody else's.
//!
//! The parts of updating that cannot be checked by arithmetic over versions:
//! reading a manifest off a server, deciding what a machine can do with what it
//! says, and putting the answer on disk. So the server is one this test starts,
//! on a port the operating system picks, holding whatever the test wants a
//! release page to say — which is the only way to write down what happens when
//! it says something a real one never would.

mod kept;
pub(super) mod layer;
pub(super) mod rows;
mod serve;
mod sessions;
mod whole;

use std::path::{Path, PathBuf};
use std::sync::Arc;

use tauri::App;
use tauri::test::{MockRuntime, mock_builder, mock_context, noop_assets};

use crate::app_layer::Layers;
use crate::update::Kept;

pub(super) use serve::Page;

/// A temporary directory that removes itself, so a failing test cannot leave a
/// layer behind.
pub(super) struct TempDir(PathBuf);

impl TempDir {
    pub(super) fn new(tag: &str) -> Self {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|elapsed| elapsed.as_nanos())
            .unwrap_or_default();
        let path = std::env::temp_dir().join(format!(
            "totex-update-{tag}-{}-{unique}",
            std::process::id()
        ));
        std::fs::create_dir_all(&path).expect("create temp dir");
        Self(path)
    }

    pub(super) fn path(&self) -> &Path {
        &self.0
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

/// The public half of the key the tests sign nothing with.
///
/// A real key, and deliberately not the app's: what it is here for is that a
/// download which was not signed with it is turned down, which is the one thing
/// about a release page that has to be true whatever the page says.
pub(super) const KEY: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDg2RkI4MTZBQjRGMkNBNUIKUldSYnl2SzBhb0g3aGwzS1ZPY04wenRUdmdnSW5EdnlEMVpMYy8zRnNCb1hwRENvUzVGRllKeUkK";

/// An app with a release page and somewhere to keep what it takes.
///
/// Built the way the real one is built, as far as the two things anything here
/// reads: the address the updater is configured with, which every layer's
/// releases are found through, and the key everything downloaded is checked
/// against.
pub(super) fn app(endpoint: &str, home: &Path) -> App<MockRuntime> {
    let mut context = mock_context(noop_assets());
    context.config_mut().plugins.0.insert(
        "updater".to_string(),
        serde_json::json!({ "endpoints": [endpoint], "pubkey": KEY }),
    );
    mock_builder()
        .manage(Arc::new(Layers::at(Some(home.join("layer")))))
        .manage(Arc::new(Kept::at(Some(home.join("update.json")))))
        .build(context)
        .expect("an app with a release page")
}

/// One question, asked the way the window asks it.
///
/// The whole of the boundary: a name, a bag of arguments with the spellings the
/// window actually sends, and the same list of commands the app is built with.
/// Nothing on either side of that boundary is checked by a compiler — a command
/// left out of the list, or an argument the window spells differently, is a
/// window that draws a row nothing answers.
pub(super) fn asked(
    webview: &tauri::WebviewWindow<MockRuntime>,
    command: &str,
    body: serde_json::Value,
) -> Result<serde_json::Value, serde_json::Value> {
    let answered = tauri::test::get_ipc_response(
        webview,
        tauri::webview::InvokeRequest {
            cmd: command.to_string(),
            callback: tauri::ipc::CallbackFn(0),
            error: tauri::ipc::CallbackFn(1),
            url: "tauri://localhost".parse().expect("a url"),
            body: tauri::ipc::InvokeBody::Json(body),
            headers: Default::default(),
            invoke_key: tauri::test::INVOKE_KEY.to_string(),
        },
    );
    answered.map(|body| match body {
        tauri::ipc::InvokeResponseBody::Json(text) => {
            serde_json::from_str(&text).unwrap_or(serde_json::Value::Null)
        }
        tauri::ipc::InvokeResponseBody::Raw(bytes) => serde_json::json!(bytes),
    })
}

/// A window on an app carrying the real list of commands.
pub(super) fn window(home: &Path) -> (App<MockRuntime>, tauri::WebviewWindow<MockRuntime>) {
    let mut context = mock_context(noop_assets());
    context.config_mut().plugins.0.insert(
        "updater".to_string(),
        serde_json::json!({ "endpoints": ["http://127.0.0.1:1/x/releases/latest/download/latest.json"], "pubkey": KEY }),
    );
    // What a capability file grants a real build, granted here by hand: the
    // window this test opens is not one anything wrote a capability for.
    for command in crate::update::tests::rows::SENT {
        context.runtime_authority_mut().__allow_command(
            command.to_string(),
            tauri::utils::acl::ExecutionContext::Local,
        );
    }
    let app = mock_builder()
        .manage(Arc::new(Layers::at(Some(home.join("layer")))))
        .manage(Arc::new(Kept::at(Some(home.join("update.json")))))
        .manage(Arc::new(crate::front::Serving::prepare(
            "com.totex.test",
            "0.1.0".parse().expect("a version"),
        )))
        // The update commands, which are the ones a row sends. The app is
        // built with a longer list and this is the shorter one it has to be a
        // part of -- which is what `every_command_a_row_sends_is_one_the_app_
        // answers` is for.
        .invoke_handler(tauri::generate_handler![
            crate::update::update_standing,
            crate::update::update_take,
            crate::update::update_pick,
            crate::update::update_follow,
            crate::release::fetch::update_versions,
            crate::front::take::confirm_front,
        ])
        .build(context)
        .expect("an app with the real commands in it");
    let window = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .expect("a window to ask through");
    (app, window)
}
