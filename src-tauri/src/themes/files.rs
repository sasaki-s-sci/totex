//! Theme files the user keeps beside the settings: every `*.json` directly in one folder.
//! Reading and judging them is the window's; this only hands over the text.
use serde::Serialize;
use std::path::Path;

/// Larger than any theme would be written by hand; past it, reading is refused, not attempted.
pub const MOST_BYTES: u64 = 256 * 1024;

#[derive(Debug, PartialEq, Serialize)]
pub struct ThemeFile {
    pub path: String,
    pub text: String,
}

/// Sorted by file name. A missing folder is no themes, and is not made by reading.
/// A file that cannot be read (too large, not UTF-8, unreadable) still has an entry, with no
/// text, so the window names it as refused instead of it silently not being there.
pub fn list(dir: &Path) -> Result<Vec<ThemeFile>, String> {
    let entries = match std::fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(error.to_string()),
    };
    let mut paths: Vec<_> = entries
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| {
            path.extension()
                .is_some_and(|ext| ext.eq_ignore_ascii_case("json"))
                && path.is_file()
        })
        .collect();
    paths.sort_by(|a, b| a.file_name().cmp(&b.file_name()));
    Ok(paths
        .into_iter()
        .map(|path| {
            let fits = std::fs::metadata(&path).is_ok_and(|meta| meta.len() <= MOST_BYTES);
            let text = if fits {
                std::fs::read_to_string(&path).unwrap_or_default()
            } else {
                String::new()
            };
            ThemeFile {
                path: path.to_string_lossy().into_owned(),
                text,
            }
        })
        .collect())
}

/// The folder, made if missing, as an absolute path to show or open.
pub fn ensure(dir: &Path) -> Result<String, String> {
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    Ok(dir.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};
    static NEXT: AtomicU64 = AtomicU64::new(0);
    struct Temp(std::path::PathBuf);
    impl Temp {
        fn new() -> Self {
            Self(std::env::temp_dir().join(format!(
                "totex-themes-{}-{}",
                std::process::id(),
                NEXT.fetch_add(1, Ordering::Relaxed)
            )))
        }
    }
    impl Drop for Temp {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }
    fn names(files: &[ThemeFile]) -> Vec<String> {
        files
            .iter()
            .map(|file| {
                Path::new(&file.path)
                    .file_name()
                    .unwrap()
                    .to_string_lossy()
                    .into_owned()
            })
            .collect()
    }

    #[test]
    fn missing_folder_is_empty_and_not_made() {
        let temp = Temp::new();
        assert_eq!(list(&temp.0).unwrap(), Vec::new());
        assert!(!temp.0.exists());
    }
    #[test]
    fn lists_json_files_by_name_only_at_the_top() {
        let temp = Temp::new();
        std::fs::create_dir_all(temp.0.join("nested.json")).unwrap();
        std::fs::create_dir_all(temp.0.join("deeper")).unwrap();
        std::fs::write(temp.0.join("deeper/inner.json"), "{}").unwrap();
        std::fs::write(temp.0.join("b.json"), "{\"b\":1}").unwrap();
        std::fs::write(temp.0.join("a.JSON"), "{\"a\":1}").unwrap();
        std::fs::write(temp.0.join("notes.txt"), "x").unwrap();
        let files = list(&temp.0).unwrap();
        assert_eq!(names(&files), ["a.JSON", "b.json"]);
        assert_eq!(files[1].text, "{\"b\":1}");
    }
    #[test]
    fn unreadable_files_stay_listed_without_text() {
        let temp = Temp::new();
        std::fs::create_dir_all(&temp.0).unwrap();
        std::fs::write(temp.0.join("big.json"), vec![b' '; MOST_BYTES as usize + 1]).unwrap();
        std::fs::write(temp.0.join("binary.json"), [0xff, 0xfe, 0x00]).unwrap();
        std::fs::write(temp.0.join("edge.json"), vec![b' '; MOST_BYTES as usize]).unwrap();
        let files = list(&temp.0).unwrap();
        assert_eq!(names(&files), ["big.json", "binary.json", "edge.json"]);
        assert_eq!(files[0].text, "");
        assert_eq!(files[1].text, "");
        assert_eq!(files[2].text.len(), MOST_BYTES as usize);
    }
    #[test]
    fn ensure_makes_the_folder_once() {
        let temp = Temp::new();
        let dir = temp.0.join("themes");
        assert_eq!(ensure(&dir).unwrap(), dir.to_string_lossy());
        assert!(dir.is_dir());
        ensure(&dir).unwrap();
    }
}
