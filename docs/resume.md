# Resume

totex keeps a record of the jobs it started itself and can run one again
after its terminal is lost. A job is one of two things:

- A coding agent (Claude Code, Codex or OpenCode) started from the task menu
  (Ctrl+Alt+A). Its start command is set in **Settings → Resume**.
- A command the space keeps that has a `# resume:` line above it:

  ```sh
  # watch the docs
  # resume: update=auto crash=ask close=ask within=600 guard=git
  my_cli watch docs
  ```

totex does not record lines typed by hand. A terminal cannot report what is
running in it (see `src-tauri/src/ask/doing.rs`), so totex records only the
lines it typed itself.

## Being lost, and what happens next

| Lost to | Marked by | Default |
| --- | --- | --- |
| `update` | a program update, just before the restart (`holdForRestart`) | `auto` |
| `crash` | a shell ending under a running job without being marked first | `ask` |
| `close` | closing the terminal from the window | `ask` |

- `auto` runs the job again by itself.
- `ask` shows an offer over the restored terminal with **Resume** and
  **Dismiss**. A closed terminal is offered as a `resume` row at the top of
  the task menu instead.
- `off` lets the job go.

A job that returns to its prompt has ended. totex then stops tracking it and
never runs it again. A patch update leaves terminals running, so a job that
is found still running was never lost.

An `auto` is downgraded to `ask` whenever something is in doubt:

- **stale**: the job was last seen running more than `within` seconds ago.
- **changed**: the guard's fingerprint differs from the one taken while the
  job ran. `git` hashes HEAD, `status --porcelain` and `diff HEAD`.
  `guard=cmd:<line>` hashes that line's output and exit code; it must come
  last on the `# resume:` line. `none` skips the check.
- **unchecked**: the guard could not be run.

A closed terminal is offered only for `within` seconds. A job whose directory
no longer exists is dropped.

## Agents

| Agent | How the conversation is known | Resumed with |
| --- | --- | --- |
| Claude Code | totex passes `--session-id <uuid>` at launch | `claude <options> --resume <id>` |
| Codex | totex finds the `~/.codex/sessions` rollout whose `cwd` and time match (`resume_codex_sessions`) | `codex resume <options> <id>`, or `--last` if none was found |
| OpenCode | `-s/--session` when it was given | `opencode <options> --session <id>`, or `--continue` |

The resumed line keeps the options the agent was started with and drops the
prompt it was started with. If the agent was mid-turn when it was lost (it
was showing `esc to interrupt`), the configured prompt is added so the turn
picks up again.

## Where it lives

Jobs are kept in the service's store as the `totex.resume` document
(`keep/store/totex.resume.json`). That store is on disk and survives a
replaced service. The window front owns all of this
(`src/resume/`, `src-tauri/src/resume/`). Nothing in `src-tauri/persistent`
or the host crate changed, so the feature ships as a patch release.
