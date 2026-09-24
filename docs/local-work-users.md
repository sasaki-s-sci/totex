# Local work users

## Ownership

The user who opens totex owns the application settings. A Windows installation
stores work-user registrations and folder rules in that Windows user's
`%USERPROFILE%\.totex\totex.json`, even when a pane is working inside WSL.
Repository settings never grant access to another OS account or choose an account
on behalf of the host user.

A work user identifies an execution environment, not an AI service account:

- Windows: machine and account SID. The display name may change without changing
  the identity. Support local accounts first; domain and Microsoft accounts need
  explicit authentication testing before being advertised.
- WSL: distribution and Linux user ID, with the current username for launching.
  A user in one distribution is distinct from a user with the same name in another.

Codex and Claude Code run under that user's ordinary home, configuration and
credentials. Authentication is completed separately in each work environment.

## Settings and first use

Add a **Work users** section to Settings. It shows the host account that owns the
configuration, registered work users, readiness, and default assignments.

The Add flow is:

1. Choose **Windows** or an installed **WSL distribution**.
2. Select an existing account or choose **Create a user**.
3. Complete platform-specific setup. Explain the account being created and the
   changes before invoking an OS account-management operation.
4. Start a process as that user and verify its actual identity and home.
5. Check Git, the login shell, Codex, and Claude Code. Missing optional agents
   do not prevent registration; offer a setup terminal under the selected user.
6. Choose a starting folder and optionally assign defaults to a drive or
   distribution. Show a final summary and save the registration.

Windows account creation uses Windows account-management UI or a narrowly scoped
elevated setup operation. Authentication uses native credential UI. Passwords
must not enter the settings JSON, logs, command arguments, or frontend state.
Cancellation returns to the setup form without creating a ready registration.

WSL uses `wsl.exe --distribution <name> --user <name>`. Setup may launch an
explicit root operation to create a user; ordinary work always launches as the
selected user. Do not change the distribution's system-wide default user.

Distinguish **Needs setup**, **Ready**, **Needs authentication**, and **Unavailable**.
Show failures with a recovery action: retry authentication, select a missing
distribution, repair a missing helper, or open setup. Never silently fall back
to the host account.

Removing a registration removes totex's association only. It must not delete an
OS account, a home directory, repositories, or agent credentials.

## Opening and assigning folders

The + menu selects a location, a work user, and a folder. Browse and validate the
folder as the selected user, including expansion of that user's home directory.
Show only users applicable to that execution environment.

Resolution order is:

1. An explicit assignment on the repository or folder.
2. The closest assigned ancestor folder.
3. The drive or distribution default.
4. The applicable application default (otherwise the current/default OS user).

Rules are scoped to a machine/distribution. Match path components, not string
prefixes; apply Windows case-insensitivity only to Windows paths. A Windows drive
opened natively and the same drive mounted inside WSL are different environments.

Each sidebar pane and terminal shows the effective account. An inherited choice
names the rule it comes from. A repository can override its parent through its
menu. Changing an assignment offers to reopen under the new user; existing
terminals retain their original identity and are never relabeled as the new user.
File ownership and ACLs are never changed merely by assigning a work user.

## Execution boundary

The UI stays in the host session. Files, Git, watches, worktrees, tasks, and PTYs
run in the selected execution environment. Switching only the terminal is not
sufficient.

For Windows, start a worker under the target account with its user profile and
environment loaded. Keep the worker unprivileged. Authenticate local IPC and
restrict it to the initiating host account and intended worker. A disconnected
worker must stop accepting requests until authenticated again. Check that the
installed worker executable is accessible to the target account without granting
access to the host user's home.

For WSL, extend both the existing shell channel and PTY launch with an explicit
user. Pool channels by distribution **and user**, not by distribution alone.
Do not fall back to accessing the WSL share as the default user when a selected
user cannot access a file.

Represent a location as `(execution identity, native path)`. Include that identity
in pane, repository, worktree, watch, task, terminal, cache and restored-session
keys. Never resolve a running session through mutable default rules.

The host UI can see every environment it is authorized to open. Agent tools and
MCP access must stay scoped to the agent's execution identity; access to a shared
UI must not grant an agent access to other users' panes or terminal output.
Cross-user copy is an explicit user action, not an implicit background operation.

This separates working identities and ordinary filesystem access. It is not a
VM-level isolation guarantee. In particular, the Windows account owning WSL can
launch its distributions as root, and WSL Windows interoperability can expose
that authority to Linux processes. Stronger isolation requires separately
considering interoperability, mounts, privileges, and VM boundaries.

## Acceptance checks

- Both Windows and WSL registrations are managed in the host user's settings.
- Setup cancellation and invalid credentials leave no usable registration or
  stored plaintext password.
- Actual process identity and home match the selected user for filesystem, Git,
  tasks, and terminal operations.
- Two users opening the same native path have separate sessions and caches.
- Private-home permission failures never trigger a host-user fallback.
- Folder-rule inheritance is component-aware and scoped to the execution target.
- Changing defaults does not change the identity of an already-running session.
- Restart requires authentication where appropriate and restores each pane's
  identity without attaching to another user's existing session.
- Agent-facing integrations cannot enumerate or operate on another work user's
  sessions through shared application state.
- Validate Windows credentials/profile/ConPTY on real Windows, and WSL user
  selection on real WSL; Linux unit tests alone cannot establish these behaviors.

## Existing integration points

- Host settings: `src-tauri/src/app_settings.rs`, `src/lib/appSettingsModel.ts`,
  `src/settings/SettingsContent.tsx`.
- Opening and persisted panes: `src/sidebar/left/RootsMenu.tsx`,
  `src/sidebar/left/usePanes.ts`, `src/lib/graphed.ts`.
- Files and Git execution: `src-tauri/host/src/host/`.
- WSL process launch and pooled channels: `src-tauri/host/src/wsl/shell.rs`,
  `src-tauri/host/src/remote/mod.rs`.
- PTY launch and routing: `src-tauri/persistent/src/session/spawn.rs`,
  `src-tauri/src/pty.rs`.

## Platform references

- [WSL user selection](https://learn.microsoft.com/en-us/windows/wsl/basic-commands#run-a-specific-linux-distribution-from-powershell-or-cmd)
- [Windows process creation with logon](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-createprocesswithlogonw)
