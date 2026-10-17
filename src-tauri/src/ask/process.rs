//! What a shell is running, asked of the operating system rather than read off
//! the screen.
//!
//! The screen only says what was typed, which is not what ran: an alias, a
//! line still being edited, a command that has already ended. The process table
//! says what is running now. It is only asked on this machine — a WSL or SSH
//! session is a `wsl.exe` or `ssh` here, and what runs inside it is that
//! host's to report — so for those, and for a shell sitting at its prompt,
//! there is no answer.

/// The command line of what `shell` is running in the foreground, its program
/// named by file name alone. `None` while the shell has nothing running, or
/// when what it runs is not on this machine.
pub fn foreground(shell: u32) -> Option<String> {
    let mut words = arguments(running(shell)?)?;
    let program = &words[0];
    let name = program.rsplit(['/', '\\']).next().unwrap_or(program);
    words[0] = name.strip_suffix(".exe").unwrap_or(name).to_string();
    Some(words.join(" "))
}

/// The terminal's foreground process group, when it is not the shell's own.
/// Its leader is the first command of a pipeline, which is the one typed.
#[cfg(target_os = "linux")]
fn running(shell: u32) -> Option<u32> {
    let stat = std::fs::read_to_string(format!("/proc/{shell}/stat")).ok()?;
    // The command name is in parentheses and may hold anything, spaces included.
    let (_, fields) = stat.rsplit_once(") ")?;
    let fields: Vec<&str> = fields.split_whitespace().collect();
    let (group, foreground) = (fields.get(2)?, fields.get(5)?);
    if group == foreground {
        return None;
    }
    foreground.parse().ok()
}

#[cfg(target_os = "linux")]
fn arguments(pid: u32) -> Option<Vec<String>> {
    let line = std::fs::read(format!("/proc/{pid}/cmdline")).ok()?;
    let words: Vec<String> = line
        .split(|byte| *byte == 0)
        .filter(|word| !word.is_empty())
        .map(|word| String::from_utf8_lossy(word).into_owned())
        .collect();
    (!words.is_empty()).then_some(words)
}

/// ConPTY has no foreground group, so the shell's newest child stands in for
/// it: pwsh and cmd wait on what they start, so that child is what runs.
#[cfg(windows)]
fn running(shell: u32) -> Option<u32> {
    use windows_sys::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, PROCESSENTRY32W, Process32FirstW, Process32NextW,
        TH32CS_SNAPPROCESS,
    };
    let mut child = None;
    let mut elsewhere = false;
    // SAFETY: the snapshot handle is closed once walked, and the entry is sized
    // as the walk requires.
    unsafe {
        let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if snapshot == INVALID_HANDLE_VALUE {
            return None;
        }
        let mut entry: PROCESSENTRY32W = std::mem::zeroed();
        entry.dwSize = size_of::<PROCESSENTRY32W>() as u32;
        let mut more = Process32FirstW(snapshot, &mut entry) != 0;
        while more {
            if entry.th32ProcessID == shell {
                let end = entry.szExeFile.iter().position(|c| *c == 0).unwrap_or(0);
                let name = String::from_utf16_lossy(&entry.szExeFile[..end]).to_lowercase();
                elsewhere = matches!(name.as_str(), "wsl.exe" | "ssh.exe");
            } else if entry.th32ParentProcessID == shell {
                child = Some(entry.th32ProcessID);
            }
            more = Process32NextW(snapshot, &mut entry) != 0;
        }
        CloseHandle(snapshot);
    }
    if elsewhere { None } else { child }
}

#[cfg(windows)]
fn arguments(pid: u32) -> Option<Vec<String>> {
    use windows_sys::Wdk::System::Threading::{
        NtQueryInformationProcess, ProcessCommandLineInformation,
    };
    use windows_sys::Win32::Foundation::{CloseHandle, UNICODE_STRING};
    use windows_sys::Win32::System::Threading::{OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION};
    // SAFETY: the buffer is u64-aligned for the UNICODE_STRING written at its
    // head, and the string it points at lies inside the same buffer.
    let line = unsafe {
        let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if process.is_null() {
            return None;
        }
        let mut buffer = vec![0u64; 1024];
        let mut length = 0;
        let status = NtQueryInformationProcess(
            process,
            ProcessCommandLineInformation,
            buffer.as_mut_ptr().cast(),
            (buffer.len() * 8) as u32,
            &mut length,
        );
        CloseHandle(process);
        if status < 0 {
            return None;
        }
        let text = &*buffer.as_ptr().cast::<UNICODE_STRING>();
        let units = std::slice::from_raw_parts(text.Buffer, text.Length as usize / 2);
        String::from_utf16_lossy(units)
    };
    let words = split(&line);
    (!words.is_empty()).then_some(words)
}

/// A Windows command line in words, by the quoting most programs parse it with.
#[cfg(any(windows, test))]
fn split(line: &str) -> Vec<String> {
    let mut words = Vec::new();
    let mut word = String::new();
    let mut quoted = false;
    let mut started = false;
    for c in line.chars() {
        match c {
            '"' => {
                quoted = !quoted;
                started = true;
            }
            ' ' | '\t' if !quoted => {
                if started {
                    words.push(std::mem::take(&mut word));
                }
                started = false;
            }
            _ => {
                word.push(c);
                started = true;
            }
        }
    }
    if started {
        words.push(word);
    }
    words
}

#[cfg(not(any(target_os = "linux", windows)))]
fn running(_shell: u32) -> Option<u32> {
    None
}

#[cfg(not(any(target_os = "linux", windows)))]
fn arguments(_pid: u32) -> Option<Vec<String>> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_windows_line_keeps_quoted_spaces() {
        assert_eq!(
            split(r#""C:\Program Files\nodejs\node.exe"  run.js "a b" """#),
            [r"C:\Program Files\nodejs\node.exe", "run.js", "a b", ""]
        );
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn a_shell_at_its_prompt_runs_nothing_and_a_command_is_named() {
        use std::process::{Command, Stdio};
        // A process on no terminal has no foreground to ask about.
        let mut shell = Command::new("sleep")
            .arg("5")
            .stdin(Stdio::null())
            .spawn()
            .unwrap();
        assert_eq!(foreground(shell.id()), None);
        assert_eq!(arguments(shell.id()).unwrap(), ["sleep", "5"]);
        shell.kill().unwrap();
        shell.wait().unwrap();
    }
}
