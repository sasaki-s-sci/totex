//! Evidence shared by a canvas's terminals and the window.

use std::collections::HashSet;
use std::path::Path;

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use totex_host::host::Host;
use totex_host::sync::lock;

use super::Door;

#[derive(Clone, Debug, PartialEq, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum Content {
    Empty,
    Iframe {
        url: String,
    },
    Image {
        src: String,
    },
    Video {
        src: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        playback: Option<Playback>,
    },
    Audio {
        src: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        playback: Option<Playback>,
    },
    File {
        path: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        view: Option<FileView>,
        #[serde(skip_serializing_if = "Option::is_none")]
        playback: Option<Playback>,
    },
    Code {
        text: String,
        #[serde(default)]
        language: String,
    },
    Markdown {
        text: String,
    },
}

#[derive(Clone, Debug, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum FileView {
    Text,
    Preview,
}

#[derive(Clone, Debug, Default, PartialEq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Playback {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub start: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub end: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub position: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub playing: Option<bool>,
}

#[derive(Clone, Debug, PartialEq, Deserialize, Serialize)]
pub struct Pane {
    pub id: String,
    #[serde(default)]
    pub title: String,
    #[serde(flatten)]
    pub content: Content,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Canvas {
    pub id: String,
    pub revision: u64,
    pub panes: Vec<Pane>,
}

#[derive(Deserialize)]
pub struct Write {
    pub id: String,
    pub panes: Vec<Pane>,
    pub revision: Option<u64>,
}

#[derive(Deserialize)]
pub struct Open {
    pub id: String,
    pub cwd: String,
}

fn shared_id(session: &crate::session::Running) -> String {
    session
        .meta
        .as_deref()
        .and_then(|meta| serde_json::from_str::<Value>(meta).ok())
        .and_then(|meta| {
            meta.get("canvas")?
                .as_str()
                .filter(|id| !id.is_empty())
                .map(str::to_owned)
        })
        .unwrap_or_else(|| session.id.clone())
}

impl Door {
    pub fn open_canvas(&self, id: &str, cwd: &str) -> Result<Canvas, String> {
        if id.is_empty() || id.len() > 8192 || cwd.is_empty() || cwd.contains('\0') {
            return Err("A canvas needs an ID and a folder".into());
        }
        let mut folders = lock(&self.canvas_folders);
        if folders.get(id).is_some_and(|folder| folder != cwd) {
            return Err("The canvas belongs to another folder".into());
        }
        folders.insert(id.to_owned(), cwd.to_owned());
        drop(folders);
        Ok(self.canvas(id))
    }

    pub fn close_canvas(&self, id: &str) -> Result<(), String> {
        if self
            .sessions
            .running()
            .iter()
            .any(|session| shared_id(session) == id)
        {
            return Err("Close the canvas terminals first".into());
        }
        lock(&self.canvas_folders).remove(id);
        lock(&self.canvases).remove(id);
        Ok(())
    }

    pub fn canvases(&self) -> Vec<Canvas> {
        lock(&self.canvases).values().cloned().collect()
    }

    pub fn canvas(&self, id: &str) -> Canvas {
        let id = self
            .sessions
            .running()
            .iter()
            .find(|session| session.id == id)
            .map(shared_id)
            .unwrap_or_else(|| id.to_owned());
        lock(&self.canvases)
            .get(&id)
            .cloned()
            .unwrap_or_else(|| Canvas {
                id: id.to_string(),
                revision: 0,
                panes: Vec::new(),
            })
    }

    pub fn draw(
        &self,
        id: &str,
        mut panes: Vec<Pane>,
        revision: Option<u64>,
    ) -> Result<Canvas, String> {
        let session = self
            .sessions
            .running()
            .into_iter()
            .find(|session| session.id == id);
        let canvas_id = session
            .as_ref()
            .map(shared_id)
            .unwrap_or_else(|| id.to_owned());
        let cwd = session
            .map(|session| session.cwd)
            .or_else(|| lock(&self.canvas_folders).get(id).cloned())
            .ok_or("The canvas has closed")?;
        validate(&panes)?;
        for pane in &mut panes {
            let path = match &mut pane.content {
                Content::File { path, .. } => Some(path),
                Content::Image { src }
                | Content::Video { src, .. }
                | Content::Audio { src, .. }
                    if !src.starts_with("http://") && !src.starts_with("https://") =>
                {
                    Some(src)
                }
                _ => None,
            };
            if let Some(path) = path {
                *path = file_path(&cwd, path);
            }
        }
        let mut canvases = lock(&self.canvases);
        let current = canvases.get(&canvas_id).map_or(0, |canvas| canvas.revision);
        if revision.is_some_and(|expected| expected != current) {
            return Err("The canvas changed. Read it again before replacing it.".into());
        }
        let canvas = Canvas {
            id: canvas_id.clone(),
            revision: current + 1,
            panes,
        };
        canvases.insert(canvas_id, canvas.clone());
        Ok(canvas)
    }
}

pub(super) fn file_path(cwd: &str, path: &str) -> String {
    if Host::of_str(path).is_remote()
        || path.starts_with('\\')
        || path.as_bytes().get(1) == Some(&b':')
    {
        return path.to_string();
    }
    let host = Host::of_str(cwd);
    if path.starts_with('/') {
        host.canonical(path)
    } else {
        host.join(Path::new(cwd), path)
    }
    .to_string_lossy()
    .into_owned()
}

fn validate(panes: &[Pane]) -> Result<(), String> {
    if panes.len() > 32 || serde_json::to_vec(panes).map_err(|e| e.to_string())?.len() > 200 * 1024
    {
        return Err(
            "Use at most 32 panes and 200 KiB of content; use file paths for larger documents."
                .into(),
        );
    }
    let mut ids = HashSet::new();
    for pane in panes {
        if pane.id.is_empty()
            || pane.id.len() > 128
            || !ids.insert(&pane.id)
            || pane.title.len() > 512
        {
            return Err("Pane IDs must be unique, nonempty and at most 128 bytes; titles at most 512 bytes.".into());
        }
        match &pane.content {
            Content::Iframe { url } => web_url(url)?,
            Content::Image { src } | Content::Video { src, .. } | Content::Audio { src, .. }
                if src.starts_with("http://") || src.starts_with("https://") =>
            {
                web_url(src)?
            }
            Content::Image { src }
            | Content::Video { src, .. }
            | Content::Audio { src, .. }
            | Content::File { path: src, .. }
                if src.is_empty()
                    || src.len() > 8192
                    || src.contains('\0')
                    || (src.contains("://") && !Host::of_str(src).is_remote()) =>
            {
                return Err("Use a file path or an HTTP(S) media URL.".into());
            }
            _ => (),
        }
        if let Content::File {
            playback: Some(playback),
            ..
        }
        | Content::Video {
            playback: Some(playback),
            ..
        }
        | Content::Audio {
            playback: Some(playback),
            ..
        } = &pane.content
        {
            validate_playback(playback)?;
        }
    }
    Ok(())
}

fn validate_playback(playback: &Playback) -> Result<(), String> {
    if [playback.start, playback.end, playback.position]
        .into_iter()
        .flatten()
        .any(|value| !value.is_finite() || value < 0.0)
    {
        return Err("Playback times must be finite, nonnegative seconds.".into());
    }
    if playback
        .end
        .is_some_and(|end| end <= playback.start.unwrap_or(0.0))
    {
        return Err("Playback end must be greater than start (default 0 seconds).".into());
    }
    if playback.position.is_some_and(|position| {
        playback.start.is_some_and(|start| position < start)
            || playback.end.is_some_and(|end| position > end)
    }) {
        return Err("Playback position must be within the supplied start and end.".into());
    }
    Ok(())
}

fn web_url(value: &str) -> Result<(), String> {
    let url = reqwest::Url::parse(value).map_err(|_| "Use an absolute HTTP(S) URL")?;
    if !matches!(url.scheme(), "http" | "https")
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || matches!(url.host_str(), Some("tauri.localhost" | "ipc.localhost"))
    {
        return Err("Use an HTTP(S) page URL without credentials or native app hosts.".into());
    }
    Ok(())
}

pub fn tool() -> Value {
    json!({
        "name": "canvas",
        "title": "Show evidence on this terminal's canvas",
        "description": "Read or replace this terminal's canvas. Omit panes to read. Supply panes to replace the entire layout; [] clears it. Read first, preserve existing panes and IDs, and include revision so a concurrent user edit is not overwritten. Use iframe for a running web app (JavaScript enabled), image for a screenshot, video or audio for media supported by the browser's codecs, file for a document, code for literal code, markdown for an explanation, empty for a drop target. Image/video/audio src accepts an HTTP(S) URL or file path. File view may be text or preview; omit it for the file type's default. File/video/audio playback optionally sets start, end, position (seconds) and playing (boolean); times must be finite and nonnegative, end greater than start (default 0), and position inside supplied bounds. Paths are relative to this terminal's starting directory or absolute, retaining its WSL/SSH host. The layout fills the center with straight separators. Terminals in the same canvas share these panes. Other canvas tabs are unaffected.",
        "inputSchema": {
            "type": "object", "additionalProperties": false,
            "properties": {
                "revision": {"type": "integer", "minimum": 0},
                "panes": {"type": "array", "maxItems": 32, "items": {
                    "type": "object",
                    "properties": {
                        "id": {"type": "string", "minLength": 1, "maxLength": 128},
                        "title": {"type": "string"},
                        "kind": {"enum": ["iframe", "image", "video", "audio", "file", "code", "markdown", "empty"]},
                        "url": {"type": "string", "description": "iframe: HTTP(S) URL"},
                        "src": {"type": "string", "description": "image/video/audio: file path or HTTP(S) URL; media must use browser-supported codecs"},
                        "path": {"type": "string", "description": "file: file path"},
                        "view": {"enum": ["text", "preview"], "description": "file: text source or rendered preview; omit for the file type's default"},
                        "playback": {
                            "type": "object", "additionalProperties": false,
                            "description": "file/video/audio: optional playback controls; all times are seconds",
                            "properties": {
                                "start": {"type": "number", "minimum": 0},
                                "end": {"type": "number", "minimum": 0, "description": "Must be greater than start, which defaults to 0"},
                                "position": {"type": "number", "minimum": 0, "description": "Must be within supplied start/end bounds, including end"},
                                "playing": {"type": "boolean"}
                            }
                        },
                        "text": {"type": "string", "description": "code or markdown: literal content"},
                        "language": {"type": "string"}
                    }, "required": ["id", "kind"]
                }}
            }
        }
    })
}

pub fn call(door: &Door, id: &str, arguments: Value) -> Result<Canvas, String> {
    #[derive(Deserialize)]
    #[serde(deny_unknown_fields)]
    struct Arguments {
        panes: Option<Vec<Pane>>,
        revision: Option<u64>,
    }
    let arguments: Arguments = serde_json::from_value(arguments).map_err(|e| e.to_string())?;
    match arguments.panes {
        Some(panes) => door.draw(id, panes, arguments.revision),
        None => Ok(door.canvas(id)),
    }
}
