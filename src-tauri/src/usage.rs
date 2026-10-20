//! What each terminal's processes use of this machine, asked of the process
//! table. Only processes on this machine count: a WSL or SSH terminal is a
//! `wsl.exe` or `ssh` here, so its figures are that relay alone.

use crate::pty;
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager, Runtime};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Usage {
    pub id: String,
    pub cwd: String,
    /// The share of the whole machine's CPU, in percent. `None` until a second
    /// reading gives a rate to compare with.
    pub cpu: Option<f64>,
    /// Resident memory of the terminal's processes, in bytes.
    pub memory: u64,
}

/// One process as the table has it.
#[derive(Clone, Copy)]
struct Proc {
    pid: u32,
    parent: u32,
    /// Total CPU time the process has used so far.
    cpu: Duration,
    memory: u64,
}

/// A terminal's CPU time at the moment it was read.
#[derive(Clone, Copy)]
struct Reading {
    at: Instant,
    cpu: Duration,
}

#[derive(Default)]
pub struct UsageState {
    last: Mutex<HashMap<String, Reading>>,
}

/// Every terminal's usage as it stands, polled while the sidebar shows it.
#[tauri::command(async)]
pub fn terminal_usage<R: Runtime>(app: AppHandle<R>) -> Vec<Usage> {
    let sessions = pty::running(&app);
    let procs = table();
    let cores = std::thread::available_parallelism().map_or(1, |n| n.get());
    let now = Instant::now();
    let state = app.state::<UsageState>();
    let mut last = crate::sync::lock(&state.last);
    let mut next = HashMap::new();
    let usage = sessions
        .into_iter()
        .filter_map(|session| {
            let pid = session.pid?;
            let (cpu, memory) = sum(&procs, pid);
            let reading = Reading { at: now, cpu };
            let share = last
                .get(&session.id)
                .map(|before| share(*before, reading, cores));
            next.insert(session.id.clone(), reading);
            Some(Usage {
                id: session.id,
                cwd: session.cwd,
                cpu: share,
                memory,
            })
        })
        .collect();
    // Replaced whole, so a terminal that has gone takes its reading with it.
    *last = next;
    usage
}

/// Totals over `root` and every process under it, found by walking parents.
/// A process that has exited takes its time with it, so a total can go down;
/// `share` treats that as no CPU rather than a negative one.
fn sum(procs: &[Proc], root: u32) -> (Duration, u64) {
    let mut members = HashSet::from([root]);
    let mut grew = true;
    while grew {
        grew = false;
        for proc in procs {
            if !members.contains(&proc.pid) && members.contains(&proc.parent) {
                members.insert(proc.pid);
                grew = true;
            }
        }
    }
    procs
        .iter()
        .filter(|proc| members.contains(&proc.pid))
        .fold((Duration::ZERO, 0), |(cpu, memory), proc| {
            (cpu + proc.cpu, memory + proc.memory)
        })
}

/// The percent of the whole machine's CPU used between two readings.
fn share(before: Reading, now: Reading, cores: usize) -> f64 {
    let wall = now.at.duration_since(before.at).as_secs_f64();
    if wall <= 0.0 {
        return 0.0;
    }
    let used = now.cpu.saturating_sub(before.cpu).as_secs_f64();
    used / wall / cores as f64 * 100.0
}

/// Every process on this machine, read off `/proc`.
#[cfg(target_os = "linux")]
fn table() -> Vec<Proc> {
    let Ok(entries) = std::fs::read_dir("/proc") else {
        return vec![];
    };
    entries
        .flatten()
        .filter_map(|entry| {
            let pid: u32 = entry.file_name().to_str()?.parse().ok()?;
            let stat = std::fs::read_to_string(entry.path().join("stat")).ok()?;
            // The command name sits in parentheses and may hold spaces, so the
            // fields are counted from its end.
            let (_, rest) = stat.rsplit_once(") ")?;
            let fields: Vec<&str> = rest.split_whitespace().collect();
            // From the state field on: parent is 1, utime 11 and stime 12.
            let parent: u32 = fields.get(1)?.parse().ok()?;
            let ticks: u64 =
                fields.get(11)?.parse::<u64>().ok()? + fields.get(12)?.parse::<u64>().ok()?;
            // shortcut: takes USER_HZ as 100, which every Linux build here uses; read sysconf if one does not.
            let cpu = Duration::from_millis(ticks * 10);
            let status = std::fs::read_to_string(entry.path().join("status")).ok()?;
            let kib: u64 = status
                .lines()
                .find_map(|line| line.strip_prefix("VmRSS:"))?
                .split_whitespace()
                .next()?
                .parse()
                .ok()?;
            Some(Proc {
                pid,
                parent,
                cpu,
                memory: kib * 1024,
            })
        })
        .collect()
}

/// Every process on this machine, from a snapshot of the table and each one's
/// times and working set. A process that cannot be opened is left out.
#[cfg(windows)]
fn table() -> Vec<Proc> {
    use windows_sys::Win32::Foundation::{CloseHandle, FILETIME, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, PROCESSENTRY32W, Process32FirstW, Process32NextW,
        TH32CS_SNAPPROCESS,
    };
    use windows_sys::Win32::System::ProcessStatus::{
        GetProcessMemoryInfo, PROCESS_MEMORY_COUNTERS,
    };
    use windows_sys::Win32::System::Threading::{
        GetProcessTimes, OpenProcess, PROCESS_QUERY_INFORMATION, PROCESS_VM_READ,
    };
    let mut pairs = Vec::new();
    // SAFETY: the snapshot handle is closed once walked, and the entry is sized
    // as the walk requires.
    unsafe {
        let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if snapshot == INVALID_HANDLE_VALUE {
            return vec![];
        }
        let mut entry: PROCESSENTRY32W = std::mem::zeroed();
        entry.dwSize = size_of::<PROCESSENTRY32W>() as u32;
        let mut more = Process32FirstW(snapshot, &mut entry) != 0;
        while more {
            pairs.push((entry.th32ProcessID, entry.th32ParentProcessID));
            more = Process32NextW(snapshot, &mut entry) != 0;
        }
        CloseHandle(snapshot);
    }
    pairs
        .into_iter()
        .filter_map(|(pid, parent)| {
            // SAFETY: the handle is closed before the reading leaves this closure, and
            // the counters are sized as the call requires.
            unsafe {
                let process = OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, 0, pid);
                if process.is_null() {
                    return None;
                }
                let (mut created, mut exited, mut kernel, mut user) = (
                    std::mem::zeroed::<FILETIME>(),
                    std::mem::zeroed::<FILETIME>(),
                    std::mem::zeroed::<FILETIME>(),
                    std::mem::zeroed::<FILETIME>(),
                );
                let mut counters: PROCESS_MEMORY_COUNTERS = std::mem::zeroed();
                counters.cb = size_of::<PROCESS_MEMORY_COUNTERS>() as u32;
                let timed =
                    GetProcessTimes(process, &mut created, &mut exited, &mut kernel, &mut user);
                let sized = GetProcessMemoryInfo(process, &mut counters, counters.cb);
                CloseHandle(process);
                if timed == 0 {
                    return None;
                }
                let hundreds_of_ns = |time: FILETIME| {
                    (u64::from(time.dwHighDateTime) << 32) | u64::from(time.dwLowDateTime)
                };
                let cpu = Duration::from_nanos(
                    hundreds_of_ns(kernel).saturating_add(hundreds_of_ns(user)) * 100,
                );
                let memory = if sized == 0 {
                    0
                } else {
                    counters.WorkingSetSize as u64
                };
                Some(Proc {
                    pid,
                    parent,
                    cpu,
                    memory,
                })
            }
        })
        .collect()
}

#[cfg(not(any(target_os = "linux", windows)))]
fn table() -> Vec<Proc> {
    vec![]
}

#[cfg(test)]
mod tests {
    use super::*;

    fn proc(pid: u32, parent: u32, cpu_ms: u64, memory: u64) -> Proc {
        Proc {
            pid,
            parent,
            cpu: Duration::from_millis(cpu_ms),
            memory,
        }
    }

    #[test]
    fn sums_a_terminal_and_only_what_runs_under_it() {
        let procs = [
            proc(10, 1, 500, 100),
            proc(11, 10, 200, 20),
            proc(12, 11, 300, 3),
            proc(20, 1, 900, 900),
            proc(21, 20, 0, 0),
        ];
        assert_eq!(sum(&procs, 10), (Duration::from_millis(1000), 123));
    }

    #[test]
    fn finds_children_listed_before_their_parent() {
        let procs = [
            proc(12, 11, 300, 3),
            proc(11, 10, 200, 20),
            proc(10, 1, 500, 100),
        ];
        assert_eq!(sum(&procs, 10), (Duration::from_millis(1000), 123));
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn reads_this_process_off_the_table() {
        let me = std::process::id();
        let found = table().into_iter().find(|proc| proc.pid == me);
        let found = found.expect("this process is in the table");
        assert!(found.memory > 0);
    }

    #[test]
    fn shares_the_cpu_time_of_the_whole_machine() {
        let at = Instant::now();
        let before = Reading {
            at,
            cpu: Duration::from_secs(1),
        };
        let now = Reading {
            at: at + Duration::from_secs(2),
            cpu: Duration::from_secs(2),
        };
        // One second of CPU over two seconds on four cores is an eighth of the machine.
        assert_eq!(share(before, now, 4), 12.5);
        // A total that drops, as when a process exits, reads as no CPU rather than a negative one.
        let shrunk = Reading {
            at: now.at + Duration::from_secs(1),
            cpu: Duration::from_secs(1),
        };
        assert_eq!(share(now, shrunk, 4), 0.0);
    }
}
