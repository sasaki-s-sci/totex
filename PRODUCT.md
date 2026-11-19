# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Product Purpose

totex is a desktop workspace for working with agents in terminals. Each terminal owns a canvas of evidence: running web pages, screenshots, files, code, and documents. Selecting a terminal selects its canvas.

## Operating Context

The user wants to work through conversation and keyboard shortcuts without moving the pointer. Agents supply evidence through totex's authenticated MCP endpoint, with each Codex thread mapped to its terminal's canvas, including screenshots captured with Playwright.

## Capabilities and Constraints

- The center is entirely the selected terminal's drawing area, divided only by straight lines. No titles, tabs, toolbars, view choosers, path inputs or terminal summaries. Empty panes show only shortcuts; add/remove and media range controls open from the context menu.
- The right sidebar retains its original compact terminal header. Repositories and folders added with the explorer's + remain visible by name, including those with no terminal. Ctrl+Shift selects an empty folder in that header; Enter starts its terminal.
- Holding Ctrl+Space enables canvas selection with arrow keys. Ctrl+X removes a displayed pane; Ctrl+A adds an empty pane. Releasing the chord returns focus to the terminal. Removing a pane never deletes its source file.
- Files open on double click and can be dropped into a pane. Existing file editing safeguards remain.
- Served pages run JavaScript in isolated iframes, without access to native app commands.
- Launching totex starts MCP on a fixed loopback port. Settings offers one Codex registration command per environment, including WSL. Codex starts normally, including with its shared daemon, and each terminal retains its own canvas.

## Brand Commitments

Preserve the application's theme and surrounding explorer. Replace the center's card styling with an edge-to-edge surface and straight separators.
