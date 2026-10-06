//! Read-only Claude Code activity via its supported `agents --json` interface.
//! https://code.claude.com/docs/en/agent-view#list-sessions-as-json

use std::collections::HashMap;
use std::path::Path;

use serde_json::Value;

use super::{Process, Target, command_json};
use crate::monitor::ActivityState;

pub(super) fn read(targets: &[Target]) -> HashMap<String, ActivityState> {
    read_with(targets, command_json)
}

fn is_claude(process: &Process) -> bool {
    process.args.iter().take(2).any(|arg| {
        matches!(
            Path::new(arg).file_name().and_then(|name| name.to_str()),
            Some("claude" | "claude.exe")
        ) || arg.ends_with("/@anthropic-ai/claude-code/cli.js")
    })
}

fn read_with(
    targets: &[Target],
    mut command: impl FnMut(&str, &[&str], &HashMap<String, String>) -> Result<Value, String>,
) -> HashMap<String, ActivityState> {
    // Each configuration home has its own session registry. Query it once,
    // regardless of how many terminals contain Claude processes.
    let mut groups = HashMap::<(Option<String>, Option<String>), Vec<(&str, &Process)>>::new();
    for target in targets {
        for process in target.processes.iter().filter(|process| is_claude(process)) {
            let key = (
                process.env.get("HOME").cloned(),
                process.env.get("CLAUDE_CONFIG_DIR").cloned(),
            );
            groups.entry(key).or_default().push((&target.id, process));
        }
    }
    let mut activities = HashMap::new();
    for processes in groups.into_values() {
        let process = processes[0].1;
        let env = ["PATH", "HOME", "CLAUDE_CONFIG_DIR"]
            .into_iter()
            .filter_map(|key| {
                process
                    .env
                    .get(key)
                    .map(|value| (key.to_string(), value.clone()))
            })
            .collect();
        let program = process
            .args
            .iter()
            .take(2)
            .find(|arg| {
                Path::new(arg).is_absolute()
                    && matches!(
                        Path::new(arg).file_name().and_then(|name| name.to_str()),
                        Some("claude" | "claude.exe")
                    )
            })
            .map(String::as_str)
            .unwrap_or("claude");
        let Ok(list) = command(program, &["agents", "--json"], &env) else {
            continue;
        };
        let Some(list) = list.as_array() else {
            continue;
        };
        for session in list {
            let Some(pid) = session["pid"]
                .as_u64()
                .and_then(|pid| u32::try_from(pid).ok())
            else {
                // Completed/background records without a live process cannot
                // be assigned to a terminal by their working directory.
                continue;
            };
            let state = match session["status"].as_str() {
                Some("busy") => ActivityState::Working,
                Some("waiting" | "idle") => ActivityState::Agent,
                _ => continue,
            };
            for &(id, process) in &processes {
                if process.pid != pid {
                    continue;
                }
                activities
                    .entry(id.to_string())
                    .and_modify(|existing| {
                        if state == ActivityState::Working {
                            *existing = state;
                        }
                    })
                    .or_insert(state);
            }
        }
    }
    activities
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn target(id: &str, pid: u32) -> Target {
        Target {
            id: id.into(),
            cwd: "/same/project".into(),
            processes: vec![Process {
                pid,
                parent: 1,
                args: vec!["claude".into()],
                cwd: Some("/same/project".into()),
                env: HashMap::new(),
                listening: Vec::new(),
                open_files: Vec::new(),
            }],
        }
    }

    #[test]
    fn same_directory_sessions_are_assigned_by_live_pid_and_queried_once() {
        let targets = [
            target("working", 101),
            target("waiting", 102),
            target("idle", 103),
        ];
        let mut calls = 0;
        let activity = read_with(&targets, |program, args, _| {
            calls += 1;
            assert_eq!(program, "claude");
            assert_eq!(args, ["agents", "--json"]);
            Ok(json!([
                {"pid":101,"status":"busy","kind":"interactive","cwd":"/same/project"},
                {"pid":102,"status":"waiting","waitingFor":"permission prompt","kind":"interactive"},
                {"pid":103,"status":"idle","kind":"background"},
                {"pid":999,"status":"busy","cwd":"/same/project"},
                {"state":"working","kind":"background","cwd":"/same/project"}
            ]))
        });
        assert_eq!(calls, 1);
        assert_eq!(activity.len(), 3);
        assert_eq!(activity["working"], ActivityState::Working);
        assert_eq!(activity["waiting"], ActivityState::Agent);
        assert_eq!(activity["idle"], ActivityState::Agent);
    }

    #[test]
    fn absolute_claude_script_uses_the_running_installation() {
        let mut target = target("script", 101);
        target.processes[0].args = vec!["/bin/bash".into(), "/opt/claude".into()];
        let activity = read_with(&[target], |program, _, _| {
            assert_eq!(program, "/opt/claude");
            Ok(json!([{ "pid":101,"status":"busy" }]))
        });
        assert_eq!(activity["script"], ActivityState::Working);
    }

    #[test]
    fn separate_config_homes_are_queried_separately() {
        let mut targets = [target("one", 101), target("two", 102)];
        for (target, config) in targets.iter_mut().zip(["/config/one", "/config/two"]) {
            target.processes[0]
                .env
                .insert("CLAUDE_CONFIG_DIR".into(), config.into());
        }
        let mut seen = Vec::new();
        let activity = read_with(&targets, |_, _, env| {
            let config = env["CLAUDE_CONFIG_DIR"].clone();
            let pid = if config == "/config/one" { 101 } else { 102 };
            seen.push(config);
            Ok(json!([{ "pid":pid,"status":"busy" }]))
        });
        seen.sort();
        assert_eq!(seen, ["/config/one", "/config/two"]);
        assert_eq!(activity.len(), 2);
    }

    #[test]
    fn missing_unknown_and_failed_readings_do_not_override_terminal_fallback() {
        for reading in [
            Ok(json!([])),
            Ok(json!([{ "pid":101,"status":"unknown" }])),
            Ok(json!({"pid":101,"status":"busy"})),
            Err("unavailable".into()),
        ] {
            assert!(read_with(&[target("one", 101)], |_, _, _| reading.clone()).is_empty());
        }
    }
}
