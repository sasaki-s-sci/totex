use std::collections::HashMap;

use base64::Engine;
use serde_json::Value;
use totex_persistent::door::canvas::{Canvas, Content};

use crate::{fs_browse, host::Host};

pub(super) fn files(canvas: &Canvas) -> Vec<&str> {
    canvas
        .panes
        .iter()
        .filter_map(|pane| match &pane.content {
            Content::File { path, .. } => Some(path.as_str()),
            Content::Image { src } | Content::Video { src, .. } | Content::Audio { src, .. }
                if !src.starts_with("http://") && !src.starts_with("https://") =>
            {
                Some(src.as_str())
            }
            _ => None,
        })
        .collect()
}

// Use the very same resolution as the file commands. In particular a Unix
// backslash is a filename character, and remote roots must never be interchanged.
fn same(left: &str, right: &str) -> bool {
    if Host::of_str(left) != Host::of_str(right) {
        return false;
    }
    match (fs_browse::resolve(left), fs_browse::resolve(right)) {
        (Ok(left), Ok(right)) => left == right,
        _ => false,
    }
}

pub(super) fn direct(canvas: &Canvas, path: &str) -> bool {
    files(canvas).iter().any(|file| same(file, path))
}

#[derive(Default)]
pub(super) struct Access {
    files: HashMap<String, Vec<String>>,
    markdown: HashMap<String, (String, Vec<String>)>,
}

impl Access {
    pub(super) fn update(&mut self, canvas: &Canvas, cwd: &str, trusted: bool) {
        for source in files(canvas) {
            let Some(key) = key(source) else {
                continue;
            };
            self.files.entry(key).or_insert_with(|| {
                // A referenced file can alias a document the browser has edited.
                // Only a native/MCP addition may extend its resource grants.
                if !trusted {
                    return vec![];
                }
                let model = [".gltf", ".glb"]
                    .iter()
                    .any(|suffix| source.to_ascii_lowercase().ends_with(suffix));
                references(source)
                    .iter()
                    .filter_map(|uri| {
                        if model {
                            model_reference(source, uri)
                        } else {
                            markdown_reference(source, uri)
                        }
                    })
                    .collect()
            });
        }
        for pane in &canvas.panes {
            if let Content::Markdown { text } = &pane.content {
                if self
                    .markdown
                    .get(&pane.id)
                    .is_some_and(|(before, _)| before == text)
                {
                    continue;
                }
                let paths = if trusted {
                    markdown_references(text)
                        .iter()
                        .filter_map(|uri| markdown_reference(&format!("{cwd}/canvas.md"), uri))
                        .collect()
                } else {
                    vec![]
                };
                self.markdown.insert(pane.id.clone(), (text.clone(), paths));
            }
        }
    }

    pub(super) fn readable(&self, canvas: &Canvas, path: &str) -> bool {
        direct(canvas, path)
            || files(canvas).iter().any(|source| {
                key(source)
                    .and_then(|key| self.files.get(&key))
                    .is_some_and(|refs| refs.iter().any(|file| same(file, path)))
            })
            || canvas.panes.iter().any(|pane| {
                let Content::Markdown { text } = &pane.content else {
                    return false;
                };
                self.markdown.get(&pane.id).is_some_and(|(approved, refs)| {
                    approved == text && refs.iter().any(|file| same(file, path))
                })
            })
    }
}

fn key(path: &str) -> Option<String> {
    fs_browse::resolve(path)
        .ok()
        .map(|(_, path)| path.to_string_lossy().into_owned())
}

fn references(path: &str) -> Vec<String> {
    let lower = path.to_ascii_lowercase();
    if lower.ends_with(".gltf") || lower.ends_with(".glb") {
        let bytes = fs_browse::read_file_data(path)
            .ok()
            .and_then(|file| file.data)
            .and_then(|data| base64::engine::general_purpose::STANDARD.decode(data).ok());
        let Some(bytes) = bytes else {
            return vec![];
        };
        let json = if lower.ends_with(".glb") {
            let Some(header) = bytes.get(..20) else {
                return vec![];
            };
            if &header[..4] != b"glTF" || &header[16..20] != b"JSON" {
                return vec![];
            }
            let length = u32::from_le_bytes(header[12..16].try_into().unwrap()) as usize;
            bytes.get(20..20 + length).unwrap_or_default()
        } else {
            &bytes
        };
        let Ok(json) = serde_json::from_slice::<Value>(json) else {
            return vec![];
        };
        return ["buffers", "images"]
            .into_iter()
            .flat_map(|key| {
                json[key]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter_map(|resource| resource["uri"].as_str().map(str::to_string))
            })
            .collect();
    }
    if ![".md", ".markdown", ".mdx"]
        .iter()
        .any(|extension| lower.ends_with(extension))
    {
        return vec![];
    }
    fs_browse::read_file_head(path)
        .ok()
        .and_then(|file| file.text)
        .map(|text| markdown_references(&text))
        .unwrap_or_default()
}

fn markdown_references(text: &str) -> Vec<String> {
    use pulldown_cmark::{Event, Options, Parser, Tag, TagEnd};
    let options = Options::ENABLE_TABLES
        | Options::ENABLE_STRIKETHROUGH
        | Options::ENABLE_TASKLISTS
        | Options::ENABLE_FOOTNOTES
        | Options::ENABLE_YAML_STYLE_METADATA_BLOCKS;
    let events: Vec<_> = Parser::new_ext(text, options).collect();
    let footnotes: std::collections::HashSet<_> = events
        .iter()
        .filter_map(|event| {
            if let Event::FootnoteReference(name) = event {
                Some(name.as_ref())
            } else {
                None
            }
        })
        .collect();
    let mut omitted = false;
    let visible = events.iter().filter_map(|event| {
        match event {
            Event::Start(Tag::MetadataBlock(_)) => {
                omitted = true;
                return None;
            }
            Event::End(TagEnd::MetadataBlock(_)) => {
                omitted = false;
                return None;
            }
            Event::Start(Tag::FootnoteDefinition(name)) if !footnotes.contains(name.as_ref()) => {
                omitted = true;
                return None;
            }
            Event::End(TagEnd::FootnoteDefinition) if omitted => {
                omitted = false;
                return None;
            }
            _ => (),
        }
        (!omitted).then(|| event.clone())
    });
    let mut html = String::new();
    pulldown_cmark::html::push_html(&mut html, visible);
    // Reuse the window host's HTML parser for actual elements and decoded
    // attributes. Comment/code/raw-text contents cannot become resource grants.
    let document = dom_query::Document::from(html);
    document.select("script,style,iframe,template,textarea,title,noscript,noembed,noframes,xmp,plaintext,foreignObject,annotation-xml").remove();
    document
        .select("a[href],img[src]")
        .nodes()
        .iter()
        .filter_map(|node| {
            node.attr(if node.is("a") { "href" } else { "src" })
                .map(|path| path.to_string())
        })
        .collect()
}

fn decoded(raw: &str) -> Option<String> {
    let mut bytes = Vec::new();
    let mut input = raw.as_bytes().iter().copied();
    while let Some(byte) = input.next() {
        bytes.push(if byte == b'%' {
            let hex = [input.next()?, input.next()?];
            u8::from_str_radix(std::str::from_utf8(&hex).ok()?, 16).ok()?
        } else {
            byte
        });
    }
    String::from_utf8(bytes).ok()
}

// Mirrors modelResourcePath: models may only reference resources inside their
// own directory. Do not use Markdown's more permissive document-link rules here.
fn model_reference(source: &str, uri: &str) -> Option<String> {
    if uri.contains(['?', '#']) {
        return None;
    }
    let path = decoded(uri)?;
    if path.is_empty()
        || path.starts_with(['/', '\\'])
        || path.chars().any(|ch| ch == ':' || ch <= '\u{1f}')
    {
        return None;
    }
    let mut parts = Vec::new();
    for part in path.split(['/', '\\']) {
        match part {
            "" | "." => (),
            ".." => {
                parts.pop()?;
            }
            part => parts.push(part),
        }
    }
    if parts.is_empty() {
        return None;
    }
    let cut = source.rfind(['/', '\\'])?;
    Some(format!(
        "{}{}",
        &source[..cut + 1],
        parts.join(&source[cut..cut + 1])
    ))
}

// These are the display viewer's reference rules (markdownTargets.ts), not a
// normalization rule for arbitrary file grants. Literal canvas paths use `same`.
fn markdown_reference(source: &str, uri: &str) -> Option<String> {
    let uri = uri.trim();
    if uri.is_empty() || uri.starts_with('#') || uri.starts_with("//") {
        return None;
    }
    let bare = if uri
        .get(..5)
        .is_some_and(|prefix| prefix.eq_ignore_ascii_case("file:"))
    {
        let url = reqwest::Url::parse(uri).ok()?;
        let path = decoded(url.path()).unwrap_or_else(|| url.path().into());
        if path.starts_with('/') && drive(&path[1..]) {
            path[1..].to_string()
        } else {
            path
        }
    } else {
        let raw = uri.split(['?', '#']).next()?;
        if raw.contains(':') && !drive(raw) {
            return None;
        }
        decoded(raw).unwrap_or_else(|| raw.into())
    };
    if bare.is_empty() || bare.contains('\0') {
        return None;
    }
    if drive(&bare) || bare.starts_with("\\\\") {
        return Some(settled(&bare));
    }
    let (root, _) = root(source);
    if bare.starts_with(['/', '\\']) {
        return Some(settled(&format!(
            "{root}{}",
            bare.trim_start_matches(['/', '\\'])
        )));
    }
    let cut = source.rfind(['/', '\\']).map(|cut| cut + 1).unwrap_or(0);
    let folder = if cut < root.len() {
        root
    } else {
        source[..cut].into()
    };
    Some(settled(&format!("{folder}{bare}")))
}

fn drive(path: &str) -> bool {
    let bytes = path.as_bytes();
    bytes.len() >= 3
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && [b'/', b'\\'].contains(&bytes[2])
}

fn root(path: &str) -> (String, char) {
    if let Some(rest) = path.strip_prefix("ssh://")
        && let Some(end) = rest.find('/')
        && !rest[..end].contains('\\')
    {
        return (path[..6 + end + 1].into(), '/');
    }
    if drive(path) {
        return (format!("{}\\", &path[..2]), '\\');
    }
    if let Some(rest) = path.strip_prefix("\\\\") {
        let mut parts = rest.split(['/', '\\']);
        if let (Some(server), Some(share)) = (parts.next(), parts.next())
            && !server.is_empty()
            && !share.is_empty()
        {
            return (format!("\\\\{server}\\{share}\\"), '\\');
        }
    }
    (
        if path.starts_with('/') {
            "/".into()
        } else {
            String::new()
        },
        '/',
    )
}

fn settled(path: &str) -> String {
    let (root, separator) = root(path);
    let mut parts = Vec::new();
    for part in path[root.len().min(path.len())..].split(['/', '\\']) {
        match part {
            "" | "." => (),
            ".." => {
                parts.pop();
            }
            part => parts.push(part),
        }
    }
    format!("{root}{}", parts.join(&separator.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use totex_persistent::door::canvas::Pane;

    #[test]
    fn only_canvas_files_and_actual_document_references_are_readable() {
        let dir = std::env::temp_dir().join(format!("totex-browser-scope-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let document = dir.join("note.md").to_string_lossy().into_owned();
        std::fs::write(
            &document,
            "![image](image.png)\n[child](sub/child.md)\n[x]: linked.txt\n",
        )
        .unwrap();
        let canvas = Canvas {
            id: "a".into(),
            revision: 1,
            panes: vec![Pane {
                id: "note".into(),
                title: String::new(),
                content: Content::File {
                    path: document.clone(),
                    view: None,
                    playback: None,
                },
            }],
        };
        let mut access = Access::default();
        access.update(&canvas, "", true);
        assert!(direct(&canvas, &document));
        assert!(access.readable(&canvas, &dir.join("image.png").to_string_lossy()));
        assert!(access.readable(&canvas, &dir.join("sub/child.md").to_string_lossy()));
        assert!(!direct(&canvas, &dir.join("image.png").to_string_lossy()));
        assert!(!access.readable(&canvas, &dir.join("unrelated.txt").to_string_lossy()));
        assert!(!access.readable(&canvas, "/etc/passwd"));
        assert!(!access.readable(&canvas, &dir.join("../.secret").to_string_lossy()));
        // Editing a granted document cannot mint a new grant, even after a reload
        // or removing/readding it under an equivalent spelling.
        std::fs::write(&document, "[secret](/etc/passwd)").unwrap();
        access.update(&canvas, "", true);
        assert!(!access.readable(&canvas, "/etc/passwd"));
        let empty = Canvas {
            panes: vec![],
            ..canvas.clone()
        };
        assert!(!access.readable(&empty, &dir.join("image.png").to_string_lossy()));
        let mut alias = canvas.clone();
        if let Content::File { path, .. } = &mut alias.panes[0].content {
            *path = dir.join("./note.md").to_string_lossy().into_owned();
        }
        access.update(&alias, "", false);
        assert!(!access.readable(&alias, "/etc/passwd"));
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn remote_resources_keep_the_documents_host_and_reject_url_schemes() {
        assert_eq!(
            model_reference("ssh://box/work/model.gltf", "textures/a%20b.png"),
            Some("ssh://box/work/textures/a b.png".into())
        );
        assert_eq!(
            model_reference("/work/note.md", "https://example.com/x"),
            None
        );
        assert_eq!(model_reference("/work/note.md", "file:///etc/passwd"), None);
        assert_eq!(model_reference("/work/note.md", "%00secret"), None);
        for path in [
            "../secret",
            "%2e%2e/secret",
            "a/../../secret",
            "/secret",
            "a?b",
            "%zz",
        ] {
            assert_eq!(model_reference("/work/model.gltf", path), None);
        }
        assert_eq!(
            model_reference("/work/model.gltf", "a/../mesh.bin"),
            Some("/work/mesh.bin".into())
        );
        assert_eq!(
            markdown_reference("ssh://box/work/note.md", "/images/x%20y.png"),
            Some("ssh://box/images/x y.png".into())
        );
        assert_eq!(
            markdown_reference(r"\\wsl.localhost\Ubuntu\work\note.md", "/images/x.png"),
            Some(r"\\wsl.localhost\Ubuntu\images\x.png".into())
        );
        assert_eq!(
            markdown_reference("/work/note.md", "raw%filename.png"),
            Some("/work/raw%filename.png".into())
        );
        assert_eq!(
            markdown_reference("ssh://box/work/note.md", "ssh://other/secret"),
            None
        );
        assert!(!same("ssh://box/work/note.md", "ssh://other/work/note.md"));
        assert!(!same(
            r"\\wsl.localhost\Ubuntu\work\note.md",
            r"\\wsl.localhost\Other\work\note.md"
        ));
        #[cfg(unix)]
        assert!(!same("/work/a/b", r"/work/a\b"));
        assert!(same("/work/other/../note.md", "/work/note.md"));
    }

    #[test]
    fn browser_markdown_edits_cannot_expand_the_capability() {
        let mut canvas = Canvas {
            id: "one".into(),
            revision: 1,
            panes: vec![Pane {
                id: "inline".into(),
                title: String::new(),
                content: Content::Markdown {
                    text: "![image](image.png)".into(),
                },
            }],
        };
        let mut access = Access::default();
        access.update(&canvas, "/work", true);
        assert!(access.readable(&canvas, "/work/image.png"));
        canvas.panes[0].content = Content::Markdown {
            text: "[secret](/etc/passwd)".into(),
        };
        access.update(&canvas, "/work", false);
        access.update(&canvas, "/work", true);
        assert!(!access.readable(&canvas, "/etc/passwd"));
        // A distinct native/MCP content update is a new trusted source.
        canvas.panes[0].content = Content::Markdown {
            text: "[reference](reference.txt)".into(),
        };
        access.update(&canvas, "/work", true);
        assert!(access.readable(&canvas, "/work/reference.txt"));
        assert!(!access.readable(&canvas, "/etc/passwd"));
    }

    #[test]
    fn only_rendered_markdown_links_and_images_grant_resources() {
        let references = markdown_references(
            r#"---
title: "[metadata](metadata.txt)"
---
[visible][used]
![image](images/a%20b.png)
`[inline code](inline.txt)`

```markdown
[fenced code](fenced.txt)
<img src="fenced-html.png">
```

    [indented code](indented.txt)

<!-- <a href="comment.txt">hidden</a> -->
<script>const example = '<img src="script.png">';</script>
<style>p::before { content: '<a href="style.txt">'; }</style>
<textarea><img src="textarea.png"></textarea>
<template><a href="template.txt">hidden</a></template>
<span data-example='href="attribute.txt"'>ordinary text</span>
<IMG SRC="html&amp;image.png"><a HREF='html-link.txt'>HTML link</a>

[used]: used.txt
[unused]: unused.txt
[^unused-footnote]: [hidden](footnote.txt)
"#,
        );
        assert_eq!(
            references,
            vec![
                "used.txt",
                "images/a%20b.png",
                "html&image.png",
                "html-link.txt"
            ]
        );
    }

    #[cfg(unix)]
    #[test]
    fn adding_a_symlink_alias_cannot_regrant_a_browser_edited_document() {
        let dir = std::env::temp_dir().join(format!("totex-browser-alias-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("note.md").to_string_lossy().into_owned();
        let alias = dir.join("alias.md").to_string_lossy().into_owned();
        let secret = dir.join("private.txt").to_string_lossy().into_owned();
        std::fs::write(&path, "[related](alias.md)").unwrap();
        std::fs::write(&secret, "private").unwrap();
        std::os::unix::fs::symlink(&path, &alias).unwrap();
        let mut canvas = Canvas {
            id: "one".into(),
            revision: 1,
            panes: vec![Pane {
                id: "note".into(),
                title: String::new(),
                content: Content::File {
                    path: path.clone(),
                    view: None,
                    playback: None,
                },
            }],
        };
        let mut access = Access::default();
        access.update(&canvas, &dir.to_string_lossy(), true);
        assert!(access.readable(&canvas, &alias));
        std::fs::write(&path, "[secret](private.txt)").unwrap();
        canvas.panes.push(Pane {
            id: "alias".into(),
            title: String::new(),
            content: Content::File {
                path: alias,
                view: None,
                playback: None,
            },
        });
        access.update(&canvas, &dir.to_string_lossy(), false);
        access.update(&canvas, &dir.to_string_lossy(), true);
        assert!(!access.readable(&canvas, &secret));
        std::fs::remove_dir_all(dir).unwrap();
    }
}
