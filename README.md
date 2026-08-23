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

## Updating

The last row of the settings dialog is the whole of it. A press looks at the
release page and takes the cheapest thing this copy is behind on.

**The window's own pages first.** About a megabyte, checked against the same key
the installers are signed with, and it ends in a reload. The program underneath
is untouched, so every terminal it is holding stays open and is redrawn from its
own backlog as the window comes back.

**The program on the press after that.** That is the installer, and it ends in a
restart — which ends every terminal with it. It is a second press because it is
a different cost, and nobody should pay it by having pressed once.

A `.deb` or an `.rpm` is never offered the second half: those files belong to the
package manager, which is who brings them forward. It is offered the first, so
the window can be current while the program waits for the next `apt upgrade`.

Pages that cannot draw a window are dropped on the next start of the app, so one
restart is the way back out of a bad one. `TOTEX_BUILT_IN_FRONT=1` in the
environment is the same way out without waiting to be asked: it opens the app on
the pages built into it and throws away whatever had been taken.

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
