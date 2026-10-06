//! End jobs owned by a PTY's private OS session, across shell job-control groups.
//! Detached services use another OS session and must survive terminal closure.

#[cfg(unix)]
pub(super) fn terminal_jobs(root: u32) {
    let Ok(root) = libc::pid_t::try_from(root) else {
        return;
    };
    if root <= 0 || unsafe { libc::getsid(root) } != root {
        return;
    }
    let jobs: Vec<_> = pids()
        .into_iter()
        .filter(|pid| *pid != root && *pid > 0 && unsafe { libc::getsid(*pid) } == root)
        .collect();
    if jobs.is_empty() {
        return;
    }
    for pid in &jobs {
        if unsafe { libc::getsid(*pid) } == root {
            unsafe {
                libc::kill(*pid, libc::SIGHUP);
            }
        }
    }
    // Give jobs a short opportunity to handle hangup, then end processes that
    // ignore it. Check ownership again so recycled PIDs cannot receive signals.
    std::thread::sleep(std::time::Duration::from_millis(100));
    for pid in jobs {
        if unsafe { libc::getsid(pid) } == root {
            unsafe {
                libc::kill(pid, libc::SIGKILL);
            }
        }
    }
}

#[cfg(target_os = "linux")]
fn pids() -> Vec<libc::pid_t> {
    std::fs::read_dir("/proc")
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|entry| entry.file_name().to_str()?.parse().ok())
        .collect()
}

#[cfg(all(unix, not(target_os = "linux")))]
fn pids() -> Vec<libc::pid_t> {
    let Ok(output) = std::process::Command::new("/bin/ps")
        .args(["-axo", "pid="])
        .stdin(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .output()
    else {
        return Vec::new();
    };
    if !output.status.success() {
        return Vec::new();
    }
    String::from_utf8_lossy(&output.stdout)
        .split_whitespace()
        .filter_map(|pid| pid.parse().ok())
        .collect()
}

#[cfg(not(unix))]
pub(super) fn terminal_jobs(_: u32) {
    // On Windows, dropping portable-pty's master calls ClosePseudoConsole,
    // which sends CTRL_CLOSE_EVENT to every still-connected console client.
    // Detached shared services must not be included in a taskkill /T tree.
}

#[cfg(all(test, target_os = "linux"))]
#[path = "tests/terminate.rs"]
mod tests;
