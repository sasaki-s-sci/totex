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
        ("terminalSort", &["createdWhere", "createdAt"][..]),
        ("canvasAlign", &["terminal", "initial"][..]),
    ] {
        if let Some(v) = object.get(key)
            && !v.as_str().is_some_and(|s| choices.contains(&s))
        {
            return Err(format!("Invalid {key}"));
        }
    }
    for key in ["follow", "mcpServing", "backgroundGrid", "terminalUsage"] {
        if object.get(key).is_some_and(|v| !v.is_boolean()) {
            return Err(format!("Invalid {key}"));
        }
    }
    range(value, "readingSize", 8, 20)?;
    range(value, "undoDepth", 10, 1000)?;
    range(value, "cliWheel", 5, 400)?;
    range(value, "pageText", 50, 200)?;
    range(value, "terminalText", 50, 200)?;
    range(value, "graphWheel", 5, 400)?;
    if let Some(monitor) = object.get("monitor") {
        validate_monitor(monitor)?;
    }
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
    // Ids name theme files that come and go, so only their shape is checked here.
    if let Some(appearance) = object.get("appearance") {
        let fields = appearance
            .as_object()
            .ok_or("appearance must be an object")?;
        for key in ["colors", "style", "effects"] {
            if fields
                .get(key)
                .is_some_and(|v| v.as_str().is_none_or(|s| s.is_empty()))
            {
                return Err(format!("Invalid appearance.{key}"));
            }
        }
    }
    Ok(())
}

fn validate_monitor(value: &Value) -> Result<(), String> {
    let fields = value.as_object().ok_or("monitor must be an object")?;
    for key in ["enabled", "agentsOnly"] {
        if fields.get(key).is_some_and(|v| !v.is_boolean()) {
            return Err(format!("Invalid monitor.{key}"));
        }
    }
    if fields.get("agent").is_some_and(|v| {
        v.as_str()
            .is_none_or(|s| !["claude", "codex", "opencode", "custom"].contains(&s))
    }) {
        return Err("Invalid monitor.agent".into());
    }
    for key in ["command", "model"] {
        if fields.get(key).is_some_and(|v| {
            v.as_str()
                .is_none_or(|s| s.len() > 4096 || s.contains('\0'))
        }) {
            return Err(format!("Invalid monitor.{key}"));
        }
    }
    if fields.get("args").is_some_and(|v| {
        v.as_array().is_none_or(|args| {
            args.len() > 128
                || args.iter().any(|arg| {
                    arg.as_str()
                        .is_none_or(|s| s.len() > 4096 || s.contains('\0'))
                })
        })
    }) {
        return Err("Invalid monitor.args".into());
    }
    range(value, "intervalSecs", 10, 3600)?;
    if fields.get("text").is_some_and(|v| {
        v.as_str()
            .is_none_or(|s| !["agent", "stdio", "none"].contains(&s))
    }) {
        return Err("Invalid monitor.text".into());
    }
    if fields.get("previewWidth").is_some_and(|v| {
        v.as_u64()
            .is_none_or(|n| ![160, 220, 320, 420].contains(&n))
    }) {
        return Err("Invalid monitor.previewWidth".into());
    }
    if let Some(browser) = fields.get("browser") {
        let browser = browser
            .as_object()
            .ok_or("monitor.browser must be an object")?;
        if browser.get("enabled").is_some_and(|v| !v.is_boolean()) {
            return Err("Invalid monitor.browser.enabled".into());
        }
        if browser.get("allowedUrl").is_some_and(|v| {
            v.as_str()
                .is_none_or(|s| s.is_empty() || s.len() > 4096 || s.contains('\0'))
        }) {
            return Err("Invalid monitor.browser.allowedUrl".into());
        }
        if browser.get("profile").is_some_and(|v| {
            !v.as_str()
                .is_some_and(|s| ["separate", "folder"].contains(&s))
        }) {
            return Err("Invalid monitor.browser.profile".into());
        }
    }
    // The badge shows the status as an icon, so only the features can set it.
    let groups = [
        (
            "features",
            &[
                "status",
                "agents",
                "taskSummary",
                "requestSummary",
                "estimate",
                "goal",
            ][..],
        ),
        (
            "preview",
            &[
                "agents",
                "taskSummary",
                "requestSummary",
                "estimate",
                "goal",
            ][..],
        ),
    ];
    for (group, keys) in groups {
        let Some(features) = fields.get(group) else {
            continue;
        };
        let features = features
            .as_object()
            .ok_or(format!("monitor.{group} must be an object"))?;
        for key in keys {
            if features.get(*key).is_some_and(|v| !v.is_boolean()) {
                return Err(format!("Invalid monitor.{group}.{key}"));
            }
        }
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
        let next = patch(
            &temp.0,
            &json!({"said":{"size":1}, "fileTitle":"path", "backgroundGrid":true}),
        )
        .unwrap();
        assert_eq!(next.value["backgroundGrid"], true);
        assert_eq!(next.value["said"], json!({"size":1,"width":220}));
        assert_eq!(next.value["custom"], initial["custom"]);
        assert_eq!(next.value["theme"], "dark");
        assert_eq!(read(&temp.0, &json!({})).unwrap().value, next.value);
    }
    #[test]
    fn monitor_features_merge_and_invalid_commands_do_not_overwrite_settings() {
        let temp = Temp::new();
        read(
            &temp.0,
            &json!({"monitor": {
                "enabled": false, "agent": "custom", "command": "agent-acp", "args": ["--stdio"],
                "features": {"agents": true, "estimate": true}
            }}),
        )
        .unwrap();
        let next = patch(
            &temp.0,
            &json!({"monitor": {
                "features": {"estimate": false}
            }}),
        )
        .unwrap();
        assert_eq!(next.value["monitor"]["features"]["agents"], true);
        assert_eq!(next.value["monitor"]["features"]["estimate"], false);
        assert_eq!(next.value["monitor"]["agent"], "custom");
        for agent in ["claude", "codex", "opencode"] {
            assert!(patch(&temp.0, &json!({"monitor": {"agent": agent}})).is_ok());
        }
        let next = patch(&temp.0, &json!({"monitor": {"agent": "custom"}})).unwrap();
        for invalid in [
            json!({"monitor": []}),
            json!({"monitor": {"enabled": "yes"}}),
            json!({"monitor": {"agentsOnly": "yes"}}),
            json!({"monitor": {"agent": "gemini"}}),
            json!({"monitor": {"agent": 1}}),
            json!({"monitor": {"command": "bad\u{0}command"}}),
            json!({"monitor": {"args": "--stdio"}}),
            json!({"monitor": {"args": [false]}}),
            json!({"monitor": {"intervalSecs": 0}}),
            json!({"monitor": {"features": {"status": "yes"}}}),
            json!({"monitor": {"previewWidth": 200}}),
            json!({"monitor": {"text": "llm"}}),
        ] {
            assert!(patch(&temp.0, &invalid).is_err());
            assert_eq!(std::fs::read_to_string(&temp.0).unwrap(), next.text);
        }
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
            "{\"backgroundGrid\":\"yes\"}",
            "{\"fileTitle\":\"bad\"}",
            "{\"terminalSort\":\"bad\"}",
            "{\"cliWheel\":0}",
            "{\"graphWheel\":401}",
            "{\"undoDepth\":5}",
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
    fn appearance_names_any_theme_but_must_name_one() {
        let temp = Temp::new();
        read(&temp.0, &json!({})).unwrap();
        let next = patch(&temp.0, &json!({"appearance":{"colors":"mine"}})).unwrap();
        assert_eq!(next.value["appearance"], json!({"colors":"mine"}));
        let next = patch(&temp.0, &json!({"appearance":{"effects":"glow"}})).unwrap();
        assert_eq!(
            next.value["appearance"],
            json!({"colors":"mine", "effects":"glow"})
        );
        for invalid in [
            json!({"appearance":"neon"}),
            json!({"appearance":{"colors":""}}),
            json!({"appearance":{"style":1}}),
            json!({"appearance":{"effects":null}}),
        ] {
            assert!(patch(&temp.0, &invalid).is_err());
        }
        assert_eq!(read(&temp.0, &json!({})).unwrap().value, next.value);
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
