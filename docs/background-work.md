# Background work

Status: design, nothing built yet. Sources checked 2026-10-05.

A coding agent in a terminal leaves work running after its turn ends:
background shells, monitors, background subagents. Today the window cannot see
any of it. It sees the screen (`doing`, the question being asked, the last line
typed) and the `report` an agent chooses to send. This document designs one
normalized view of that background work. The view is served over MCP and drawn
on the canvas and in the sidebar.

## Shape

```
 agent adapters ──► background registry (persistent half) ──► MCP tools
 (hooks / app-server / SSE)        │                              ├─ own scope: a terminal's door
                                   │                              └─ all scope: a dedicated terminal
                                   └──► window events ──► chip beside the terminal, sidebar badge
```

- **Ingest**: one thin adapter per agent, using the mechanism that agent itself
  recommends. No single package covers all three agents (see
  [Abstraction layers](#abstraction-layers)).
- **Hold**: a registry beside the door's reports in the persistent half. Like
  a report, a task cannot be worked out again from output, so it lives as long
  as its session and no longer.
- **Serve**: the same tools in two scopes. A terminal reaches its own tasks
  through the door it already has. A dedicated terminal reaches every terminal's
  tasks through a separate server, the way the overseer does.
- **Draw**: the window subscribes to changes and draws counts. It never asks an
  agent anything itself.

## Task model

The vocabulary follows the JetBrains AIR `asyncTasks` extension of the Agent
Client Protocol. If the agents later become reachable over ACP, its updates can
then map onto this model one to one.

```ts
type BackgroundTask = {
  session: string;          // the totex terminal
  id: string;               // the agent's own id: backgroundTaskId, taskId, agentId, processId…
  agent: "claude" | "codex" | "opencode";
  kind: "shell" | "monitor" | "subagent" | "workflow" | "other";
  title: string;            // the command, or the description
  state: "running" | "completed" | "failed" | "stopped";
  inferred: boolean;        // the end state was concluded, not reported
  startedAt: number;        // ms
  endedAt?: number;
  exitCode?: number;
  output?: string;          // a file path or a resource the tail can be read from
};
```

`inferred` is true when a task was last seen running and is then missing from a
later full snapshot. For Claude shells and monitors this is the only way their
end is ever known. The UI has to say "ended", not "completed".

## Ingest, per agent

### Claude Code: HTTP hooks, shipped as a plugin

A terminal that is already running is only reachable through hooks. The hooks
are `type: "http"`: each one posts its event to the session's door. The header
`Authorization: Bearer $TOTEX_MCP_TOKEN` is filled in with `allowedEnvVars`, so
each terminal posts as itself with no per-terminal configuration.

| Event | Matcher | What it gives |
|---|---|---|
| `PostToolUse` | `Bash\|PowerShell` | start, when `tool_input.run_in_background` is set or the result says it was backgrounded (`backgroundTaskId`, `backgroundedByUser`, `timedOutAfterMs`) |
| `PostToolUse` | `Monitor` | start: `taskId`, `timeoutMs`, `persistent` |
| `PostToolUse` | `Agent` | start, when `status` is `async_launched`: `agentId`, `description`, `outputFile` |
| `SubagentStart` / `SubagentStop` | | subagent start and end, `stop_reason` (`completed`/`stopped_by_user`/`error`/`timeout`), `error_message` |
| `Stop`, `SubagentStop` | | `background_tasks[]`, the full set still in flight: `{id, type, status, description, command?, agent_type?, server?, tool?, name?}` |

Gaps:

- No hook fires when a shell or a monitor ends. There is also no exit code or
  end time for them. Their end is concluded from the next `background_tasks`
  snapshot, so it is `inferred`.
- A full lifecycle with exit codes exists only through the Agent SDK stream
  (`task_started` / `task_updated` / `task_notification` /
  `background_tasks_changed`). That stream needs Claude launched through the
  SDK, which means giving up the TUI. Out of scope.

How the hooks get installed: as a Claude Code plugin with `hooks/hooks.json`,
installed by running Claude's own plugin command. This keeps to the rule in
`door/install.rs`: run the agent's command, never edit its config files.

### Codex: the app-server, with the TUI as a second client

The recommended interface for embedding Codex is `codex app-server`, and it can
sit behind the normal TUI:

1. totex starts `codex app-server --listen unix://<socket>`.
2. The terminal runs `codex --remote unix://<socket>`.
3. totex connects as a second client and calls `thread/resume` to subscribe.

| Source | What it gives |
|---|---|
| `item/started`, `item/completed` with a `commandExecution` item | `id, command, cwd, processId, source, status (inProgress/completed/failed/declined), exitCode, durationMs` |
| `item/commandExecution/outputDelta` | output as it streams |
| `thread/backgroundTerminals/list` | the live set: `processId, command, cwd, osPid, cpuPercent, rssKb` (experimental, `capabilities.experimentalApi`) |
| `collabAgentToolCall`, `subAgentActivity` | subagents |

Of the three agents, this gives the fullest data: real exit codes and real end
times. The cost is that a Codex terminal has to be started by totex in
`--remote` mode. A Codex started by hand in a plain shell is not seen.

Codex hooks (`PreToolUse`/`PostToolUse` on `Bash`, `SubagentStart`/`Stop`) are
the fallback for such a hand-started Codex. They carry coarse start and end
only, with no background-terminal identity.

Still to check: two live clients on one thread. The documentation implies
several subscribers per thread, but this has not been tested.

### opencode: the TUI's own server

`opencode --port <n>` keeps the TUI and also serves `GET /event` (SSE).

| Event | What it gives |
|---|---|
| `message.part.updated` with tool parts | `state` (`pending/running/completed/error`), `time.start/end`, `title`, `output` |
| child sessions of a `task` call with `background: true` | background subagents |

opencode has no background shells yet: its `bash.ts` has a TODO to bring them
back. Its `BackgroundJob` registry exists internally but is not exposed. Only
subagents are shown until that changes.

### Agents with no adapter

The door's `report` tool gains an optional `background` list. An agent may
declare its background work there itself. Anything an adapter reports takes
precedence over what the agent declares.

## Serve: one set of tools, two scopes

The tools are the same in both scopes. Only the token decides which terminals
they can see.

| Tool | Own scope (a terminal's door) | All scope (the dedicated server) |
|---|---|---|
| `background` | this terminal's tasks | every terminal's, or one terminal's with `terminal` |
| `background_output` | the tail of one task's output, `rows` optional | same, needs `terminal` |
| `wait` | blocks until this terminal's tasks change after `since` | the same for every terminal (the overseer's journal) |

The two scopes:

- **From any terminal.** An agent already holds its own door (`TOTEX_MCP_URL` /
  `TOTEX_MCP_TOKEN`), so it can ask about its own background work without
  further setup. Nothing in it can reach another terminal.
- **From a dedicated terminal.** The overseer's server (`overseer::rpc`) gains
  the all-scope tools beside `terminals`/`screen`/`describe`. Whatever runs in
  that terminal can use them:
  - the overseer agent, which then folds background work into its line;
  - a watcher agent started just for this;
  - a small MCP client printing a live table.

  This scope follows the overseer's rules: it can read, but it cannot type and
  cannot stop anything.

Stopping a task is left out in both scopes, for the reason the overseer gives:
a line is a thing the person may ignore, and a keystroke is not.

## Draw

- **Chip beside a terminal on the canvas**: counts by kind, e.g. `shell 2 ·
  monitor 1 · agent 1`, and nothing when nothing is running. Clicking it opens a
  list of title, kind, elapsed time and state, with the exit code where one is
  known. A task that just ended stays in the list for a short while, marked
  completed, failed or ended.
- **Badge in the sidebar's terminal list**: the number of running tasks.

The window reads tasks the way it already reads reports:

- a `background:changed` event carrying `{session, tasks}`;
- a `background_now` command for a window coming up.

## Abstraction layers

None of these can watch an agent that is already running in a terminal. Each
one launches the agent itself.

| Layer | Watches an existing terminal? | Background work |
|---|---|---|
| ACP (agentclientprotocol.com, Apache-2.0) | no, it launches the agent over stdio | none in the core protocol; out-of-turn updates are an open RFD |
| claude-agent-acp (on the Agent SDK) | no | through the AIR `asyncTasks` extension |
| codex-acp (wraps the app-server) | no | AIR background terminals |
| opencode `acp` | no | not mapped |
| coder/agentapi | it scrapes its own PTY | archived, nothing |

So no OSS package is taken on now. The model borrows the AIR vocabulary, so an
ACP path can be added later for terminals that totex launches itself.

## Order of work

1. Registry and window events, with tests built on fake events.
2. Claude HTTP hooks and the plugin that installs them. Claude is what totex is
   mostly run with.
3. The own-scope tools on the door, and `background` on `report`.
4. Chip and badge.
5. The all-scope tools on the overseer's server.
6. Codex through `--remote`.
7. opencode through `--port`.
