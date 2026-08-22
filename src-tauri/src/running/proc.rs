//! The process table, as much of it as finding an agent needs.
//!
//! Every one of these agents is a process with a working directory, and that
//! directory is the whole answer to "where is it working" — it is what the
//! repository, the worktree and the branch are all read back from. Nothing else
//! any of the three publishes is as reliable: a session file can outlive the
//! process that wrote it, and a rollout on disk says where an agent *was*.
//!
//! Linux only, deliberately. `/proc` is where a working directory can be read
//! back out of a process at all. That is not the same as "this machine": a
//! window on Windows with a folder open inside a WSL distribution is looking at
//! agents running in that distribution, and its `/proc` is reachable — so the
//! table is asked of a host rather than of the process this is. Where there is
//! no `/proc` at all the table comes back empty and the tools' own session
//! files are all there is — see `running::scan`.

use std::path::PathBuf;

use crate::host::Host;

/// One running process, in the terms this module cares about.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Process {
    pub pid: u32,
    pub ppid: u32,
    /// Milliseconds since the epoch, worked out from the boot clock.
    pub started_at: Option<u64>,
    /// The command as it was typed, without its directory — `claude`, `codex`.
    pub program: String,
    pub args: Vec<String>,
    /// Where it is running, which is the point of reading any of this.
    pub cwd: Option<PathBuf>,
    /// The kernel's own start stamp, in clock ticks since boot.
    ///
    /// Kept as it was read because that is the number the agents' own session
    /// files carry: a pid on its own is reused within a day on a busy machine,
    /// and pid plus this pair is what says it is still the same process.
    pub start_ticks: u64,
}

/// USER_HZ: the unit `/proc/<pid>/stat` counts a process's start in.
///
/// Fixed at 100 on every Linux this app is built for, WSL included. The C
/// library reads it from the kernel's auxiliary vector; nothing in the standard
/// library exposes that, and a wrong guess here only shifts a start time by a
/// factor, which is why it is not worth a dependency.
const TICKS_PER_SECOND: u64 = 100;

/// Everything running on `host` that this user can see into.
pub fn table(host: &Host) -> Vec<Process> {
    match host {
        Host::Local => here(),
        Host::Wsl(distro) => match crate::wsl::script(distro, None, DUMP, &[]) {
            Ok(output) => parse_table(host, &String::from_utf8_lossy(&output.stdout)),
            Err(_) => Vec::new(),
        },
    }
}

/// The whole of `/proc` that any of this needs, in one command.
///
/// Every line is `<path>:<contents>` — what `grep -H` gives for a file, and
/// what `find` is told to print for the working directory, which is a symlink
/// and so has a target rather than contents.
///
/// One command because this runs every couple of seconds: a process per file
/// per process would be thousands of them, inside a distribution, forever.
///
/// The command line is the one thing here that is not text — the kernel hands
/// it over NUL-separated — so its separators are turned into a byte a line can
/// hold. An argument holding a newline of its own is cut there, which is a
/// shape none of the three commands this looks for has.
const DUMP: &str = r#"
grep -a -H '^btime ' /proc/stat 2>/dev/null
find /proc -mindepth 2 -maxdepth 2 -name cwd -type l -printf '%h/cwd:%l\n' 2>/dev/null
grep -a -H '' /proc/[0-9]*/stat /proc/[0-9]*/comm 2>/dev/null
grep -a -H '' /proc/[0-9]*/cmdline 2>/dev/null | tr '\000' '\001'
"#;

/// Reads what [`DUMP`] prints back into the table `/proc` gives directly.
pub fn parse_table(host: &Host, dump: &str) -> Vec<Process> {
    use std::collections::HashMap;

    #[derive(Default)]
    struct Fields<'a> {
        stat: &'a str,
        comm: &'a str,
        args: &'a str,
        cwd: &'a str,
    }

    let mut boot: Option<u64> = None;
    let mut found: HashMap<u32, Fields> = HashMap::new();

    for line in dump.lines() {
        // A path holds no colon, so the first one ends it however odd what
        // follows is — and what follows is a process's own name for itself.
        let Some((path, content)) = line.split_once(':') else {
            continue;
        };
        if path == "/proc/stat" {
            boot = parse_btime(content);
            continue;
        }
        let Some((pid, field)) = path
            .strip_prefix("/proc/")
            .and_then(|rest| rest.split_once('/'))
        else {
            continue;
        };
        let Ok(pid) = pid.parse::<u32>() else {
            continue;
        };
        let fields = found.entry(pid).or_default();
        match field {
            "stat" => fields.stat = content,
            "comm" => fields.comm = content,
            "cmdline" => fields.args = content,
            "cwd" => fields.cwd = content,
            _ => {}
        }
    }

    let mut table = Vec::new();
    for (pid, fields) in found {
        let Some((ppid, start_ticks)) = parse_stat(fields.stat) else {
            continue;
        };
        let args: Vec<String> = fields
            .args
            .split('\u{1}')
            .filter(|word| !word.is_empty())
            .map(str::to_string)
            .collect();
        table.push(Process {
            pid,
            ppid,
            started_at: boot.map(|boot| started_at(boot, start_ticks)),
            program: program_of(&args, fields.comm),
            args,
            // Named the way the rest of the app names paths on this host, so
            // the directory an agent stands in is the one the graph has.
            cwd: (!fields.cwd.is_empty()).then(|| host.canonical(fields.cwd)),
            start_ticks,
        });
    }
    table
}

/// Everything running on this machine that this user can see into.
#[cfg(target_os = "linux")]
fn here() -> Vec<Process> {
    let boot = boot_time();
    let Ok(entries) = std::fs::read_dir("/proc") else {
        return Vec::new();
    };

    let mut found = Vec::new();
    for entry in entries.flatten() {
        let name = entry.file_name();
        let Some(pid) = name.to_str().and_then(|name| name.parse::<u32>().ok()) else {
            continue;
        };
        // A process can exit between the listing and any of these reads; that
        // is not a failure, it is one fewer process.
        if let Some(process) = read(pid, boot) {
            found.push(process);
        }
    }
    found
}

#[cfg(not(target_os = "linux"))]
fn here() -> Vec<Process> {
    Vec::new()
}

#[cfg(target_os = "linux")]
fn read(pid: u32, boot: Option<u64>) -> Option<Process> {
    let dir = PathBuf::from("/proc").join(pid.to_string());
    let stat = std::fs::read_to_string(dir.join("stat")).ok()?;
    let (ppid, start_ticks) = parse_stat(&stat)?;

    let cmdline = std::fs::read(dir.join("cmdline")).unwrap_or_default();
    let args = parse_cmdline(&cmdline);
    // `comm` is the fallback, and truncated to fifteen bytes by the kernel, so
    // it is only asked when the command line is empty — a kernel thread, or a
    // process that rewrote its own arguments.
    let comm = std::fs::read_to_string(dir.join("comm")).unwrap_or_default();

    Some(Process {
        pid,
        ppid,
        started_at: boot.map(|boot| started_at(boot, start_ticks)),
        program: program_of(&args, &comm),
        args,
        // Denied for anything this user does not own, which is exactly the set
        // of processes this feature has nothing to say about.
        cwd: std::fs::read_link(dir.join("cwd")).ok(),
        start_ticks,
    })
}

/// When the machine came up, in seconds since the epoch.
#[cfg(target_os = "linux")]
fn boot_time() -> Option<u64> {
    parse_btime(&std::fs::read_to_string("/proc/stat").ok()?)
}

/// Wall-clock milliseconds for a process that started `ticks` after boot.
pub fn started_at(boot_seconds: u64, ticks: u64) -> u64 {
    (boot_seconds * 1_000) + (ticks * 1_000 / TICKS_PER_SECOND)
}

/// The parent and the start stamp out of one `/proc/<pid>/stat` line.
///
/// The second field is the command in brackets and can hold anything a program
/// chose to call itself — spaces and brackets included — so the fixed fields
/// are counted from the last bracket rather than from the start of the line.
pub fn parse_stat(content: &str) -> Option<(u32, u64)> {
    let rest = &content[content.rfind(')')? + 1..];
    let fields: Vec<&str> = rest.split_ascii_whitespace().collect();
    // `state` is the first field after the name, which makes the parent the
    // second and the start stamp the twentieth.
    let ppid = fields.get(1)?.parse().ok()?;
    let start = fields.get(19)?.parse().ok()?;
    Some((ppid, start))
}

/// The `btime` line of `/proc/stat`: boot, in seconds since the epoch.
pub fn parse_btime(content: &str) -> Option<u64> {
    content
        .lines()
        .find_map(|line| line.strip_prefix("btime "))
        .and_then(|value| value.trim().parse().ok())
}

/// A command line, which the kernel hands over as NUL-separated words.
#[cfg_attr(not(any(target_os = "linux", test)), allow(dead_code))]
pub fn parse_cmdline(raw: &[u8]) -> Vec<String> {
    raw.split(|byte| *byte == 0)
        .filter(|word| !word.is_empty())
        .map(|word| String::from_utf8_lossy(word).into_owned())
        .collect()
}

/// What the command would be called if it were typed: no directory, no suffix.
///
/// Agents are installed wherever their installer put them — `~/.local/bin`, a
/// version manager's shims — so the path is no use for telling one agent from
/// another and the last part of it is.
///
/// Except when the last part is not a name at all: Claude Code keeps a binary
/// per version under the user's data directory, so a process started from one
/// of those directly is called `2.1.234`. The kernel's own short name is what
/// the process is called then, and it is `claude`.
pub fn program_of(args: &[String], comm: &str) -> String {
    let first = args.first().map(String::as_str).unwrap_or("").trim();
    let named = basename(first);

    // Installed through a package manager, the command is a script with a
    // shebang: the kernel runs the interpreter and hands it the script, so the
    // process is called `node` and the thing that was actually typed is the
    // argument after it. That is what an agent installed by npm or bun looks
    // like, which is most of them.
    if RUNTIMES.contains(&named.as_str())
        && let Some(script) = args.get(1)
    {
        let ran = basename(script);
        if ran.starts_with(|c: char| c.is_ascii_alphabetic()) {
            return ran;
        }
    }

    if named.starts_with(|c: char| c.is_ascii_alphabetic()) {
        return named;
    }
    let fallback = basename(comm.trim());
    if fallback.is_empty() { named } else { fallback }
}

/// The interpreters an agent is handed to, rather than being.
const RUNTIMES: [&str; 3] = ["node", "bun", "deno"];

/// The last part of a path, without the suffix Windows puts on a command.
fn basename(raw: &str) -> String {
    let base = raw.rsplit(['/', '\\']).next().unwrap_or(raw);
    let base = base.strip_suffix(".exe").unwrap_or(base);
    // `claude.cmd` where the shim is a batch file, `cli.js` where it is a
    // script that was named outright rather than run through its own shebang.
    let base = base.strip_suffix(".cmd").unwrap_or(base);
    base.strip_suffix(".js")
        .unwrap_or(base)
        .to_ascii_lowercase()
}
