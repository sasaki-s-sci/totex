# totex

A window onto a git repository: its commits, the worktrees standing on them,
and the terminals those worktrees are worked in.

## Install

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

**Or take the installer yourself.** Every release page carries the installers
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

**Windows, with the version asked for and nothing typed.** There is one more
installer, and it is on no release page because it holds no release: it is a
window that asks which totex to put on the machine — the newest, or any version
by name — and then does what `install.ps1` does. It reads the release page,
downloads what that version shipped, checks it against the key totex is
released with, and hands over to the pages the `-setup.exe` has always shown.

[`totex-setup.exe`](https://github.com/sasaki-s-sci/totex/releases/download/setup/totex-setup.exe)

That address holds still for a different reason than the ones above it. Those
are whatever the newest release comes to be; this is not a release of totex at
all. It is published on a cycle of its own, under a tag of its own, so it moves
when the installer moves rather than when the app does — which is what makes
the copy downloaded today the one to keep.

`-setup.exe` asks two things, where the app goes and whether there is a desktop
shortcut, and opens totex once it has done it. The `.msi` asks nothing,
installs for every account on the machine, and wants administrator to do that.
The `.dmg` is the drag onto Applications. An `.AppImage` is one file: make it
executable and run it. A `.deb` or an `.rpm` is the package manager's, which is
also who brings it forward afterwards.

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

`latest.json`, `totex-macos-universal.app.tar.gz`, `front.tar.gz` and the three
`totex-layer-*.gz` sit beside them and are not downloads at all: they are what
an installed copy updates itself from.

## Updating

Three rows of the settings dialog, one per layer of the app, and each of them
says which release it is pointed at and what a press of it would cost. The
releases are listed in each row's pull-down, which the window keeps filled on a
slow loop from the moment it opens, so a list is full when it is opened rather
than after.

**The window's own pages.** About a megabyte, checked against the same key the
installers are signed with, and it ends in a reload. The program underneath is
untouched, so every terminal it is holding stays open and is redrawn from its
own backlog as the window comes back.

**The application layer.** The part of the program that answers everything the
app asks of the machine — what is in this directory, what is in this file, where
this window can be opened — which is a small program totex runs beside itself
rather than something built into it. It ends in nothing: the new one is started,
the old one is let go of between two questions, and the window is not reloaded.
It is the cheapest of the three and the one that interrupts nothing at all.

**The program.** That is the installer, and it ends in a restart — which ends
every terminal with it. It is a row of its own because it is a different cost,
and nobody should pay it by having pressed one of the others.

A `.deb` or an `.rpm` is never offered the last: those files belong to the
package manager, which is who brings them forward. It is offered the other two,
so the window and the layer under it can be current while the program waits for
the next `apt upgrade`.

Any of the three can be pointed at any release, older or newer. The row says
where it is going — `0.1.10 → 0.1.9` — because a version on its own does not
say which way a press goes, and going back is as much of what naming a release
is for as going forward. Pages older than the program are held in place by
having been chosen; taking a program is what clears them away again, since the
release a program comes out of carries its own.

Pages that cannot draw a window are dropped on the next start of the app, so one
restart is the way back out of a bad one. `TOTEX_BUILT_IN_FRONT=1` in the
environment is the same way out without waiting to be asked: it opens the app on
the pages built into it and throws away whatever had been taken. A layer that
will not start needs no such thing — the copy built into the program answers
instead, from the next question onwards.

**Releases of one layer.** Each row can also be pointed at a cycle of releases
of its own: `layer-v*` for the application layer, `front-v*` for the pages,
alongside the `v*` releases that carry all three. What a row is left pointed at
is remembered by the program rather than by the window, which is what makes it
survive the reload, the swap and the restart that the three rows end in.

## Letting the agents say what they are working on

totex can stand a small MCP server beside the terminals it opens. An agent
registered against it says what it is working on, and that is drawn on the
graph beside the terminal it came from — a line, and how far through a plan it
is — so it can be read without the terminal being opened.

Two things have to be true, and they are the two rows the settings dialog gives
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

The setup button in the dialog runs exactly that, here and in every WSL
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
