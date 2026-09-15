//! Linux paths handled as strings, for the machines this program is not on.
//!
//! A remote path has to mean the same thing in both builds: on Linux — where
//! the tests run — `Path` sees a backslash as an ordinary letter, and on Windows
//! it sees `/home/a` as relative. Neither is asked. The far end's paths are
//! walked with the four rules below, which are the same rules however the path
//! was spelled on the outside.

/// Two Linux paths joined. A name that is itself absolute replaces the base,
/// which is what `Path::join` does too.
pub fn join(base: &str, name: &str) -> String {
    if name.starts_with('/') {
        return name.to_string();
    }
    if base.ends_with('/') {
        format!("{base}{name}")
    } else {
        format!("{base}/{name}")
    }
}

/// The directory holding this one, or `None` at the root — which is where a
/// walk upwards has to stop.
pub fn parent(path: &str) -> Option<&str> {
    let cut = path.rfind('/')?;
    if path == "/" {
        return None;
    }
    Some(if cut == 0 { "/" } else { &path[..cut] })
}

/// The last part of the path, or `None` for the root, which has none.
pub fn name(path: &str) -> Option<&str> {
    match path.rsplit('/').next() {
        Some(name) if !name.is_empty() => Some(name),
        _ => None,
    }
}

/// Folds `.` and `..` out of a Linux path, without asking the machine.
///
/// Lexical because the alternative is a round trip per keystroke — and because a
/// path that still says `..` in the middle will not compare equal to the same
/// directory named plainly, which is what the panes key on.
pub fn clean(path: &str) -> String {
    let mut parts: Vec<&str> = Vec::new();
    for part in path.split('/') {
        match part {
            "" | "." => {}
            ".." => {
                parts.pop();
            }
            name => parts.push(name),
        }
    }
    if parts.is_empty() {
        "/".to_string()
    } else {
        format!("/{}", parts.join("/"))
    }
}
