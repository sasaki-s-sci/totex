//! `wsl.exe` itself: how it is spawned, how a command line is quoted for the
//! shell at the far end, and which distributions there are.

use std::process::Command;

/// One argument, as a Bourne shell has to read it to get it back unchanged.
/// Single quotes, so nothing inside is expanded: these carry file paths and
/// people's sentences, and `$`, backticks and backslashes all have to survive.
pub fn quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

/// A command line for the shell at the other end of a channel: the directory to
/// run in, the environment to run under, and the words themselves.
pub fn line(cwd: Option<&str>, env: &[(&str, &str)], argv: &[&str]) -> String {
    let mut rendered = String::new();
    if let Some(cwd) = cwd {
        rendered.push_str(&format!("cd {} && ", quote(cwd)));
    }
    for (name, value) in env {
        rendered.push_str(&format!("{name}={} ", quote(value)));
    }
    let mut words = argv.iter();
    if let Some(first) = words.next() {
        rendered.push_str(&quote(first));
    }
    for word in words {
        rendered.push(' ');
        rendered.push_str(&quote(word));
    }
    rendered
}

/// `wsl.exe`, wherever this build can reach it. On Windows it is on the path; a
/// Linux build is itself inside a distribution, where Windows programs are
/// reachable through interop — which is what lets this be tested on either side.
pub fn program() -> &'static str {
    if cfg!(windows) {
        "wsl.exe"
    } else {
        "/mnt/c/Windows/System32/wsl.exe"
    }
}

/// A `wsl.exe` that will not flash a console window over the app.
///
/// Public because the streaming halves — the terminal, an agent's turn, a watch
/// — own their own child rather than borrowing a channel: they are open for as
/// long as somebody is looking at them.
pub fn command(distro: &str, cwd: Option<&str>) -> Command {
    let mut command = Command::new(program());
    command.arg("-d").arg(distro);
    if let Some(cwd) = cwd {
        command.arg("--cd").arg(cwd);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    command
}

/// The installed distributions, as `wsl.exe` reports them. Only the rail asks,
/// and only the Windows side has a rail with distributions on it.
#[cfg_attr(not(any(windows, test)), allow(dead_code))]
pub fn distros() -> Vec<String> {
    let mut command = Command::new(program());
    command.args(["--list", "--quiet"]);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    match command.output() {
        // WSL is simply not installed, which is not an error worth surfacing.
        Err(_) => Vec::new(),
        Ok(output) if !output.status.success() => Vec::new(),
        Ok(output) => parse_list(&output.stdout),
    }
}

/// Parses `wsl.exe --list --quiet`, which answers in UTF-16LE on most builds and
/// in UTF-8 on others.
#[cfg_attr(not(any(windows, test)), allow(dead_code))]
pub fn parse_list(stdout: &[u8]) -> Vec<String> {
    let zeros = stdout.iter().filter(|byte| **byte == 0).count();
    let text = if zeros * 3 > stdout.len() {
        let units: Vec<u16> = stdout
            .chunks_exact(2)
            .map(|pair| u16::from_le_bytes([pair[0], pair[1]]))
            .collect();
        String::from_utf16_lossy(&units)
    } else {
        String::from_utf8_lossy(stdout).into_owned()
    };

    text.lines()
        .map(|line| line.trim_matches(|c: char| c.is_whitespace() || c == '\u{feff}' || c == '\0'))
        // `--quiet` drops the header, but not the default marker on old builds.
        .map(|line| line.trim_end_matches("(Default)").trim())
        .filter(|line| !line.is_empty())
        .map(str::to_string)
        .collect()
}
