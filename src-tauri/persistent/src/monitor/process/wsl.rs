//! Processes inside a WSL distribution, read through the distribution's own
//! shell rather than through the share: Windows has no view of Linux PIDs, and
//! `\\wsl.localhost\<distro>\proc` is thousands of 9p round trips a snapshot.
//!
//! One script runs per distribution per snapshot, down a channel already held
//! open there, and hands back `/proc` as `path:content` records ended by NUL —
//! the form `grep -zH` and `find -printf` write without any help. Only
//! processes carrying a terminal's [`MARK`] are read past their environment,
//! and only the environment variables the adapters use leave the distribution.
//! Anything the script cannot answer leaves those terminals to the terminal
//! detector.

use std::collections::{BTreeMap, HashMap};

use super::super::{Process, Target};
use super::{ENV_KEYS, MARK, listeners, parent};

/// The snapshot, as GNU grep and find, which every standard distribution
/// ships. `$1` is the marker variable; the rest are the `grep -e` patterns
/// naming the environment to keep. PIDs are digits, so the unquoted lists
/// split exactly where they should.
const SCRIPT: &str = r#"
export LC_ALL=C
cd /proc || exit 1
marked=$(grep -lzas -e "^$1=" -- [0-9]*/environ | head -n 512)
shift
[ -n "$marked" ] || exit 0
environ= rest= links=
for file in $marked; do
  pid=${file%/environ}
  environ="$environ $pid/environ"
  rest="$rest $pid/cmdline $pid/stat"
  links="$links $pid/cwd $pid/fd"
done
grep -zaHs "$@" -- $environ
grep -zaHs -e '' -- $rest net/tcp net/tcp6
find $links -maxdepth 1 -printf '%p:%l\0' 2>/dev/null
exit 0
"#;

/// The marked processes in `distro`, grouped into the terminals of `sessions`
/// (id, Linux working directory) that are running there.
pub(super) fn targets(distro: &str, sessions: Vec<(String, String)>) -> Vec<Target> {
    let mut args = vec![MARK.to_string()];
    for key in std::iter::once(&MARK).chain(ENV_KEYS) {
        args.push("-e".into());
        args.push(format!("^{key}="));
    }
    let args: Vec<&str> = args.iter().map(String::as_str).collect();
    let Ok(output) = totex_host::wsl::script(distro, None, SCRIPT, &args) else {
        return Vec::new();
    };
    if !output.ok() {
        return Vec::new();
    }
    let mut targets = parse(&output.stdout, sessions);
    for target in &mut targets {
        target.distro = Some(distro.to_string());
    }
    targets
}

#[derive(Default)]
struct Seen {
    mark: Option<String>,
    env: HashMap<String, String>,
    args: Vec<String>,
    stat: Option<Vec<u8>>,
    cwd: Option<String>,
    sockets: Vec<String>,
    files: Vec<String>,
}

fn parse(output: &[u8], sessions: Vec<(String, String)>) -> Vec<Target> {
    let mut seen = BTreeMap::<u32, Seen>::new();
    let mut sockets = HashMap::new();
    for record in output.split(|byte| *byte == 0) {
        let Some(colon) = record.iter().position(|byte| *byte == b':') else {
            continue;
        };
        let Ok(path) = std::str::from_utf8(&record[..colon]) else {
            continue;
        };
        let content = &record[colon + 1..];
        if let Some(table) = path.strip_prefix("net/") {
            if let Ok(text) = std::str::from_utf8(content) {
                sockets.extend(listeners(text, table == "tcp6"));
            }
            continue;
        }
        let mut parts = path.splitn(3, '/');
        let Some(pid) = parts.next().and_then(|pid| pid.parse::<u32>().ok()) else {
            continue;
        };
        let text = String::from_utf8_lossy(content);
        let entry = seen.entry(pid).or_default();
        match (parts.next(), parts.next()) {
            (Some("environ"), None) => {
                if let Some((key, value)) = text.split_once('=') {
                    if key == MARK {
                        entry.mark = Some(value.to_string());
                    } else if ENV_KEYS.contains(&key) {
                        entry.env.insert(key.to_string(), value.to_string());
                    }
                }
            }
            (Some("cmdline"), None) if !content.is_empty() => entry.args.push(text.into_owned()),
            (Some("stat"), None) => entry.stat = Some(content.to_vec()),
            (Some("cwd"), None) if !content.is_empty() => entry.cwd = Some(text.into_owned()),
            (Some("fd"), Some(_)) => {
                if let Some(inode) = text
                    .strip_prefix("socket:[")
                    .and_then(|link| link.strip_suffix(']'))
                {
                    entry.sockets.push(inode.to_string());
                } else if text.starts_with('/') {
                    entry.files.push(text.into_owned());
                }
            }
            _ => {}
        }
    }
    let mut owned = HashMap::<String, Vec<Process>>::new();
    for (pid, seen) in seen {
        // A process the marker was not read from, or that is gone by the time
        // its stat was, is nobody's.
        let (Some(mark), Some(parent)) = (seen.mark, seen.stat.as_deref().and_then(parent)) else {
            continue;
        };
        let mut listening: Vec<u16> = seen
            .sockets
            .iter()
            .filter_map(|inode| sockets.get(inode).copied())
            .collect();
        listening.sort_unstable();
        listening.dedup();
        let mut open_files = seen.files;
        open_files.sort();
        open_files.dedup();
        owned.entry(mark).or_default().push(Process {
            pid,
            parent,
            args: seen.args,
            cwd: seen.cwd,
            env: seen.env,
            listening,
            open_files,
        });
    }
    sessions
        .into_iter()
        .filter_map(|(id, cwd)| {
            let processes = owned.remove(&id)?;
            Some(Target {
                id,
                cwd,
                distro: None,
                processes,
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn records(parts: &[&str]) -> Vec<u8> {
        parts
            .iter()
            .flat_map(|part| [part.as_bytes(), b"\0"].concat())
            .collect()
    }

    #[test]
    fn records_are_grouped_by_marker_and_keep_only_adapter_inputs() {
        let output = records(&[
            "10/environ:TOTEX_TERMINAL=one",
            "10/environ:HOME=/home/a",
            "11/environ:TOTEX_TERMINAL=one",
            "11/environ:CLAUDE_CONFIG_DIR=/config",
            "12/environ:TOTEX_TERMINAL=stranger",
            "13/environ:TOTEX_TERMINAL=two",
            "10/cmdline:-bash",
            "11/cmdline:/home/a/.local/bin/claude",
            "11/cmdline:",
            "11/cmdline:--resume=a:b",
            "10/stat:10 (bash) S 1 0 0\n",
            "11/stat:11 (claude (x)) S 10 0 0\n",
            "12/stat:12 (sh) S 1 0 0\n",
            "net/tcp:  sl local\n0: 0100007F:1000 00000000:0000 0A 0 0 0 0 0 101\n",
            "11/cwd:/home/a/repo",
            "11/fd:",
            "11/fd/3:socket:[101]",
            "11/fd/4:/home/a/.codex/state.sqlite",
            "11/fd/5:pipe:[7]",
        ]);
        let targets = parse(
            &output,
            vec![
                ("one".into(), "/home/a".into()),
                ("two".into(), "/home/a".into()),
                ("idle".into(), "/home/a".into()),
            ],
        );
        // `two` has no stat and `idle` has no processes: neither is a target.
        assert_eq!(targets.len(), 1);
        let target = &targets[0];
        assert_eq!(target.id, "one");
        assert_eq!(
            target.processes.iter().map(|p| p.pid).collect::<Vec<_>>(),
            [10, 11]
        );
        let claude = &target.processes[1];
        assert_eq!(claude.parent, 10);
        assert_eq!(claude.args, ["/home/a/.local/bin/claude", "--resume=a:b"]);
        assert_eq!(claude.cwd.as_deref(), Some("/home/a/repo"));
        assert_eq!(claude.env["CLAUDE_CONFIG_DIR"], "/config");
        assert!(!claude.env.contains_key(MARK));
        assert_eq!(claude.listening, [4096]);
        assert_eq!(claude.open_files, ["/home/a/.codex/state.sqlite"]);
    }

    /// The script against this machine's own `/proc`: a child given a marker
    /// is found, with its arguments, under its terminal, and nothing else is.
    #[cfg(target_os = "linux")]
    #[test]
    fn script_reads_a_marked_process_from_proc() {
        let mark = format!("test-{}", std::process::id());
        let mut child = std::process::Command::new("sleep")
            .arg("30")
            .env(MARK, &mark)
            .spawn()
            .unwrap();
        let mut args = vec![
            "-c".to_string(),
            SCRIPT.to_string(),
            "totex".into(),
            MARK.into(),
        ];
        for key in std::iter::once(&MARK).chain(ENV_KEYS) {
            args.push("-e".into());
            args.push(format!("^{key}="));
        }
        let output = std::process::Command::new("sh")
            .args(&args)
            .output()
            .unwrap();
        child.kill().unwrap();
        child.wait().unwrap();
        assert!(output.status.success());
        let targets = parse(&output.stdout, vec![(mark.clone(), "/".into())]);
        assert_eq!(targets.len(), 1);
        let process = targets[0]
            .processes
            .iter()
            .find(|process| process.pid == child.id())
            .expect("the marked child");
        assert_eq!(process.args, ["sleep", "30"]);
        assert_eq!(process.parent, std::process::id());
        assert!(process.env.contains_key("PATH"));
        assert!(process.cwd.is_some());
    }
}
