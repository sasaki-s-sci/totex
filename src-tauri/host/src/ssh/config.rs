//! The machines the user's own `~/.ssh/config` names, for the rail.
//!
//! Read rather than asked: `ssh` has no way to list what it knows, and the
//! file is the one place a person has already written down every machine they
//! reach and how. Only the names are wanted — an alias is what `ssh` takes on
//! its command line, and what the app puts on the front of a path.

use crate::fs_browse::home_dir;

/// Every alias the config names, in the order it names them. Nothing is
/// contacted: this draws a rail, and a rail must not open a connection per row.
/// No file, or one that cannot be read, is no machines rather than an error.
pub fn hosts() -> Vec<String> {
    let Some(home) = home_dir() else {
        return Vec::new();
    };
    match std::fs::read_to_string(home.join(".ssh").join("config")) {
        Ok(text) => parse_config(&text),
        Err(_) => Vec::new(),
    }
}

/// The names on every `Host` line of a config, without the ones that are
/// patterns rather than machines.
///
/// A `Host` line may name several machines, the keyword is case-insensitive,
/// `=` is as good as a space after it and a name with a space in it is
/// written in double quotes, all as `ssh_config(5)` reads it. A name with `*`
/// or `?` in it is a pattern for other names and `!` negates one; neither is a
/// place a terminal can be opened at. `Include` is not followed and `Match`
/// blocks are not read: those decide how to reach a machine, not which
/// machines there are.
pub fn parse_config(text: &str) -> Vec<String> {
    let mut hosts: Vec<String> = Vec::new();
    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let Some((keyword, rest)) = split_keyword(line) else {
            continue;
        };
        if !keyword.eq_ignore_ascii_case("host") {
            continue;
        }
        for name in names(rest) {
            if name.is_empty()
                || name.starts_with('!')
                || name.contains('*')
                || name.contains('?')
                || hosts.contains(&name)
            {
                continue;
            }
            hosts.push(name);
        }
    }
    hosts
}

/// The words of a `Host` line: split on blanks, except inside double quotes.
fn names(rest: &str) -> Vec<String> {
    let mut names = Vec::new();
    let mut word = String::new();
    let mut quoted = false;
    for c in rest.chars() {
        match c {
            '"' => quoted = !quoted,
            c if c.is_whitespace() && !quoted => {
                if !word.is_empty() {
                    names.push(std::mem::take(&mut word));
                }
            }
            c => word.push(c),
        }
    }
    if !word.is_empty() {
        names.push(word);
    }
    names
}

/// The keyword and what follows it: `Host box` and `Host=box` both.
fn split_keyword(line: &str) -> Option<(&str, &str)> {
    let cut = line.find(|c: char| c.is_whitespace() || c == '=')?;
    let (keyword, rest) = line.split_at(cut);
    let rest = rest.trim_start().trim_start_matches('=').trim_start();
    Some((keyword, rest))
}
