//! The loop that stands in for Windows' change notifications.
//!
//! Nothing on the Windows side is told when a file inside a distribution moves —
//! the share publishes no notifications at all — so the distribution is asked
//! instead, once a second, for what has been written since the last look.

use std::io::Read;
use std::process::{Child, ChildStdout, Stdio};

use super::shell::command;

/// How many paths one poll is given, so the command line stays a command line.
const WATCHED: usize = 200;

/// A depth that is not a depth, for the targets watched all the way down.
const DEEP: usize = 64;

/// A poll running inside a distribution. Dropping it stops the loop.
pub struct Poll {
    children: Vec<Child>,
}

impl Drop for Poll {
    fn drop(&mut self) {
        for child in &mut self.children {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

/// The overlap of a second is deliberate: `find` compares whole seconds, so a
/// write landing in the same second as the previous look would fall between two
/// ticks and never be reported. Reporting it twice instead costs a debounce.
const POLL: &str = r#"
depth=$1
shift
last=$(date +%s)
while :; do
  sleep 1
  now=$(date +%s)
  find "$@" -maxdepth "$depth" -newermt "@$last" -print0 2>/dev/null
  printf '\000'
  last=$((now - 1))
done
"#;

/// Watches `paths` inside `distro`, and says which of them moved. `recursive` is
/// whether a target's whole tree counts or only the directory itself — the same
/// two modes the local watcher has. The paths handed to `on_change` are the
/// distribution's own spelling.
pub fn watch(
    distro: &str,
    recursive: bool,
    paths: &[String],
    on_change: impl Fn(Vec<String>) + Send + Clone + 'static,
) -> Result<Poll, String> {
    let depth = if recursive { DEEP } else { 1 }.to_string();
    let mut children = Vec::new();

    for batch in paths.chunks(WATCHED) {
        let mut child = command(distro, None)
            .arg("-e")
            .arg("sh")
            .arg("-c")
            .arg(POLL)
            .arg("totex")
            .arg(&depth)
            .args(batch)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|error| format!("wsl-unreachable: {error}"))?;

        let Some(output) = child.stdout.take() else {
            continue;
        };
        children.push(child);

        let said = on_change.clone();
        std::thread::spawn(move || pump(output, said));
    }

    Ok(Poll { children })
}

/// Reads what one poll says: NUL-terminated paths, and an empty record for the
/// end of a round. The round is what makes a batch, so a command that touched
/// forty files is one refresh and not forty.
fn pump(mut output: ChildStdout, on_change: impl Fn(Vec<String>)) {
    let mut buffer = Vec::new();
    let mut batch: Vec<String> = Vec::new();
    let mut chunk = [0u8; 8 * 1024];

    loop {
        let read = match output.read(&mut chunk) {
            Ok(0) | Err(_) => return,
            Ok(read) => read,
        };
        buffer.extend_from_slice(&chunk[..read]);

        while let Some(at) = buffer.iter().position(|byte| *byte == 0) {
            let record: Vec<u8> = buffer.drain(..=at).take(at).collect();
            if record.is_empty() {
                if !batch.is_empty() {
                    on_change(std::mem::take(&mut batch));
                }
                continue;
            }
            batch.push(String::from_utf8_lossy(&record).into_owned());
        }
    }
}
