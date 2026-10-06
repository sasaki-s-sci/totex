//! Local process ownership and endpoint discovery. Never inspect other users'
//! session contents; enrich only descendants of totex's own local PTYs.

use super::Target;
use crate::session::Sessions;

pub(super) fn targets(sessions: &Sessions) -> Vec<Target> {
    #[cfg(target_os = "linux")]
    {
        use totex_host::host::Host;
        let roots = sessions
            .running()
            .into_iter()
            .filter_map(|session| {
                if !matches!(Host::of_str(&session.cwd), Host::Local) {
                    return None;
                }
                Some((session.id, session.cwd, session.pid?))
            })
            .collect();
        linux::targets_at(std::path::Path::new("/proc"), roots)
    }
    #[cfg(not(target_os = "linux"))]
    {
        // No reliable ownership/environment/socket provider is installed on
        // these platforms yet. Keep the terminal detector as the fallback.
        let _ = sessions;
        Vec::new()
    }
}

#[cfg(target_os = "linux")]
mod linux {
    use std::collections::{HashMap, HashSet};
    use std::fs;
    use std::io::Read;
    use std::path::Path;

    use super::super::{Process, Target};

    const ENV_KEYS: &[&str] = &[
        "PATH",
        "HOME",
        "USERPROFILE",
        "CODEX_HOME",
        "CODEX_THREAD_ID",
        "CLAUDE_CONFIG_DIR",
        "XDG_CONFIG_HOME",
        "OPENCODE_SERVER_PASSWORD",
        "OPENCODE_SERVER_USERNAME",
    ];

    fn read(path: &Path, limit: u64) -> Option<Vec<u8>> {
        let mut bytes = Vec::new();
        fs::File::open(path)
            .ok()?
            .take(limit)
            .read_to_end(&mut bytes)
            .ok()?;
        Some(bytes)
    }

    fn parent(stat: &[u8]) -> Option<u32> {
        // `comm` can itself contain spaces and parentheses. ppid follows the
        // final closing parenthesis and the process-state field.
        let stat = std::str::from_utf8(stat).ok()?;
        stat.rsplit_once(')')?
            .1
            .split_whitespace()
            .nth(1)?
            .parse()
            .ok()
    }

    fn started(stat: &[u8]) -> Option<u64> {
        let stat = std::str::from_utf8(stat).ok()?;
        stat.rsplit_once(')')?
            .1
            .split_whitespace()
            .nth(19)?
            .parse()
            .ok()
    }

    fn descendants(root: u32, children: &HashMap<u32, Vec<u32>>) -> Vec<u32> {
        let mut pending = vec![root];
        let mut seen = HashSet::new();
        while let Some(pid) = pending.pop() {
            if seen.insert(pid) {
                pending.extend(children.get(&pid).into_iter().flatten().copied());
            }
        }
        let mut found: Vec<_> = seen.into_iter().collect();
        found.sort_unstable();
        found
    }

    fn environment(bytes: &[u8]) -> HashMap<String, String> {
        bytes
            .split(|byte| *byte == 0)
            .filter_map(|entry| {
                let entry = std::str::from_utf8(entry).ok()?;
                let (name, value) = entry.split_once('=')?;
                ENV_KEYS
                    .contains(&name)
                    .then(|| (name.to_string(), value.to_string()))
            })
            .collect()
    }

    fn listeners(text: &str, ipv6: bool) -> HashMap<String, u16> {
        text.lines()
            .filter_map(|line| {
                let fields: Vec<_> = line.split_whitespace().collect();
                if fields.get(3)? != &"0A" {
                    return None;
                }
                let (address, port) = fields.get(1)?.split_once(':')?;
                let local = if ipv6 {
                    matches!(
                        address,
                        "00000000000000000000000000000000" | "00000000000000000000000001000000"
                    )
                } else {
                    address == "00000000" || (address.len() == 8 && address.ends_with("7F"))
                };
                if !local {
                    return None;
                }
                let port = u16::from_str_radix(port, 16).ok()?;
                if port == 0 {
                    return None;
                }
                Some((fields.get(9)?.to_string(), port))
            })
            .collect()
    }

    pub(super) fn targets_at(proc: &Path, roots: Vec<(String, String, u32)>) -> Vec<Target> {
        if roots.is_empty() {
            return Vec::new();
        }
        let Ok(entries) = fs::read_dir(proc) else {
            return Vec::new();
        };
        let mut parents = HashMap::new();
        let mut starts = HashMap::new();
        let mut children = HashMap::<u32, Vec<u32>>::new();
        for entry in entries.flatten() {
            let Some(pid) = entry
                .file_name()
                .to_str()
                .and_then(|name| name.parse::<u32>().ok())
            else {
                continue;
            };
            let Some(stat) = read(&entry.path().join("stat"), 8192) else {
                continue;
            };
            let Some(ppid) = parent(&stat) else {
                continue;
            };
            let Some(start) = started(&stat) else {
                continue;
            };
            parents.insert(pid, ppid);
            starts.insert(pid, start);
            children.entry(ppid).or_default().push(pid);
        }
        let mut sockets = HashMap::new();
        for (table, ipv6) in [("net/tcp", false), ("net/tcp6", true)] {
            if let Some(bytes) = read(&proc.join(table), 4 * 1024 * 1024)
                && let Ok(text) = std::str::from_utf8(&bytes)
            {
                sockets.extend(listeners(text, ipv6));
            }
        }
        roots
            .into_iter()
            .filter_map(|(id, cwd, root)| {
                if !parents.contains_key(&root) {
                    return None;
                }
                let processes = descendants(root, &children)
                    .into_iter()
                    .filter_map(|pid| {
                        let base = proc.join(pid.to_string());
                        let args = read(&base.join("cmdline"), 256 * 1024)?
                            .split(|byte| *byte == 0)
                            .filter(|arg| !arg.is_empty())
                            .map(|arg| String::from_utf8_lossy(arg).into_owned())
                            .collect();
                        let env = read(&base.join("environ"), 1024 * 1024)
                            .map(|bytes| environment(&bytes))
                            .unwrap_or_default();
                        let cwd = fs::read_link(base.join("cwd"))
                            .ok()
                            .map(|path| path.to_string_lossy().into_owned());
                        let mut listening = Vec::new();
                        let mut open_files = Vec::new();
                        if let Ok(fds) = fs::read_dir(base.join("fd")) {
                            for fd in fds.take(4096).flatten() {
                                let Ok(link) = fs::read_link(fd.path()) else {
                                    continue;
                                };
                                let link = link.to_string_lossy();
                                if let Some(inode) = link
                                    .strip_prefix("socket:[")
                                    .and_then(|link| link.strip_suffix(']'))
                                {
                                    if let Some(port) = sockets.get(inode) {
                                        listening.push(*port);
                                    }
                                } else if link.starts_with('/') {
                                    open_files.push(link.into_owned());
                                }
                            }
                        }
                        listening.sort_unstable();
                        listening.dedup();
                        open_files.sort();
                        open_files.dedup();
                        // Recheck ancestry after reading; an exited/reused PID must not
                        // lend its endpoint or environment to the previous process.
                        let expected = *parents.get(&pid)?;
                        let stat = read(&base.join("stat"), 8192)?;
                        if parent(&stat)? != expected || started(&stat)? != *starts.get(&pid)? {
                            return None;
                        }
                        Some(Process {
                            pid,
                            parent: expected,
                            args,
                            cwd,
                            env,
                            listening,
                            open_files,
                        })
                    })
                    .collect();
                Some(Target { id, cwd, processes })
            })
            .collect()
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn proc_snapshot_enriches_only_the_owned_tree_and_owned_socket() {
            use std::os::unix::fs::symlink;
            let unique = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let proc = std::env::temp_dir().join(format!(
                "totex-monitor-proc-{}-{unique}",
                std::process::id()
            ));
            fs::create_dir_all(proc.join("net")).unwrap();
            fs::write(
                proc.join("net/tcp"),
                "0: 0100007F:1000 00000000:0000 0A 0 0 0 0 0 101",
            )
            .unwrap();
            for (pid, ppid) in [(10, 1), (11, 10), (99, 1)] {
                let base = proc.join(pid.to_string());
                fs::create_dir_all(base.join("fd")).unwrap();
                let mut fields = vec!["S".to_string(), ppid.to_string()];
                fields.extend(std::iter::repeat_n("0".to_string(), 17));
                fields.push("123456".to_string());
                fs::write(
                    base.join("stat"),
                    format!("{pid} (name with parentheses ()) {}", fields.join(" ")),
                )
                .unwrap();
                fs::write(base.join("cmdline"), b"claude\0").unwrap();
                fs::write(
                    base.join("environ"),
                    b"HOME=/home/test\0ANTHROPIC_API_KEY=secret\0",
                )
                .unwrap();
                symlink("/project", base.join("cwd")).unwrap();
            }
            symlink("socket:[101]", proc.join("11/fd/3")).unwrap();
            symlink("/home/test/.codex/state.sqlite", proc.join("11/fd/4")).unwrap();
            let targets = targets_at(&proc, vec![("terminal".into(), "/project".into(), 10)]);
            fs::remove_dir_all(&proc).unwrap();
            assert_eq!(targets.len(), 1);
            assert_eq!(
                targets[0]
                    .processes
                    .iter()
                    .map(|process| process.pid)
                    .collect::<Vec<_>>(),
                [10, 11]
            );
            let process = &targets[0].processes[1];
            assert_eq!(process.listening, [4096]);
            assert_eq!(process.open_files, ["/home/test/.codex/state.sqlite"]);
            assert_eq!(process.cwd.as_deref(), Some("/project"));
            assert_eq!(process.env.len(), 1);
        }

        #[test]
        fn stat_names_and_process_tree_do_not_confuse_ownership() {
            assert_eq!(parent(b"12 (a name (with) brackets) S 42 0 0"), Some(42));
            let tree = HashMap::from([
                (10, vec![11, 12]),
                (11, vec![13]),
                (50, vec![51]),
                (13, vec![10]),
            ]);
            assert_eq!(descendants(10, &tree), [10, 11, 12, 13]);
        }

        #[test]
        fn environment_keeps_only_adapter_inputs() {
            let env = environment(b"HOME=/home/test\0CLAUDE_CONFIG_DIR=/config\0ANTHROPIC_API_KEY=secret\0OPENCODE_SERVER_PASSWORD=a=b\0INVALID\0");
            assert_eq!(env.len(), 3);
            assert_eq!(env["OPENCODE_SERVER_PASSWORD"], "a=b");
            assert!(!env.contains_key("ANTHROPIC_API_KEY"));
        }

        #[test]
        fn only_listening_loopback_or_wildcard_sockets_are_candidates() {
            let table = "0: 0100007F:1000 00000000:0000 0A 0 0 0 0 0 101\n1: 00000000:2000 00000000:0000 0A 0 0 0 0 0 102\n2: 0101A8C0:3000 00000000:0000 0A 0 0 0 0 0 103\n3: 0100007F:4000 00000000:0000 01 0 0 0 0 0 104";
            assert_eq!(
                listeners(table, false),
                HashMap::from([("101".into(), 4096), ("102".into(), 8192)])
            );
            let ipv6 = "0: 00000000000000000000000001000000:1000 00000000000000000000000000000000:0000 0A 0 0 0 0 0 201";
            assert_eq!(listeners(ipv6, true)["201"], 4096);
        }
    }
}
