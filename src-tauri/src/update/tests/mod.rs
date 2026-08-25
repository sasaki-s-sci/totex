//! Three layers taken against a release page that is not somebody else's.
//!
//! The parts of updating that cannot be checked by arithmetic over versions:
//! reading a manifest off a server, deciding what a machine can do with what it
//! says, and putting the answer on disk. So the server is one this test starts,
//! on a port the operating system picks, holding whatever the test wants a
//! release page to say — which is the only way to write down what happens when
//! it says something a real one never would.

mod kept;
mod layer;
mod serve;

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
