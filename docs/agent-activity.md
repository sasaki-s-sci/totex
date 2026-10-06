# Agent activity

The persistent runtime automatically observes agents under each local terminal's
shell process. No hooks, plugins, MCP registration, or configuration edits are
needed for activity detection. The existing MCP report feature is separate.

The process provider currently supports Linux. Other platforms, SSH and WSL
terminals keep the screen detector. An unavailable API, an older CLI without the
required command, or an ambiguous process/session mapping also falls back to the
screen detector.

| Agent | Read-only interface | Terminal ownership |
|---|---|---|
| Claude Code | `claude agents --json` | The reported live PID must be a Claude process under the terminal. Each process's configuration home is queried separately. |
| Codex | Existing daemon through `codex app-server proxy --sock`, `initialize`, and `thread/read` with `includeTurns: false` | An exact thread UUID from `resume`, an open rollout filename, or a direct tool child's environment. The UUID is cached while the CLI PID remains live. |
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
monitor never starts a daemon, resumes a thread, reads conversation transcripts,
or responds to approval requests.

References: [Claude agent view](https://code.claude.com/docs/en/agent-view#list-sessions-as-json),
[Codex App Server](https://learn.chatgpt.com/docs/app-server),
[OpenCode server](https://opencode.ai/docs/server/).
