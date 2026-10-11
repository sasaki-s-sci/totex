//! Agents in a WSL distribution, read from inside it.
//!
//! Codex is asked over a Unix socket and OpenCode over its loopback, and
//! neither is a thing Windows can reach in a distribution: a socket on the
//! other side of the share is not a socket, and whether the distribution's
//! loopback is reachable from here depends on how somebody set up WSL's
//! networking. So the reading is done by this same program built for Linux —
//! [`crate::WSL_HELPER`], carried beside the Windows one — run inside the
//! distribution as `totex-persistent probe`, given the targets on its input
//! and answering with what it found. The distribution's agents are then read
//! exactly the way a Linux build reads its own.

use std::collections::HashMap;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

use super::{ActivityState, Reply, Target, codex, merge, opencode};

/// The word on the command line that makes this program a probe.
pub const PROBE: &str = "probe";

/// What a probe is handed: the terminals' processes, and what an earlier probe
/// had worked out about which Codex process is which thread — the one thing
/// the reading remembers between one look and the next.
#[derive(Default, Deserialize, Serialize)]
pub(super) struct Request {
    pub targets: Vec<Target>,
    pub codex_known: HashMap<u32, String>,
}

/// And what it answers with: each terminal's state, every reply it read, and
/// what it now knows about the Codex processes, to be handed to the next one.
#[derive(Default, Deserialize, Serialize)]
pub(super) struct Answer {
    pub states: HashMap<String, ActivityState>,
    pub replies: Vec<(String, Reply)>,
    pub codex_known: HashMap<u32, String>,
}

/// The probe itself, as `totex-persistent probe` runs it: one request in, one
/// answer out.
pub fn probe(input: &[u8]) -> Result<Vec<u8>, String> {
    let request: Request = serde_json::from_slice(input).map_err(|error| error.to_string())?;
    serde_json::to_vec(&answer(request)).map_err(|error| error.to_string())
}

/// Reads the targets the way the monitor reads this machine's. Inside the
/// distribution they are this machine's, so whatever distribution they were
/// named with is dropped.
fn answer(request: Request) -> Answer {
    let mut targets = request.targets;
    for target in &mut targets {
        target.distro = None;
    }
    let mut replies = Vec::new();
    let mut codex = codex::Codex {
        known: request.codex_known,
    };
    let mut states = codex.read(&targets, |id, reply| {
        replies.push((id.to_string(), reply));
    });
    merge(
        &mut states,
        opencode::read_replies(&targets, |id, reply| {
            replies.push((id.to_string(), reply));
        }),
    );
    Answer {
        states,
        replies,
        codex_known: codex.known,
    }
}

/// The Windows side: one distribution's probe at a time, with what each one
/// last said about its Codex processes.
#[derive(Default)]
pub(super) struct Probes {
    known: HashMap<String, HashMap<u32, String>>,
    placed: HashMap<String, Placed>,
}

enum Placed {
    At(String),
    /// Not placed, and not to be tried again before then: a distribution that
    /// cannot take the helper is asked once a minute rather than every look.
    Refused(Instant),
}

impl Probes {
    /// Reads every distribution's targets inside that distribution. Nothing
    /// where this is not Windows, or where no Linux build came with this one.
    pub(super) fn read(
        &mut self,
        targets: &[Target],
        mut report: impl FnMut(&str, Reply),
    ) -> HashMap<String, ActivityState> {
        let mut states = HashMap::new();
        if !cfg!(windows) {
            return states;
        }
        let Some(helper) = helper() else {
            return states;
        };
        let mut by_distro = HashMap::<&str, Vec<&Target>>::new();
        for target in targets {
            if let Some(distro) = target.distro.as_deref() {
                by_distro.entry(distro).or_default().push(target);
            }
        }
        self.known
            .retain(|distro, _| by_distro.contains_key(distro.as_str()));
        for (distro, targets) in by_distro {
            let Some(program) = self.place(distro, &helper) else {
                continue;
            };
            let request = Request {
                targets: targets.into_iter().cloned().collect(),
                codex_known: self.known.remove(distro).unwrap_or_default(),
            };
            let Some(answer) = ask(distro, &program, &request) else {
                // A probe that failed may have been the binary going missing
                // under it; the next look places it again.
                self.placed.remove(distro);
                continue;
            };
            for (id, reply) in answer.replies {
                report(&id, reply);
            }
            merge(&mut states, answer.states);
            self.known.insert(distro.to_string(), answer.codex_known);
        }
        states
    }

    /// Where the helper is inside `distro`, putting it there first if it is not.
    fn place(&mut self, distro: &str, helper: &str) -> Option<String> {
        match self.placed.get(distro) {
            Some(Placed::At(program)) => return Some(program.clone()),
            Some(Placed::Refused(when)) if when.elapsed() < Duration::from_secs(60) => {
                return None;
            }
            _ => {}
        }
        let placed = totex_host::wsl::script(distro, None, PLACE, &[helper, crate::VERSION])
            .ok()
            .and_then(|said| placed_at(said.ok(), &said.text()));
        self.placed.insert(
            distro.to_string(),
            match &placed {
                Some(program) => Placed::At(program.clone()),
                None => Placed::Refused(Instant::now()),
            },
        );
        placed
    }
}

/// The Linux build beside this program, as Windows spells where it is.
fn helper() -> Option<String> {
    let beside = std::env::current_exe()
        .ok()?
        .parent()?
        .join(crate::WSL_HELPER);
    beside
        .is_file()
        .then(|| beside.to_string_lossy().into_owned())
}

/// Copies the helper named by `$1`, a Windows path, into the distribution's own
/// filesystem under this version, `$2`, and says where. Run from the share
/// every look it would be read across 9p every time; copied, it is read there
/// once. Copied beside where it goes and moved into place, so that a probe
/// never runs half a program, and not copied at all when what is there is
/// already the same.
const PLACE: &str = r#"
src=$(wslpath -u "$1") && test -f "$src" || exit 1
test -n "$HOME" && test "${HOME#/}" != "$HOME" || exit 1
dir="$HOME/.local/share/totex/wsl/$2"
dst="$dir/totex-persistent"
if ! cmp -s "$src" "$dst"; then
  mkdir -p -- "$dir" && cp -- "$src" "$dst.placing" && chmod 755 -- "$dst.placing" && mv -f -- "$dst.placing" "$dst" || exit 1
fi
printf '%s' "$dst"
"#;

fn placed_at(ok: bool, said: &str) -> Option<String> {
    (ok && said.starts_with('/') && !said.contains(['\n', '\r', '\0'])).then(|| said.to_string())
}

/// Runs one probe inside `distro`. Bounded there, because a channel cannot be
/// abandoned halfway through an answer the way a child process can be killed.
fn ask(distro: &str, program: &str, request: &Request) -> Option<Answer> {
    let input = serde_json::to_vec(request).ok()?;
    let said =
        totex_host::wsl::exec_input(distro, &["timeout", "10", program, PROBE], &input).ok()?;
    if !said.ok() {
        return None;
    }
    serde_json::from_slice(&said.stdout).ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::monitor::{Process, ReplyStatus};

    fn target(id: &str, distro: Option<&str>) -> Target {
        Target {
            id: id.into(),
            cwd: "/home/a".into(),
            distro: distro.map(str::to_string),
            processes: vec![Process {
                pid: 7,
                parent: 1,
                args: vec!["bash".into()],
                cwd: Some("/home/a".into()),
                env: HashMap::from([("TOTEX_TERMINAL".into(), id.into())]),
                listening: vec![],
                open_files: vec![],
            }],
        }
    }

    /// What goes in comes out the other end of the probe as it went in, and
    /// what the probe remembered about Codex comes back for the next one.
    #[test]
    fn a_probe_answers_the_request_it_was_given() {
        let request = Request {
            targets: vec![target("t", Some("Ubuntu"))],
            codex_known: HashMap::from([(7, "thread".into()), (99, "gone".into())]),
        };
        let input = serde_json::to_vec(&request).unwrap();
        let back: Request = serde_json::from_slice(&input).unwrap();
        assert_eq!(back.targets[0].processes[0].env["TOTEX_TERMINAL"], "t");
        assert_eq!(back.targets[0].distro.as_deref(), Some("Ubuntu"));

        let answer: Answer = serde_json::from_slice(&probe(&input).unwrap()).unwrap();
        // No agent among the processes: nothing to say, and the Codex
        // processes no longer running are forgotten.
        assert!(answer.states.is_empty());
        assert!(answer.replies.is_empty());
        assert!(answer.codex_known.is_empty());
        assert!(probe(b"not json").is_err());
    }

    #[test]
    fn an_answer_survives_the_trip_back() {
        let answer = Answer {
            states: HashMap::from([("t".into(), ActivityState::Working)]),
            replies: vec![(
                "t".into(),
                Reply::new("codex", "s", "turn", ReplyStatus::Completed, "done"),
            )],
            codex_known: HashMap::from([(7, "thread".into())]),
        };
        let back: Answer = serde_json::from_slice(&serde_json::to_vec(&answer).unwrap()).unwrap();
        assert_eq!(back.states["t"], ActivityState::Working);
        assert_eq!(back.replies, answer.replies);
        assert_eq!(back.codex_known[&7], "thread");
    }

    #[test]
    fn only_a_single_absolute_path_is_a_placed_helper() {
        assert_eq!(
            placed_at(true, "/home/a/.local/share/totex/wsl/1/totex-persistent").as_deref(),
            Some("/home/a/.local/share/totex/wsl/1/totex-persistent")
        );
        for said in ["", "C:\\x", "banner\n/home/a/x", "/x\n"] {
            assert!(placed_at(true, said).is_none(), "{said:?}");
        }
        assert!(placed_at(false, "/x").is_none());
    }

    /// The distribution's half, against a stand-in `wslpath`: the helper is
    /// copied under the version, executable, and left alone when it is already
    /// there.
    #[cfg(unix)]
    #[test]
    fn placing_copies_once_under_the_version() {
        use std::os::unix::fs::PermissionsExt;
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root =
            std::env::temp_dir().join(format!("totex-wsl-place-{}-{unique}", std::process::id()));
        let bin = root.join("bin");
        std::fs::create_dir_all(&bin).unwrap();
        let source = root.join("helper");
        std::fs::write(&source, b"\x7fELF").unwrap();
        let wslpath = bin.join("wslpath");
        std::fs::write(
            &wslpath,
            format!("#!/bin/sh\nprintf '%s' '{}'\n", source.display()),
        )
        .unwrap();
        std::fs::set_permissions(&wslpath, std::fs::Permissions::from_mode(0o755)).unwrap();
        let run = || {
            std::process::Command::new("sh")
                .args(["-c", PLACE, "totex", "C:\\x\\helper", "9.9.9"])
                .env("HOME", &root)
                .env(
                    "PATH",
                    format!("{}:{}", bin.display(), std::env::var("PATH").unwrap()),
                )
                .output()
                .unwrap()
        };
        let first = run();
        let placed = root.join(".local/share/totex/wsl/9.9.9/totex-persistent");
        let modified = std::fs::metadata(&placed).unwrap().modified().unwrap();
        let mode = std::fs::metadata(&placed).unwrap().permissions().mode() & 0o777;
        std::thread::sleep(Duration::from_millis(20));
        let second = run();
        let unchanged = std::fs::metadata(&placed).unwrap().modified().unwrap() == modified;
        let contents = std::fs::read(&placed).unwrap();
        std::fs::remove_dir_all(&root).unwrap();
        assert!(first.status.success(), "{first:?}");
        assert_eq!(
            String::from_utf8(first.stdout.clone()).unwrap(),
            placed.display().to_string()
        );
        assert_eq!(second.stdout, first.stdout);
        assert_eq!(mode, 0o755);
        assert!(unchanged, "an identical helper is not copied again");
        assert_eq!(contents, b"\x7fELF");
    }
}
