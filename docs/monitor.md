# Monitor

Monitor is an optional observer for terminal sessions. Configure its ACP
executable, argument array, model ID and interval in **Settings → Monitor**.
The executable must speak ACP over stdio and be installed on the terminal's
host. An empty model uses the agent's default; a named model requires the
agent's ACP model configuration support.

Status, agents, current task, user request, time estimate and goal are separate
features. Switching a feature off removes its prompt instructions and MCP
tools as well as its displayed fields. Monitor is disabled by default. Time
estimates are also disabled by default.

## Protocol and environment

The persistent runtime uses the
[agent-client-protocol Rust SDK](https://docs.rs/agent-client-protocol/3.3.0/agent_client_protocol/)
with stable ACP v1 initialization, session creation, configuration and prompts.
A standard stdio MCP server supplies the terminal snapshot and the enabled
report tools. It needs Python 3 on the same host (`python3` on Unix, SSH and
WSL; `python` on Windows). No global agent configuration is edited.

The observer starts in a private directory under
`~/.local/share/totex/monitor` on Unix or `%LOCALAPPDATA%/totex/monitor` on
Windows. SSH and WSL terminal paths select their corresponding remote host;
their observer and MCP process run there. Paths and executable arguments are
quoted independently. The observed project's directory is not the observer's
working directory.

The environment is the host used to open the terminal in totex. Manually
entering another SSH/WSL shell inside an existing terminal is not a host
change known to totex. Linux detects these descendant processes and reports
an environment error; other platforms do not currently detect arbitrary
nested remote shells. Open the remote folder as a totex terminal to select
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
replace current observations. MCP exposes snapshot/report operations rather
than a command execution tool.

This adds persistent-runtime commands, so installation requires a full runtime
update, not a frontend-only refresh. Release planning classifies the change as
a minor release under the repository's existing update policy.

## Desktop and live-agent tests

`task test:e2e` builds the desktop app and persistent sidecar, then drives the
actual Linux WebView through WebDriver. It records video, screenshots and an
HTML report under `test-results/e2e`. Monitor checks use a deterministic ACP
process that launches the production MCP server; the UI, settings persistence,
PTY and observer runtime are real. The suite checks summaries, goal, worker
progress, feature-specific tools/prompts, cancellation and startup failures.
It does not require a provider account.

For an installed agent and real model, run the optional test after building:

```sh
TOTEX_TEST_ACP_COMMAND=opencode \
TOTEX_TEST_ACP_ARGS='["acp","--pure"]' \
TOTEX_TEST_ACP_MODEL=opencode/gpt-5.4-mini \
node tests/e2e/live-monitor.mjs
```

Choose a model available to the configured provider. This opt-in test uses the
agent's existing authentication and may consume credits. It creates its own
persistent service and terminal, prints a controlled task transcript, and
verifies the real model's observation. It never attaches to existing terminal
sessions. Results are saved under `test-results/live-monitor`.
Unlike the desktop fixture, model inference is nondeterministic: an agent may
return unknown for the synthetic transcript, causing the content assertions to
fail even when ACP and MCP complete successfully. This is an integration probe,
not a deterministic CI check. SSH, WSL and PowerShell need separate host tests.
