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

`latest.json`, `totex-macos-universal.app.tar.gz`, `front.tar.gz` and the three
`totex-layer-*.gz` sit beside them and are not downloads at all: they are what
an installed copy updates itself from. `totex-windows-x86_64.exe` is the app
itself, out of its installer — what the version-selectable installer writes
where the app goes, and the one file on the page that installs nothing if it is
double-clicked, because it is not an installer. It is totex.

## Updating

One horizontal row on the settings page declares two versions. **persistent**
is the small application layer that answers filesystem and workspace questions
beside the window. **ephemeral** is one full release: the pages and the program
that carries them are selected together because they are released and replaced
together.

Both are pull-downs, and each can declare either a named version or `latest`.
**sync** adjusts both parts to their declarations; there is no separate Take
button for either one. persistent swaps between two questions without reloading
the window. ephemeral downloads the release and stops there — nothing in the
window goes away, every terminal in it goes on running, and the row says the
next start. Closing totex is what puts the release in, and the copy opened
after that is the one it makes. So every terminal in the window is still the
price of a new program; it is just paid at a moment somebody chose, on a window
they had already finished with.

The ephemeral list contains only releases compatible with the selected
persistent version. The compatibility numbers come from each release manifest,
so an unknown combination is not offered. `latest` means the newest compatible
version in that pull-down when **sync** is pressed.

A `.deb` or an `.rpm` still leaves the program to its package manager. Its
ephemeral selector therefore moves only the front, and lists only fronts
that the installed program can run, so its sync ends in a reload rather than in
anything to be closed. persistent remains independently replaceable.
Choosing an older version is a rollback and is handled exactly like choosing a
newer one.

Pages that cannot draw a window are dropped on the next start of the app, so one
restart is the way back out of a bad one. `TOTEX_BUILT_IN_FRONT=1` in the
environment is the same way out without waiting to be asked: it opens the app on
the pages built into it and throws away whatever had been taken. A layer that
will not start needs no such thing — the copy built into the program answers
instead, from the next question onwards.

persistent versions come from `layer-v*`; ephemeral versions come from the full
`v*` release cycle. Both declarations are remembered by the program, so they
survive the swap, reload, and restart used to reach them.

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
