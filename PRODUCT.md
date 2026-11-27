# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Product Purpose

totex is a desktop workspace for working with agents in terminals. Each tab owns one canvas associated with one folder and any number of terminals. Terminals in a canvas share its evidence: screenshots, files, code, documents, and explicitly embedded agent previews. The same folder can have several independent canvas tabs.

## Operating Context

The user wants to work through conversation and keyboard shortcuts without moving the pointer. Agents supply evidence through totex's authenticated MCP endpoint, with each Codex thread mapped to its terminal's canvas, including screenshots captured with Playwright.

## Capabilities and Constraints

- The central header matches the sidebar height. When the left sidebar is closed, its expand button occupies a separate leading cell divided from the canvas tabs by a vertical line. Each canvas tab shows its folder name, terminal numbers, add-terminal button and close button on one centered row inside the header. Show only the last folder name unless different paths share it; then include just enough parents to distinguish them. The surface below is divided by straight lines. Empty panes offer collected URLs as cards with the command on the top border and the URL below, grouped under terminal numbers matching the header, without an overall section heading or operation hints. Collect only URLs with a known shell command from sessions belonging to that canvas; exclude coding-agent output. Add/remove and media range controls open from the context menu.
- The right sidebar header contains a collapse button at its left and window controls at its right. Terminal numbers run consecutively across all canvas tabs in their displayed order. Ctrl+Up moves to a higher terminal number and Ctrl+Down to a lower number across canvases, wrapping at the ends; Ctrl+Left/Right switches canvas tabs. Ctrl+digits selects the numbered terminal, including multiple digits while Ctrl is held. The tab row's + chooses a folder for a new canvas; each tab's + adds a terminal. Empty header space accepts file drops and window dragging. Closing the last terminal retains the canvas.
- Holding Ctrl+Space enables canvas selection with arrow keys. Ctrl+X removes a displayed pane; Ctrl+A adds an empty pane. Releasing the chord returns focus to the terminal. Removing a pane never deletes its source file.
- Holding Ctrl+Shift offers folders for a new canvas. Arrow keys choose a folder and Enter creates the canvas; releasing the chord or pressing Escape cancels. Text editors retain their selection shortcuts, and copy/paste keeps its input until arrow navigation enters the chooser.
- Files open on double click or a drop into an empty pane. A drop in the center of an occupied pane keeps its content and passes files to an embedded application when it accepts uploads. Dropping at an edge adds a page with a split preview. Existing file editing safeguards remain.
- Right click opens Canvas options only on empty pages. Browser menus are suppressed throughout the desktop app and its frames; custom context menus remain available. Occupied pages keep their own context-menu behavior; the existing Shift+F10 menu remains available when the pane is focused.
- URL clicks and URL input open embedded pages in their owning canvas, filling an empty pane or adding one without replacing existing content. Collected URL cards offer the same canvas, browser and copy context-menu actions as terminal URLs. Local page failures follow the selected theme and show available reasons with reload and browser actions. Embedded pages remain isolated from native app commands. Ctrl+plus/minus zooms the focused resource or terminal; Ctrl+0 resets its zoom.
- The sidebar layout map shows snapshots of the displayed panes, including live embedded pages. Preview contents cannot receive clicks or input. Dragging a card to the trash removes its pane, with the same unsaved-file protection as other removal actions. Capture stops while the sidebar is hidden.
- Launching totex starts MCP on a fixed loopback port. Settings groups Codex, Claude Code and OpenCode registration commands by environment, including WSL. Codex starts normally, including with its shared daemon, and terminals in the same canvas share its panes and revision, while other tabs remain independent. Codex canvas calls require conversation metadata even through legacy per-terminal URLs; missing identities or an identity belonging to another terminal are rejected instead of using inherited environment credentials. Claude Code and OpenCode use a terminal-scoped stdio relay, with a separate CLI process per terminal.

## Brand Commitments

Preserve the application's theme and surrounding explorer. Replace the center's card styling with an edge-to-edge surface and straight separators.
