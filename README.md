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

## Updating

Two rows on the settings page. **persistent** is the program beside the
window that holds the terminals — `totex-persistent`, started by the first
window that needs it and left running by every window after. **ephemeral** is
everything else: the window, the commands it answers and the pages it draws,
which is what a release replaces.

ephemeral is a pull-down, and can declare either a named version or `latest`.
**Apply** adjusts the app to its declaration; there is no separate Take
button. The release is downloaded and checked while the window is open, the
window closes, the release goes in, and the window opens again on it — in
front of the same terminals, because none of them were in the window. Nothing
anybody was working on goes with it.

persistent is not taken from a release page. Which releases replace it is
said by the version number: a **patch** (`0.1.30` to `0.1.31`) is the
ephemeral half alone, and the program holding the terminals is the same
program before and after, holding the same terminals; a **minor** (`0.1.x` to
`0.2.0`) is that program too, and there is no putting it in without closing
every terminal it holds. The row says which of the two the selected release
is before anything is pressed. Within a line a window uses whichever program
it finds running, and swaps it for the one it brought only at a start with no
terminal open, which is the one moment that costs nothing.

Its pull-down offers the programs this machine holds — every release that has
run here left one — with `latest` being the one this window brought. Where
that differs from what is running, the button reads **Restart** and is red:
pressing it stops the program holding the terminals and starts the chosen one
in its place, and every terminal is closed. That is the same press a window
makes on its own at a start with no terminal open, made on purpose.

The release workflow chooses patch or minor from the changes since the previous
release. Changes to the persistent program, its shared host crate or its shipped
dependencies require a minor. A major is a milestone explicitly chosen by a
developer. See **Releasing from main** below.

The pull-down contains only releases whose pages this program can draw. The
compatibility number comes from each release manifest, so an unknown
combination is not offered. `latest` means the newest compatible version in
the pull-down when **Apply** is pressed. Choosing an older version is a
rollback and is handled exactly like choosing a newer one.

A `.deb` or an `.rpm` still leaves the program to its package manager. Its
pull-down therefore moves only the pages, and lists only pages that the
installed program can run, so its Apply ends in a reload rather than in a
restart.

Pages that cannot draw a window are dropped on the next start of the app, so one
restart is the way back out of a bad one. `TOTEX_BUILT_IN_FRONT=1` in the
environment is the same way out without waiting to be asked: it opens the app on
the pages built into it and throws away whatever had been taken. A program that
will not start after an update leaves the terminals where they were: they are
the persistent half's, and the copy that was running a moment ago is what
opens next.

The declaration is remembered by the program, so it survives the reload and
the restart used to reach it.

## Releasing from main

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

Persistent changes take precedence over ephemeral ones. The window's socket
client, `src-tauri/persistent/src/talk.rs`, is ephemeral. Dependency comparisons
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
