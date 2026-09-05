//! The user-editable application settings document. Callers serialize access.
use crate::host::Host;
use serde::Serialize;
use serde_json::Value;
use std::path::Path;

#[derive(Serialize)]
pub struct Document {
    pub path: String,
    pub text: String,
    pub value: Value,
}

fn parse(text: &str) -> Result<Value, String> {
    let value: Value = serde_json::from_str(text).map_err(|e| e.to_string())?;
    validate(&value)?;
    Ok(value)
}

fn validate(value: &Value) -> Result<(), String> {
    let object = value.as_object().ok_or("Settings must be a JSON object")?;
    for (key, choices) in [
        ("theme", &["system", "light", "dark"][..]),
        ("language", &["system", "en", "ja"][..]),
        ("reveal", &["never", "edge", "centre"][..]),
        ("fileTitle", &["name", "path"][..]),
    ] {
        if let Some(v) = object.get(key)
            && !v.as_str().is_some_and(|s| choices.contains(&s))
        {
            return Err(format!("Invalid {key}"));
        }
    }
    for key in ["follow", "mcpServing"] {
        if object.get(key).is_some_and(|v| !v.is_boolean()) {
            return Err(format!("Invalid {key}"));
        }
    }
    range(value, "readingSize", 8, 20)?;
    if let Some(said) = object.get("said") {
        let fields = said.as_object().ok_or("said must be an object")?;
        for key in ["showing", "fitting"] {
            if fields.get(key).is_some_and(|v| !v.is_boolean()) {
                return Err(format!("Invalid said.{key}"));
            }
        }
        if fields
            .get("face")
            .is_some_and(|v| v != "terminal" && v != "window")
        {
            return Err("Invalid said.face".into());
        }
        range(said, "size", 1, 20)?;
        range(said, "lines", 1, 6)?;
        range(said, "width", 80, 640)?;
    }
    Ok(())
}
fn range(value: &Value, key: &str, least: u64, most: u64) -> Result<(), String> {
    if let Some(v) = value.get(key)
        && !v.as_u64().is_some_and(|n| (least..=most).contains(&n))
    {
        return Err(format!("{key} must be an integer from {least} to {most}"));
    }
    Ok(())
}
fn document(path: &Path, text: String) -> Result<Document, String> {
    let value = parse(&text)?;
    Ok(Document {
        path: path.to_string_lossy().into_owned(),
        text,
        value,
    })
}

pub fn read(path: &Path, initial: &Value) -> Result<Document, String> {
    match std::fs::read_to_string(path) {
        Ok(text) => document(path, text),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            validate(initial)?;
            let text = format!(
                "{}\n",
                serde_json::to_string_pretty(initial).map_err(|e| e.to_string())?
            );
            std::fs::create_dir_all(path.parent().ok_or("Missing settings directory")?)
                .map_err(|e| e.to_string())?;
            Host::Local.write_new(path, text.as_bytes())?;
            document(path, text)
        }
        Err(error) => Err(error.to_string()),
    }
}

fn merge(value: &mut Value, patch: &Value) {
    if let (Some(target), Some(patch)) = (value.as_object_mut(), patch.as_object()) {
        for (key, next) in patch {
            if let Some(current) = target.get_mut(key)
                && current.is_object()
                && next.is_object()
            {
                merge(current, next);
                continue;
            }
            target.insert(key.clone(), next.clone());
        }
    }
}

pub fn patch(path: &Path, patch: &Value) -> Result<Document, String> {
    validate(patch)?;
    let before = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
    let mut value = parse(&before)?;
    merge(&mut value, patch);
    let text = format!(
        "{}\n",
        serde_json::to_string_pretty(&value).map_err(|e| e.to_string())?
    );
    write(path, &text, &before)
}

pub fn write(path: &Path, text: &str, expected: &str) -> Result<Document, String> {
    let next = document(path, text.to_string())?;
    let before = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
    if before != expected {
        return Err("Settings changed on disk; reopen the file before saving".into());
    }
    Host::Local.write(path, text, before.len() as u64)?;
    Ok(next)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::sync::atomic::{AtomicU64, Ordering};
    static NEXT: AtomicU64 = AtomicU64::new(0);
    struct Temp(std::path::PathBuf);
    impl Temp {
        fn new() -> Self {
            let dir = std::env::temp_dir().join(format!(
                "totex-settings-{}-{}",
                std::process::id(),
                NEXT.fetch_add(1, Ordering::Relaxed)
            ));
            Self(dir.join(".totex/totex.json"))
        }
    }
    impl Drop for Temp {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(self.0.parent().unwrap().parent().unwrap());
        }
    }
    #[test]
    fn creates_once_and_preserves_unknown_fields_and_other_preferences() {
        let temp = Temp::new();
        let initial =
            json!({"theme":"dark", "custom": {"keep":true}, "said":{"size":9, "width":220}});
        read(&temp.0, &initial).unwrap();
        assert_eq!(
            read(&temp.0, &json!({"theme":"light"})).unwrap().value,
            initial
        );
        let next = patch(&temp.0, &json!({"said":{"size":1}, "fileTitle":"path"})).unwrap();
        assert_eq!(next.value["said"], json!({"size":1,"width":220}));
        assert_eq!(next.value["custom"], initial["custom"]);
        assert_eq!(next.value["theme"], "dark");
        assert_eq!(read(&temp.0, &json!({})).unwrap().value, next.value);
    }
    #[test]
    fn rejects_invalid_settings_without_overwriting() {
        let temp = Temp::new();
        let before = read(&temp.0, &json!({"theme":"dark"})).unwrap();
        for invalid in [
            "[]",
            "{",
            "{\"said\":{\"size\":0}}",
            "{\"follow\":\"yes\"}",
            "{\"fileTitle\":\"bad\"}",
        ] {
            assert!(write(&temp.0, invalid, &before.text).is_err());
            assert_eq!(std::fs::read_to_string(&temp.0).unwrap(), before.text);
        }
        std::fs::write(&temp.0, "broken").unwrap();
        assert!(read(&temp.0, &json!({})).is_err());
        assert!(patch(&temp.0, &json!({"follow":true})).is_err());
        assert_eq!(std::fs::read_to_string(&temp.0).unwrap(), "broken");
    }
    #[test]
    fn refuses_same_length_external_edit() {
        let temp = Temp::new();
        let before = read(&temp.0, &json!({"said":{"size":9}})).unwrap();
        let changed = before.text.replace('9', "8");
        std::fs::write(&temp.0, &changed).unwrap();
        assert!(write(&temp.0, "{}", &before.text).is_err());
        assert_eq!(std::fs::read_to_string(&temp.0).unwrap(), changed);
    }
}
