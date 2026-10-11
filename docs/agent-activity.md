# Agent activity

The persistent runtime automatically observes agents under each local terminal's
shell process. No hooks, plugins, MCP registration, or configuration edits are
needed for activity detection. The existing MCP report feature is separate.

The process provider supports local terminals on Linux and, from a Windows
build, terminals inside WSL distributions. Local Windows terminals, macOS and SSH
terminals keep the screen detector. An unavailable API, an older CLI without the
required command, or an ambiguous process/session mapping also falls back to the
screen detector.

### WSL terminals

A Windows process cannot see a distribution's Linux PIDs, so every terminal opened
in a distribution is started with `TOTEX_TERMINAL=<terminal id>` in its environment, carried into the
distribution through `WSLENV`. Each snapshot runs one short `wsl.exe` command
per distribution with WSL terminals; it reads `/proc` inside the distribution
and returns the processes carrying a marker, their command lines, adapter
environment variables, working directories, open files and loopback listeners.
It uses GNU `grep -z` and `find -printf`, which standard distributions provide;
when they are missing the snapshot fails and the screen detector stays in
charge. Processes are assigned to terminals by the marker alone.

- Claude Code: `claude agents --json` runs inside the distribution, through
  `wsl.exe`, with the Claude process's own `PATH`, `HOME` and
  `CLAUDE_CONFIG_DIR`.
- OpenCode: its HTTP server is reached on the shared loopback, which requires
  mirrored networking.
- Codex: its daemon socket is a Unix socket inside the distribution that a
  Windows process cannot connect to, so Codex in WSL stays on screen detection.

Terminals opened before this version have no marker and stay on screen
detection until they are reopened.

| Agent | Read-only interface | Terminal ownership |
|---|---|---|
| Claude Code | `claude agents --json` | The reported live PID must be a Claude process under the terminal. Each process's configuration home is queried separately. |
| Codex | Direct WebSocket connection over the existing daemon Unix socket, `initialize`, and `thread/read` with `includeTurns: false` | An exact thread UUID from `resume`, an open rollout filename, or a direct tool child's environment. The UUID is cached while the CLI PID remains live. |
| OpenCode | Existing HTTP server: `/global/health`, `/session`, `/session/status`, `/permission`, `/question` | A listening socket owned by the terminal's OpenCode process tree. Shared local attach endpoints require an explicit or unambiguous session. |

The worker waits 750 ms between snapshots. CLI and HTTP requests have deadlines
and response size limits. Only changed states cross the persistent connection.
API work states drive the existing animation; idle agents and approval/input
waits stop it. Redraws and resize events preserve the last API state. When an API
stops providing a usable result or its process exits, the runtime clears that
state and the screen detector takes over.

Codex's daemon API does not expose a mapping from a TUI process to its thread.
A fresh daemon-backed session may therefore stay on screen detection, especially
before an exact UUID is visible. Working-directory equality is deliberately
insufficient: two terminals can run different agents in the same directory. The
monitor never starts a daemon, resumes a thread, reads private transcript files,
or responds to approval requests.

References: [Claude agent view](https://code.claude.com/docs/en/agent-view#list-sessions-as-json),
[Codex App Server](https://learn.chatgpt.com/docs/app-server),
[OpenCode server](https://opencode.ai/docs/server/).

Codex monitoring does not spawn a CLI or use stdin/stdout as a transport. It
performs the official HTTP Upgrade handshake on the existing Unix socket and
sends JSON-RPC as WebSocket text frames. Claude's JSON command is a one-shot
supported status query, not a stdio protocol session; OpenCode uses HTTP GETs.
API state changes wake the existing overseer through its journal. A transition
out of working does not prove a successful turn completion: permission waits,
questions, and interruptions can also stop work. Structured replies now carry
an explicit turn outcome. Codex reads the latest
turn using `thread/turns/list` (`limit: 1`, `itemsView: full`), with a bounded
`thread/read` fallback on older daemons. Only final `agentMessage` text is kept;
reasoning and tool output are excluded. OpenCode reads recent messages and
requires the latest user's matching assistant, completion time and final
`finish: stop`; `tool-calls` never counts as a reply completion. A missing or
ambiguous session is not assigned a reply by directory or screen text.
If Codex runtime metadata reports an active turn before its history is updated,
the previous reply is cleared and marked in progress with an unknown turn ID.
OpenCode compaction summaries are never displayed as final replies.

Start or stop monitoring in Settings → Terminal → Agent monitoring. There is
one checkbox per environment: this machine, and on Windows each WSL
distribution. Each checked environment runs its own overseer inside that
environment, and each overseer sees, waits on and describes only the terminals
of its own environment; nothing crosses between them. Terminals that are not in
a distribution, SSH included, belong to this machine. Each overseer has its own
MCP listener and token, so which terminals it is answered about is decided by
the address it was given, not by anything it says.

A WSL overseer uses that distribution's Claude installation and login. Its private
working directory is `~/.local/share/totex/windows-overseer` inside WSL, and the
terminal is opened through `wsl.exe`. Windows does not need Claude installed for
this mode. The distribution must use mirrored networking so it can
reach the app's loopback MCP listener. Configure `[wsl2]` with
`networkingMode=mirrored` in `%UserProfile%/.wslconfig`, then restart WSL before
starting monitoring. See [Microsoft's networking documentation](https://learn.microsoft.com/en-us/windows/wsl/networking#mirrored-mode-networking).
Starting a WSL overseer installs the `totex-replies` plugin (below) into
that distribution's Claude Code. Its files are written to
`~/.local/share/totex/claude-replies` inside the distribution, and its hooks
call the app's loopback listener over mirrored networking. Replies from WSL
sessions are mapped to terminals the same way as local ones, through the Linux
PID that `claude agents --json` reports inside the distribution.

Starting launches Claude Code in a dedicated overseer terminal; Claude Code must
be installed and signed in. The overseer waits on the journal of API activity,
questions, and reports, reads the changed terminal, and updates its status line.
Stopping closes only that overseer terminal and clears its lines; the other
environments' overseers keep running. The status adapters continue to run. The
app restores existing overseers after reopening its window, but does not launch
a new one automatically. A window kept by an earlier version with a single
overseer is read back as that overseer's environment.

Starting monitoring on this machine also installs the local `totex-replies` Claude plugin using
Claude's official plugin CLI. Its authenticated HTTP `UserPromptSubmit`, `Stop`,
and `StopFailure` hooks supply the lifecycle and `last_assistant_message`, without
reading transcript files. Existing Claude sessions must restart to load the
plugin. Hook session UUIDs are mapped to terminals only through a live Claude PID
reported by `claude agents --json`. Nested agents do not overwrite the parent.

Replies cross the existing report connection and remain available when the
window reconnects. The card shows the reply outcome and a preview immediately,
with the retained original available in a dialog. The overseer receives the
structured reply in `terminals` and must supply `report.reply.key` as `replyKey`
when describing it. A stale summary is rejected and cannot replace a newer
reply. Repeated unchanged snapshots do not emit report events. The retained
body is bounded at 128 KiB on a UTF-8 boundary; any truncation is explicit.
