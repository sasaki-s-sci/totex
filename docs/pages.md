# Terminal canvases

Each terminal owns one canvas. The center always displays the selected terminal's
canvas, filling the available area with panes separated by straight lines. There
are no pane titles, tabs, toolbars, path fields or task summaries. The right
sidebar uses its original compact terminal header; the selected terminal's output
and chat input fill the area below it. Repositories and folders added with the
explorer's + remain visible by name in that header, including those with no
running terminal. Click an empty folder's name to start a terminal, or select it
with Ctrl+Shift and the arrows, then press Enter. No dropdown opens.
The header shows names and terminal numbers without button backgrounds. Repository,
folder and terminal close buttons are absent; Ctrl+X still closes the active
terminal, and a sidebar pane's header menu can remove that pane and its terminals.
Terminals in the same full folder path stay together, with consecutive numbers
from left to right. Ctrl+A inserts beside the current terminal in that folder
and shifts later numbers. There is no terminal-order setting.
Each sidebar can be closed completely; a small arrow near the top reopens it,
including over an expanded resource, without discarding its contents.
Explorer entries use ordinary folder/file icons. The placement control is an
outline circle before placement and a filled circle after it. Ignored entries dim
both text and icons unless a Git change needs to be highlighted.

Switching terminals changes the canvas and terminal together. Each terminal has
one xterm instance and keeps its DOM renderer; returning to it redraws the current
buffer without changing the PTY size or asking the application to redraw. Inactive
canvases remain mounted, so an iframe's DOM, JavaScript state and scroll position
survive a terminal switch. A full page reload or replacing the iframe URL can
reload that application.

Drag a boundary between canvas panes to change their relative widths or heights.
The proportions are retained per terminal. Focus a boundary and use arrow keys
for keyboard resizing; Escape cancels a drag.

## Keyboard and files

| Action | Keys |
| --- | --- |
| Select a terminal and its canvas | Ctrl+number |
| Start another terminal in the current folder | Ctrl+A from the terminal |
| Close the current terminal | Ctrl+X from the terminal |
| Choose a folder with no terminal | Hold Ctrl+Shift and use the arrows |
| Start a terminal in the chosen folder | Enter while holding Ctrl+Shift |
| Select a canvas pane | Hold Ctrl+Space and use the arrows |
| Add an empty pane | Ctrl+A while holding Ctrl+Space |
| Remove the selected pane | Ctrl+X while holding Ctrl+Space |
| Open the selected pane's menu | Shift+F10 or the Context Menu key |
| Resume typing in the terminal | Release Space or Ctrl |
| Toggle a focused text file's raw/preview view | Ctrl+Shift+V |

Canvas control is active only while Ctrl+Space is held. Releasing it returns
focus to the current terminal. Removing a pane removes its display, not its
source file. An edited file must save successfully before its pane or terminal
can be closed. Right-click a pane to see its file name and path (or served URL),
**Expand**, **Add pane** and **Remove pane**. **Open URL** supplies a borderless
address field; terminal Ctrl+click opens the address in that terminal's canvas.
Right-click a terminal URL or file path for its Open and Copy actions. Empty
canvases and panes display only the shortcut hint.

**Expand** opens the existing file or preview in an overlay. Its editor, iframe
and media player remain mounted in place, retaining drafts, application state and
playback position. Close the overlay to return to the grid; switching terminals
also closes it. Expansion does not change the canvas layout stored through MCP.
Escape closes it when focus is in the canvas document; inside an embedded
application, use the overlay's **Close** button.

HTML previews and served applications forward right-clicks to the same canvas
menu through the native window's frame bridge. Left clicks, scrolling, selection
and application input keep their normal behavior. From the terminal, Ctrl+Space
and Shift+F10 also open the selected pane's menu. A menu opened during held
selection remains usable after releasing the chord.

Double-click an explorer file to open it in the current terminal's canvas. Drag
a file onto an empty pane to fill it, or onto a pane's edge to add a pane beside
it. A drop in the middle of a running web application belongs to its upload
handler. The native window forwards dropped file bytes to the application when
the WebView owns the OS drop; absolute filesystem paths are not exposed.
Applications that require trusted OS drag events can reject that forwarding.
Agents supply URLs and paths through MCP; there is no canvas path
input. Editor shortcuts keep their normal text-editing behavior.
The center's top strip moves the native window when dragged. It has no permanent
line and becomes visible only on hover; file dropping remains available below it.

Text view selection is available through MCP or Ctrl+Shift+V on the focused
file, with no on-canvas chooser. Text files wrap by default and have no line-number
gutter; edit markers remain in the text's left margin. Raw data is the existing editor. Preview renders Markdown, HTML, SVG, CSV
and TSV; other text remains a literal, read-only reading. Switching saves the
draft first and stays in the editor if saving fails. Local HTML previews are
scriptless; use a localhost iframe for a running application.

MCP explicitly chooses the renderer, including for URLs without an extension.

## Canvas in an external browser

Choose **Open canvas in browser** from the canvas menu to open that canvas in a
regular browser tab. It stays pinned to its terminal when the native window
switches terminals. Both views use the same revisioned panes and file saves;
MCP canvas changes reach both. Embedded applications have their own browser
instance, which survives subsequent terminal switches.

Browser automation MCP can click, type, inspect and operate the tab's contents,
including its embedded applications. The existing totex `canvas` tool continues
to read and update the panes. No browser-tab management commands are added.

The window serves the tab on an authenticated loopback URL. That URL grants
access to one canvas and its files, so treat it as private. Browser code cannot
call general native commands or read arbitrary paths; add new local files through
the native canvas or its MCP tool. Closing the terminal or the native window
ends access. This feature requires a native window update, with no change to the
running terminal service.

## Agent-driven evidence

Starting totex starts its MCP listener at the fixed loopback address
`127.0.0.1:26374`. The shared endpoint exposes `canvas`; each call is routed to
the terminal running that Codex thread. MCP is enabled by default for new
settings. An explicit `"mcpServing": false` remains disabled, and the Canvas
section in Settings retains the enable switch. A port conflict is reported as
an error instead of silently choosing another port. The explorer has no MCP button.

Setup has two steps: launch totex, then run its Codex registration command once
per environment. **Settings → Canvas → Copy command** supplies the command for
the selected terminal's environment. It invokes the totex executable with
`--register-codex-mcp`; start Codex normally afterwards. Shared Codex daemons are
supported, and terminal shells need no connection variables or reopening.
Codex's `/mcp` shows the connection.

The settings command and registration check the running server's MCP handshake
and `canvas` tool first. If an older terminal service is still running, registration
reports the incompatibility and leaves Codex's settings unchanged. Updating the
window alone does not replace that service; it must be updated or restarted once
its running terminals can be closed safely.

Registration writes a stable credential-bearing loopback URL into Codex's MCP
configuration and puts `thread-id` first in `tui.terminal_title`, preserving the
other title items. Totex associates Codex's terminal title with its thread
metadata on MCP calls. Switching the visible terminal or running two Codex
threads in the same folder does not redirect their canvases.
Keep the `thread-id` title item enabled. If the same conversation is opened in
two terminals, canvas calls report the ambiguity instead of choosing a terminal.
The private credential is retained in `~/.totex/mcp-token` across app restarts.

For WSL, the command invokes the Windows totex executable with `--wsl` and the
distribution's Codex home. Registration prepares the Windows curl bridge and
updates Codex's configuration in that distribution. No manual bridge creation
is needed. Preparing or copying the command does not register Codex; only running
it changes Codex's settings. SSH terminals cannot reach the local listener and
show an unsupported-environment error. Folder-level `mcp: false` remains honored.

Call `canvas` with `{}` to read `{ id, revision, panes }`. Merge the desired
changes with the returned panes, then submit the complete array with the revision
you read. For example, when the current revision is 7:

```json
{
  "revision": 7,
  "panes": [
    {
      "id": "preview",
      "kind": "iframe",
      "url": "http://localhost:3000",
      "title": "Development preview"
    },
    {
      "id": "screenshot",
      "kind": "image",
      "src": "/tmp/checkout.png",
      "title": "Playwright screenshot"
    },
    {
      "id": "source",
      "kind": "file",
      "path": "src/App.tsx"
    }
  ]
}
```

This replaces the complete layout; include existing panes that should remain.
A stale revision is rejected, so read again and merge instead of overwriting
the user's intervening additions or removals. Keep pane IDs stable when updating
content to retain the corresponding editor or iframe instance. Supplying
`"panes": []` clears the canvas.

Supported pane kinds are `iframe` (`url`), `image` (`src`), `video` / `audio` (`src`), `file` (`path`),
`code` (`text`, optional `language`), `markdown` (`text`), and `empty`. Every pane
requires a unique `id` and may have a `title`. A canvas accepts at most 32 panes
and 200 KiB of inline content; use file paths for larger documents.

File panes accept `"view": "text"` or `"view": "preview"`; omitting `view` uses
the format's default. Video, audio and file panes accept a `playback` object:

```json
{
  "id": "demo-clip",
  "kind": "video",
  "src": "http://localhost:3000/demo.mp4",
  "playback": { "start": 12, "end": 28, "position": 16, "playing": true }
}
```

Times are nonnegative seconds. `start` defaults to 0, `end` must follow `start`,
and `position` must be inside any supplied bounds. Duration clamps the interval
once metadata loads. The player stops at `end`; playing again starts that
interval again. `playing` requests play/pause, while omitting it leaves playback
under the viewer's control. An unchanged playback request does not seek again
when another pane updates. Playback fields describe requested controls, not a
live playback-status feed. Browser autoplay restrictions may require the
player's Play button.

The native player controls provide seeking, volume and fullscreen for video.
The right-click menu's **Playback range** opens position/start/end fields, and applying them
updates the terminal's canvas so the agent can read the chosen interval. Switching
terminals pauses hidden video/audio players and preserves their positions.

Recognized images include PNG/APNG, JPEG, GIF, WebP, BMP, ICO, AVIF and SVG.
Video containers include MP4/M4V, MOV, WebM and OGV; audio includes MP3, M4A, AAC,
OGG/OGA/Opus, WAV and FLAC. Actual decoding depends on the platform WebView and
the file's codec; unsupported media shows an error. No transcoding is performed.

Local media uses Tauri's asset protocol with permission for the exact selected
file, allowing browser range requests without the document reader's 16 MiB
limit. OS-accessible WSL paths use the same route. SSH and other remote-only
paths retain the bounded file reader; serve larger remote media over HTTP(S).
HTTP media must support byte ranges for reliable seeking.

Images can use HTTP(S) URLs or screenshot files produced by Playwright. File and
local image/video/audio paths are resolved against the terminal's starting directory and
host. The service reuses `Host` to resolve relative paths and POSIX absolute
paths for local, WSL and SSH sessions: `/tmp/checkout.png` in a WSL terminal
refers to that distro's file, and in an SSH terminal to the remote host's file.
Explicit Windows, UNC and SSH paths retain their specified host.

An HTTP(S) iframe runs the served application's JavaScript, modules, API calls
and origin storage. Its URL must be reachable from the app's WebView. A
scriptless wrapper applies a CSP that limits frame navigation to the submitted
origin and keeps the app's native bridge out of the served page. Some sites deny
embedding through their own headers; use a Playwright screenshot image for those
pages. Iframe runtime state survives terminal switching, not a full reload.

## Implementation and checks

`src/canvas/Canvas.tsx` renders the terminal canvases; `useCanvases.ts` synchronizes
revisioned state with the service and guards edited files. `RightSidebar.tsx`
owns the terminal index and single terminal views.
`src-tauri/persistent/src/door/canvas.rs` owns the MCP tool and canonical canvas
state; native `canvas_read` and `canvas_write` commands connect the window to it.

This change requires rebuilding the native app and persistent terminal service.
A frontend-only reload cannot add the MCP tool to an already running old service.
The registration-command UI and bridge preparation live in the window; they add
no persistent-service operation. Installing these alone requires updating the
native window, while adding the canvas tool requires the service update above.

The iframe context-menu bridge is a window initialization script, including in
nested frames. Only canvas previews participate; messages must come from a direct
child frame, and hidden panes cannot open menus. Local HTML retains its opaque
origin, sanitization and `script-src 'none'` policy. Its sandbox permits the native
bridge's event callbacks, while document scripts remain blocked. This bridge
requires a native window update, with no terminal-service change.

`tests/pages.browser.mjs` exports `verifyPages(page, base)` for a Playwright Page
against Vite, defaulting to `http://127.0.0.1:18422`. It uses real React, xterm,
editors and frames with native IPC and a served application fixture. It covers
iframe JS/API/storage retention, terminal switching, held-key canvas controls,
file dropping and opening, failed-save protection, agent code/image updates and
terminal startup without duplicate views. `verifyTerminalPanes` and
`verifyMixedPages` remain available as focused subsets.

`tests/terminalRendering.browser.mjs` checks screenshot pixels after repeated
switches, output received while hidden and alternate-screen TUI use. It verifies
that the same terminal and DOM remain attached with no extra PTY resize, attach
or input calls. The resize and scroll browser suites cover actual size changes
and scrollback separately.

`tests/canvasExpand.browser.mjs` verifies overlay sizing, retained unsaved editors,
iframe runtime and video playback, dismissal, nested menus and terminal switches.

`tests/canvasMedia.browser.mjs` exercises real WebM decoding through served and
local-file routes, text preview choices, draft protection and playback position
across terminal switching. `tests/media.browser.mjs` covers the shared player's
range controls, invalid input, explicit play/pause and cleanup. The tiny
`tests/fixtures/canvas-video.webm` is two seconds of generated teal frames.

`tests/canvasContextMenu.browser.mjs` installs the window's actual frame bridge
in Chromium and checks local HTML, nested served frames, menu coordinates and
removal, inactive panes, and ordinary handlers inside the shell's frontend frame.
It also checks that preview content cannot run scripts, reach parent/native APIs
or load external resources.

`tests/mcpSetup.browser.mjs` checks the settings switch, command preparation and
copying, failure/retry, and selected-terminal changes without retaining an old
environment's command. It also covers a fixed-port startup error and retry.
Native setup tests cover registration, shell quoting, preserved Codex settings,
and terminal routing through Codex thread identity.

The terminal ordering, input and context-menu browser checks cover insertion,
renumbering, long IME composition, URL/path actions and retained terminal state.
`tests/canvasDrop.browser.mjs` covers preview boundaries and application uploads;
`tests/canvasResize.browser.mjs` covers pointer/keyboard resizing and cleanup.
`tests/browserCanvas.browser.mjs` verifies the separate browser entry, pinned
canvas updates, interactive applications and guarded file saves.
