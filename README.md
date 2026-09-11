# totex

A window onto a git repository: its commits, the worktrees standing on them,
and the terminals those worktrees are worked in.

## Install

There are two installers and the difference between them is versions, not
platforms.

The **per-version installer** is cut with a release and holds that release: one
per platform on every release page, and the newest one is what the two lines
below fetch. The **version-selectable installer** holds no release at all — it
is a window that asks which totex to put on the machine and then puts it there,
so the copy downloaded once installs whatever is newest a year from now. It is
Windows only, and it is the last thing in this section.

Both of them install. Neither downloads the other.

**macOS and Linux**

```sh
curl -fsSL https://github.com/sasaki-s-sci/totex/releases/latest/download/install.sh | sh
```

**Windows**

```powershell
irm https://github.com/sasaki-s-sci/totex/releases/latest/download/install.ps1 | iex
```

One installer, not one per release: which version it puts on is decided by the
release page it reads, so the same two lines install whatever is newest today
and whatever is newest a year from now.

An older release is asked for by name — and a script being read down a pipe has
to be handed what it takes, which is the whole of what `-s --` and the script
block below are for:

```sh
curl -fsSL https://github.com/sasaki-s-sci/totex/releases/latest/download/install.sh | sh -s -- --version 0.1.2
```

```powershell
& ([scriptblock]::Create((irm https://github.com/sasaki-s-sci/totex/releases/latest/download/install.ps1))) -Version 0.1.2
```

`--help` / `-Help` lists the rest of what they take.

**Or take the per-version installer yourself.** Every release page carries them
as well, for anybody who would rather click than paste. Not one of their names
holds a version, which is what makes each link below one worth keeping: it is
the newest release today and the newest release a year from now, exactly as the
two lines above it are.

| Platform | Download |
| --- | --- |
| Windows | [`-setup.exe`](https://github.com/sasaki-s-sci/totex/releases/latest/download/totex-windows-x86_64-setup.exe), or the [`.msi`](https://github.com/sasaki-s-sci/totex/releases/latest/download/totex-windows-x86_64.msi) |
| macOS | [`.dmg`](https://github.com/sasaki-s-sci/totex/releases/latest/download/totex-macos-universal.dmg) — Intel and Apple Silicon in the one file |
| Linux | [`.AppImage`](https://github.com/sasaki-s-sci/totex/releases/latest/download/totex-linux-x86_64.AppImage), [`.deb`](https://github.com/sasaki-s-sci/totex/releases/latest/download/totex-linux-x86_64.deb) or [`.rpm`](https://github.com/sasaki-s-sci/totex/releases/latest/download/totex-linux-x86_64.rpm) |

An older release is the same address with `latest` swapped for the tag it was
cut under, which is what `--version` is on the scripts. Releases cut before
these names existed carry the version in theirs instead, and their own page is
what has them.

**The version-selectable installer — Windows, with the version asked for and
nothing typed.** It is on no release page because it holds no release: it is a
window that asks which totex to put on the machine — the newest, or any version
by name — and then installs it. It reads the release page, downloads the
program of that release, checks it against the key totex is released with,
writes it where the app goes, makes the shortcuts and puts the line in
Add/Remove Programs. The same values the per-version installer writes, so the
two are alternatives rather than a stack: a copy put on by one is a copy the
other recognises, and the app updating itself finds an install it knows.

[`totex-setup.exe`](https://github.com/sasaki-s-sci/totex/releases/download/setup/totex-setup.exe)

That address holds still for a different reason than the ones above it. Those
are whatever the newest release comes to be; this is not a release of totex at
all. It is published on a cycle of its own, under a tag of its own, so it moves
when the installer moves rather than when the app does — which is what makes
the copy downloaded today the one to keep.

It asks one thing, whether there is a desktop shortcut, and the app goes in the
folder the per-version installer would have put it in. A release cut before its
program was published beside its installers is the one thing it cannot install
itself; it says so and runs that release's own installer instead.

Of the per-version installers, `-setup.exe` asks two things, where the app goes
and whether there is a desktop shortcut, and opens totex once it has done it.
The `.msi` asks nothing, installs for every account on the machine, and wants
administrator to do that. The `.dmg` is the drag onto Applications. An
`.AppImage` is one file: make it executable and run it. A `.deb` or an `.rpm`
is the package manager's, which is also who brings it forward afterwards.

What is given up by clicking a file off a release page is the check. The
scripts turn down anything not signed with the key totex is released with; a
browser carries no such key, so a download is worth what the page it came from
is worth. `totex-setup.exe` is the exception, and the reason it exists: it
carries the key and makes the same check, without a verifier having to be
installed first to make it. None of them are code-signed, and both platforms
say so before they will open one: macOS holds a downloaded app in quarantine
until it is let out of it — `xattr -dr com.apple.quarantine
/Applications/totex.app` — and Windows SmartScreen calls it an unknown
publisher, which is More info, then Run anyway.

`latest.json`, `totex-macos-universal.app.tar.gz` and `front.tar.gz` sit
beside them and are not downloads at all: they are what an installed copy
updates itself from. `totex-windows-x86_64.exe` is the app
itself, out of its installer — what the version-selectable installer writes
where the app goes, and the one file on the page that installs nothing if it is
double-clicked, because it is not an installer. It is totex.

## Development setup and commit checks

Run `task setup` to install the tools pinned in `mise.toml`, install the locked
npm dependencies and enable this repository's Git hooks. This requires mise,
Python 3.11 or newer, and the platform's normal Tauri build prerequisites.
For an already provisioned checkout, `task hooks:install` enables just the hooks.
It sets the repository-local `core.hooksPath` to `.githooks`, replacing any
previous hook directory setting for this repository.

Commits and automatic merge commits run `task precommit` through mise: staged
whitespace checks followed by `task check` (formatting, lint, type checking,
release policy and frontend/Rust tests). A failure stops the commit without
auto-fixing or staging files. You can also run `task precommit` yourself.
The full suite checks the working tree, so stage the intended fixes before
retrying a commit. Fast-forward merges do not create commits or run these hooks.
Desktop E2E and the separate Windows installer checks remain explicit tasks.

## Desktop E2E tests and recordings

On Linux, `task test:e2e` builds the app and its persistent sidecar, then drives
the real WebKit window using WebdriverIO and `tauri-driver`. Xvfb provides a
private virtual display and FFmpeg records it. No monitor or Tauri API mocks
are needed. Install the app's normal build prerequisites first, then:

```sh
sudo apt-get install xvfb ffmpeg webkit2gtk-driver
cargo install tauri-driver --version 2.0.6 --locked
pnpm install --frozen-lockfile
task test:e2e
```

Open the `test-results/e2e/<timestamp>/index.html` path printed at the end.
It contains a playable MP4, step links that seek within the video, screenshots,
and links to logs and a JSON result. Successful and failed runs both retain
artifacts; missing or invalid video makes the run fail too. To rerun an already
built app, use `task test:e2e:run` (or `pnpm test:e2e`). Rebuild after source changes.

The smoke scenario opens a temporary repository through the sidebar, displays
its graph, opens a real PTY, types a file creation and Git commit command, checks
the resulting file and commit independently with Git, verifies a new branch
appears through the app's watcher, and opens the saved file in its preview.
App settings and persistent state use a private temporary user directory.
This covers the Linux UI/IPC/Rust/Git/PTY path; it does not yet cover every
feature, native OS dialogs, or Windows/macOS behavior. E2E is separate from
`task check` because it requires a display server and recording tools.

The **Desktop E2E** GitHub Actions workflow runs on pull requests or manual
dispatch and uploads the report directory even when the test fails. Download
and extract its artifact, then open `index.html` to review the video locally.

## Settings and file panels

The gear opens `~/.totex/totex.json` as a settings form in the same panel used
for files, with pin, fit-width, fold, and close controls. Pressing the gear
centers the panel again unless it is pinned. The code button switches between
the form and editable JSON; Ctrl/Cmd+S saves the JSON.

A pinned file card dragged out past the edge of the window keeps going: it
opens in a small window of its own under the pointer, at the size it was pinned
at, and carries its unsaved edits with it. Dragged back and let go over the
canvas, in the same drag or a later one, the window closes and the card is
pinned where it landed; the pin on its header brings it back too. Card windows
close with the window they came off.

Form changes save to this file automatically. On first use, when the file does
not exist, existing preferences are migrated into it. An existing file takes
precedence; omitted settings use defaults, and form edits preserve unknown
JSON fields. External edits are reread when the window regains focus or the
gear is pressed. Invalid JSON and conflicting raw edits are refused without
discarding the draft.

**File title** selects the file name or full path for every panel header. For
example, this partial configuration selects full paths and the smallest line
size:

```json
{
  "fileTitle": "path",
  "said": { "size": 1 }
}
```

Other preferences in this document include `theme`, `language`, `reveal`,
`follow`, `mcpServing`, `readingSize`, `cliWheel`, `graphWheel` (how far one
notch of the wheel scrolls a terminal or zooms the canvas, as a percentage),
and the remaining `said` options. The
repository-specific `.totex/settings.json` continues to control each space.

## Updating

Settings exposes two update boundaries:

| Layer | Owns | Applying an update |
| --- | --- | --- |
| **persistent** | Thin browser shell, native window host and CLI service | Installs the complete bundle and restarts totex. CLI sessions end. |
| **ephemeral** | Frontend code, React, hooks, rendering and styles | Prepares a new frontend in a child frame, transfers state and switches it into view. The native window and CLI processes stay alive. |

The outer shell document stays open throughout a frontend update. The old front
remains painted while its replacement loads and reconnects to running terminals;
input is temporarily paused during this handoff. A failed startup or native
confirmation keeps the old front. Once confirmed, the shell switches frames and
retires the old frontend and its native event subscriptions.

State transfer is explicit: open folders, selected terminal, workspace readings,
canvas viewport and history depth, file cards and unsaved file drafts are carried
across. Terminal emulators reconnect to the existing PTYs and replay retained
output. Arbitrary hook state, transient dialogs and media playback are not
implicitly preserved. New stateful features must define their handoff data.

JSX-expression and CSS-only updates keep the faster existing path: rendering slots
update inside the current frame without recreating React or xterm instances.
Changes to hooks, helpers or frontend dependencies can use the full-front path.

The shell identity is published as `front.runtime` in `latest.json` and `contract`
in the signed artifact's `ephemeral.json`. It covers shell and native code,
native dependencies, native configuration and the shell's Tauri API dependency.
A separate `viewsContract` covers stateful frontend code and chooses whether a
frame replacement is needed. Frontend-only changes do not change shell identity.
Compatibility is independent of patch/minor numbering.

**One persistent identity can support many ephemeral releases.** Settings lists
compatible releases, including older versions, and disables incompatible ones.
`latest` selects the newest compatible published release. Selecting another
persistent release previews its compatible ephemeral versions.
The listing currently covers the latest 30 published releases.

An ephemeral artifact is signature-checked and staged before use. The shell
validates its identity and prepares either replacement rendering expressions or
a complete frontend before confirming activation. Failed loads retain the old
view; interrupted activation restores the last committed selection at startup.
Old host assets remain available across successive swaps. `TOTEX_BUILT_IN_FRONT=1`
still provides recovery to the bundled views.

A persistent update clears the old ephemeral pin and overlay, installs the whole
bundle, then restarts totex. The new run uses the views and CLI service from that
bundle, including when updating within the same protocol line. A `.deb` or `.rpm`
leaves persistent installation to its package manager but can apply compatible
ephemeral releases in place.

The first installation of the thin shell requires a persistent update. Older
schema-1 artifacts cannot be loaded by the schema-2 shell.

For the design and acceptance checks, see [the update boundary](docs/update-boundary.md).

## Releasing from main

For CI timings, cache policy and build optimization decisions, see
[CI build performance](docs/ci-performance.md).

Every push to `main` runs **Build**: the checks and the Linux, macOS and Windows
builds. After it succeeds, **Release** compares main with the latest reachable
`vX.Y.Z` tag. The comparison covers all changes since that release, not just the
most recent commit, so several merges produce one release of their combined
changes when they arrive together.

| Change | Release |
| --- | --- |
| Window, frontend, app assets, app installers or window-only dependencies | Patch: `1.2.3` → `1.2.4` |
| Persistent program, shared `src-tauri/host`, persistent dependencies, Rust toolchain or shared build configuration | Minor: `1.2.3` → `1.3.0` |
| Developer milestone, requested with **Release → Run workflow → major** on main | Major: `1.2.3` → `2.0.0` |
| Documentation, standalone tests, release automation or the separate `setup/` installer | No app release |

These tag-numbering categories describe the release planner's historical artifact
areas, not the update boundary above. A patch may require a persistent update;
only the published shell identity determines whether the frontend can be swapped.
Service changes take precedence over window-only changes. The socket client,
`src-tauri/persistent/src/talk.rs`, is classified as window-only for tag numbering. Dependency comparisons
walk the locked graph for all platforms, including indirect dependencies;
development-only dependencies are excluded. Changes inside a production Rust
source file count even if they only edit an inline test. The policy lives in
`scripts/release.py`; shared build configuration, including `build.yml`, is
conservatively treated as persistent because it builds both programs. Markdown
shipped under source or asset directories is app content, not excluded documentation.
The policy is covered by temporary-repository tests in
`tests/test_release.py`. `task check` includes these tests and needs Python 3.11
or newer; CI installs Python 3.12.

Do not edit app version numbers manually. Release updates the four manifests
and both app package entries in Cargo.lock together, commits the result to main,
and pushes that commit and its annotated tag atomically. If main advanced in the
meantime, the push fails without publishing either ref. A release is cut only
from a main commit whose complete Build succeeded, and the tag is built and
checked again before its signed assets are published. Required Build checks in
main's branch protection should also gate merges; the workflow cannot prevent a
person with bypass permission from pushing broken code.

The version commit does not start another main build. Release explicitly
starts Build for the tag, and version-only changes do not request another
release. If a tag was created but its build or publication failed, rerun Build
on that tag, or run Release in `auto` mode: it reuses the unpublished tag instead
of consuming another version. An active build for that tag is left to finish.
New releases remain draft until every asset has uploaded successfully, so a
failed upload can also be resumed without exposing an incomplete release.
After publication, Release checks main again for changes that arrived meanwhile.
A repeated major request from an older main commit is refused; use `auto` to
resume it, or start a new milestone request on current main.
An unfinished release must be completed in `auto` mode before a new major is requested.

The repository needs `TAURI_SIGNING_PRIVATE_KEY` for signed releases. The Release
job needs permission to push its version commit and tags to main, and to dispatch
Build. If branch rules require pull requests for every writer, configure a
release bot exception consistent with those rules; no force push is used.
The standalone version-selectable installer retains its separate Setup workflow.

## Letting the agents say what they are working on

totex can stand a small MCP server beside the terminals it opens. An agent
registered against it says what it is working on, and that is drawn on the
graph beside the terminal it came from — a line, and how far through a plan it
is — so it can be read without the terminal being opened.

Two things have to be true, and they are the two rows the settings page gives
them.

**The server has to be standing.** It is off until it is switched on, and what
was switched on is remembered for the next window. Terminals opened before it
went up do not have its address; the next one opened does.

**The agent has to know where it is.** Every terminal totex opens is handed an
address of its own in `TOTEX_MCP_URL`, so what is registered is the name of the
variable rather than an address:

```sh
claude mcp add --scope user --transport http totex '${TOTEX_MCP_URL}'
```

The setup button on the page runs exactly that, here and in every WSL
distribution it can reach. Any other agent that expands environment variables
in its own configuration is registered the same way — a streamable HTTP server
pointed at `${TOTEX_MCP_URL}`:

```json
{ "mcpServers": { "totex": { "type": "http", "url": "${TOTEX_MCP_URL}" } } }
```

A terminal totex did not open has no such variable. The agent says so and
carries on, which is the right answer: there is no window beside it to draw on.

The server answers on the loopback address and nowhere else, and each session's
address is made with keys the app invents when the server goes up. On Windows
reaching into WSL that only works where the distribution's networking is
mirrored — under the networking WSL starts with, a distribution's loopback is
its own — and where it is not, terminals in that distribution are simply never
handed an address.

## Keeping branches off the graph

Every branch a repository has is drawn, whether or not the commit it stands on
is one of the ones on screen: a graph opens folded, and the branches behind the
fold hang off the fold itself rather than disappearing with the history they
were cut from. A checkout that has collected a hundred old lines of work
therefore draws a hundred rows, which is right for some of them and not for
others.

`.totex/.graphignore` is where that is narrowed. It is found the way `.git` is
found — by walking up from the checkout — so one written at the folder you put
on the graph covers every repository under it, and one written in a checkout
covers that checkout:

```gitignore
# Everything a remote has, on this repository's own graph.
origin/*

# And the old releases, except the one still being cut.
release/*
!release/next
```

A line is a branch name, read the way `.gitignore` reads a path: `*` stops at a
`/` and `**` crosses one, a name stands for everything under it — `dev` hides
`dev/80gd2z` — and a `!` line brings back what an earlier line swept up. The
name is matched with and without its remote, so `dev/*` reaches `origin/dev/x`
as well as `dev/x`. Blank lines and `#` comments are the file's own furniture.

A branch with a terminal running in it is drawn whatever the file says. The
graph is where a running terminal is found, and a mark that answers to
something cannot be left off it.

Branches whose names start the same way are gathered on the way out to their
column: one small mark per shared name, which the group leaves as a single line
and fans out of. Nothing is configured for that — it is what a namespace looks
like once there is more than one branch in it.

### File views

The file header switches between **Preview**, **Native**, and **Schemaed**. Preview
renders supported files (including the existing settings page); Native shows the
source. Schemaed edits JSON using a JSON Schema draft-07 form. `totex.json` has a
built-in schema. Attach another `.json` schema to customize a file's form; the
attachment is remembered locally by file path. Bundle `$ref` targets in the same
schema document; remote references and other schema drafts are not loaded.

Forms provide enum dropdowns, nested objects, arrays, and validation before saving.
Unknown JSON properties are retained. Save writes the JSON with two-space indentation;
Discard edits restores the current file. Header actions and Ctrl/Cmd+S also save.
Truncated or invalid JSON must be corrected in Native before form editing.

The form and validator load only when Schemaed opens. The desktop CSP permits
`unsafe-eval` for Ajv's runtime schema compilation; scripts still load only from
`self`, and schema references do not enable network access.
