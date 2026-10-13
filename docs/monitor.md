# Monitor

Monitor is an optional observer for terminal sessions. In **Settings → Monitor**
choose the coding agent that observes (Claude Code, Codex, OpenCode or a
custom ACP agent), then pick its model from the list the agent itself reports.
The model field also accepts a typed model ID; empty means the agent's default.
The agent must be installed and signed in on the terminal's host.

Status, agents, current task, user request, time estimate and goal are separate
features. Switching a feature off removes its prompt instructions, its schema
field and its displayed field. Monitor is disabled by default. Time estimates
are also disabled by default.

## How each agent is driven

Every observation sends one prompt holding the observer rules, the enabled
fields, the previous observation and a bounded transcript snapshot between
random markers. The terminal content is data, never instructions.

| Agent | Observation | Model list |
| --- | --- | --- |
| Claude Code | `claude -p --model M --tools "" --strict-mcp-config --setting-sources "" --no-session-persistence --output-format json --json-schema S` | stream-json `initialize` control request |
| Codex | `codex exec -m M --ephemeral --skip-git-repo-check --ignore-user-config -s read-only --output-schema schema.json -` | `codex debug models` (listed models) |
| OpenCode | ACP: `opencode acp`, model and `plan` mode set through session config options | ACP session model option |
| Custom | ACP: the configured command and arguments | ACP session model option |

Claude Code and Codex run without tools, user settings, MCP servers or saved
sessions, and their answer is constrained by a strict JSON Schema. ACP agents
use the [agent-client-protocol Rust SDK](https://docs.rs/agent-client-protocol/3.3.0/agent_client_protocol/);
their permission requests are cancelled, so Monitor never approves work.
No global agent configuration is edited.

The model list comes from the host of a live terminal (then the local machine)
and names that host under the field. A missing executable is reported as
`<agent> is not installed on <environment>`; a failing agent reports the end of
its error output.

## Environment

The observer starts in a private directory under
`~/.local/share/totex/monitor` on Unix or `%LOCALAPPDATA%/totex/monitor` on
Windows. SSH and WSL terminal paths select their corresponding remote host and
the agent runs there. Paths and arguments are quoted independently. The
observed project's directory is not the observer's working directory.

The environment is the host used to open the terminal in totex. Manually
entering another SSH/WSL shell inside an existing terminal is not a host
change known to totex. Open the remote folder as a totex terminal to select
its host explicitly.

## Reading the display

Execution status is `unknown`, `running`, `permission`, `stopped`, `success`
or `failure`. Goal mode is separate: `active`, `paused`, `blocked` or
`complete`. A stopped observer between observations does not mean the
terminal's task has stopped.

The monitor and terminal shell lifecycles are measured. Task status, summaries,
additional workers, progress and remaining time are inferred from visible
terminal evidence and marked accordingly. Missing workers are not proof that
none exist. A terminal UI that never exposes its background agents cannot
yield a complete background inventory through observation alone. Unknown
estimates stay unknown; estimates include confidence and are not countdowns.

The compact terminal badge opens details containing the request, current task,
goal, worker rows, estimate, observation time and errors. Refresh requests a
new observation even when the terminal output has not changed.

## Lifecycle

The runtime checks changed terminal output at the configured interval, with
at most four concurrent observations and a 120-second observation timeout.
Unchanged output does not trigger another inference. Each observation uses a
bounded Unicode-safe transcript snapshot. Permission requests from the
observer are cancelled: Monitor does not approve work in the user's terminal.

Disabling Monitor, changing its configuration, closing a terminal or stopping
the service cancels obsolete work. Results from an older configuration cannot
replace current observations.

This adds persistent-runtime commands, so installation requires a full runtime
update, not a frontend-only refresh. Release planning classifies the change as
a minor release under the repository's existing update policy.

## Desktop and live-agent tests

`task test:e2e` builds the desktop app and persistent sidecar, then drives the
actual Linux WebView through WebDriver. It records video, screenshots and an
HTML report under `test-results/e2e`. Monitor checks use a deterministic custom ACP
process; the UI, settings persistence,
PTY and observer runtime are real. The suite checks summaries, goal, worker
progress, feature-specific prompts, cancellation and startup failures.
It does not require a provider account.

For an installed agent and real model, run the optional test after building
the persistent binary (`cargo build -p totex-persistent` in `src-tauri`):

```sh
TOTEX_TEST_MONITOR_AGENT=claude TOTEX_TEST_MONITOR_MODEL=haiku \
node tests/e2e/live-monitor.mjs
```

`TOTEX_TEST_MONITOR_AGENT` is `claude`, `codex`, `opencode` or `custom`
(with `TOTEX_TEST_ACP_COMMAND` and `TOTEX_TEST_ACP_ARGS`). The test lists the
agent's models through `monitor_models`, then observes a controlled transcript.
Choose a model available to the configured provider. This opt-in test uses the
agent's existing authentication and may consume credits. It creates its own
persistent service and terminal, prints a controlled task transcript, and
verifies the real model's observation. It never attaches to existing terminal
sessions. Results are saved under `test-results/live-monitor`.
Unlike the desktop fixture, model inference is nondeterministic: an agent may
return unknown for the synthetic transcript, causing the content assertions to
fail even when the agent completes successfully. This is an integration probe,
not a deterministic CI check. SSH, WSL and PowerShell need separate host tests.
