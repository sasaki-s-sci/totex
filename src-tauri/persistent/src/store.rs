//! A JSON document under a name, kept for the window.
//!
//! The window is the half of the app that is replaced, so it is not a place
//! anything can be kept — and the disk is, but two windows in the middle of a
//! swap are two writers of one file. So the window hands what it wants
//! remembered to this program, by name, and asks for it back by the same name.
//!
//! Nothing here reads what it keeps. A document is a name and some JSON, and
//! what the JSON means is the window's business: the window changes, its
//! documents change with it, and this program goes on keeping them without
//! having to be told what any of them are. That is the same rule as `meta` on a
//! session, applied to the window as a whole.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;

use serde_json::Value;
use totex_host::sync::lock;

/// The longest a name may be, and the only characters in one: a name is a file
/// name, and this is what stops it being a path.
const NAME_LIMIT: usize = 64;

/// The most a document may weigh. What the window keeps is its own notes, not
/// somebody's data.
const DOCUMENT_LIMIT: usize = 1024 * 1024;

pub struct Store {
    /// Where the documents are written, or nothing on a machine where they are
    /// only remembered for as long as this program runs.
    home: Option<PathBuf>,
    held: Mutex<HashMap<String, Value>>,
}

impl Store {
    /// Somewhere to keep documents, told where.
    pub fn at(home: Option<PathBuf>) -> Self {
        Self {
            home,
            held: Mutex::new(HashMap::new()),
        }
    }

    /// Whether a name is one a document can be kept under.
    pub fn names(name: &str) -> bool {
        !name.is_empty()
            && name.len() <= NAME_LIMIT
            && !name.starts_with('.')
            && name
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
    }

    fn file(&self, name: &str) -> Option<PathBuf> {
        self.home
            .as_ref()
            .map(|home| home.join(format!("{name}.json")))
    }

    /// The document under one name, or nothing where there is none.
    pub fn get(&self, name: &str) -> Result<Option<Value>, String> {
        if !Self::names(name) {
            return Err(format!(
                "{name:?} is not a name a document can be kept under"
            ));
        }
        let mut held = lock(&self.held);
        if let Some(value) = held.get(name) {
            return Ok(Some(value.clone()));
        }
        let Some(file) = self.file(name) else {
            return Ok(None);
        };
        let Ok(bytes) = std::fs::read(&file) else {
            return Ok(None);
        };
        let value: Value = serde_json::from_slice(&bytes)
            .map_err(|error| format!("{} will not read: {error}", file.display()))?;
        held.insert(name.to_string(), value.clone());
        Ok(Some(value))
    }

    /// Keeps a document under a name, replacing whatever was there.
    ///
    /// Written every time rather than on the way out: what closes this program
    /// is as often the machine going down as anything else, and a document that
    /// only survives a graceful ending is not one that survives the thing it is
    /// for.
    pub fn put(&self, name: &str, value: Value) -> Result<(), String> {
        if !Self::names(name) {
            return Err(format!(
                "{name:?} is not a name a document can be kept under"
            ));
        }
        let bytes = serde_json::to_vec(&value).map_err(|error| error.to_string())?;
        if bytes.len() > DOCUMENT_LIMIT {
            return Err(format!("{name} is larger than a document may be"));
        }
        let mut held = lock(&self.held);
        held.insert(name.to_string(), value);
        let Some(file) = self.file(name) else {
            return Ok(());
        };
        if let Some(dir) = file.parent() {
            std::fs::create_dir_all(dir).map_err(|error| format!("{}: {error}", dir.display()))?;
        }
        // Whole or not at all: a document is written beside where it goes and
        // moved into place, so a machine going down halfway leaves the last one.
        let writing = file.with_extension("json.writing");
        std::fs::write(&writing, &bytes)
            .map_err(|error| format!("{}: {error}", writing.display()))?;
        std::fs::rename(&writing, &file).map_err(|error| format!("{}: {error}", file.display()))
    }

    /// Every name a document is kept under.
    pub fn list(&self) -> Vec<String> {
        let mut names: Vec<String> = lock(&self.held).keys().cloned().collect();
        if let Some(home) = &self.home {
            for entry in std::fs::read_dir(home).into_iter().flatten().flatten() {
                let name = entry.file_name();
                let Some(name) = name.to_str().and_then(|name| name.strip_suffix(".json")) else {
                    continue;
                };
                if Self::names(name) && !names.iter().any(|known| known == name) {
                    names.push(name.to_string());
                }
            }
        }
        names.sort();
        names
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "totex-store-{tag}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|elapsed| elapsed.as_nanos())
                .unwrap_or_default()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn a_document_is_there_again_for_the_next_program() {
        let home = temp("again");
        let store = Store::at(Some(home.clone()));
        store
            .put("folders", serde_json::json!(["/a", "/b"]))
            .expect("kept");

        let next = Store::at(Some(home.clone()));
        assert_eq!(
            next.get("folders").expect("read"),
            Some(serde_json::json!(["/a", "/b"]))
        );
        assert_eq!(next.list(), vec!["folders".to_string()]);
        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn a_name_that_is_a_path_is_not_a_name() {
        let store = Store::at(None);
        assert!(store.put("../etc/passwd", Value::Null).is_err());
        assert!(store.put("", Value::Null).is_err());
        assert!(store.put(".hidden", Value::Null).is_err());
        assert!(store.put("open-folders_1.v2", Value::Null).is_ok());
    }

    #[test]
    fn a_machine_with_nowhere_to_write_still_remembers_for_as_long_as_it_runs() {
        let store = Store::at(None);
        assert_eq!(store.get("nothing").expect("asked"), None);
        store.put("theme", serde_json::json!("dark")).expect("kept");
        assert_eq!(
            store.get("theme").expect("asked"),
            Some(serde_json::json!("dark"))
        );
    }
}
