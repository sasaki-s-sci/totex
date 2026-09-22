# Pages and hosts

Files, settings and terminals share `src/page/PageView.tsx`, the `Page` header/body,
and `PageTools`. The header renders actions that the content supports; canvas-only
controls (pin, fit, fold and shrink) disappear in the sidebar. Hiding the sidebar
keeps its pages alive. Closing a file and ending a terminal remain separate actions.

`PageWorkspace` controls placement and sidebar selection. `PageSlot` is a layout
host in a React Flow node, the pinned layer or the right sidebar. `PagePortal`
moves one stable DOM container between hosts, keeping the same React tree. In
particular, a terminal has one xterm instance, one PTY attachment and one snapshot
reader. Folding it hides the body instead of destroying the runtime. Native drag
handlers on pinned hosts follow physical DOM bubbling across portals.

`src/canvas/Pages.tsx` supplies the existing file data and actions to the common views.
File and settings views receive `FilePageActions` explicitly; they do not require
`GraphActionsProvider`. Canvas nodes retain their geometry while docked, so moving
back restores their size, position, fold and pin state. File moves use the same
save guard as other file actions: a failed save leaves the page and draft in place.

The existing `sessions.list`, `sessions.showing`, `sessions.paged`, `canvas.files`
and `canvas.clis` snapshot keys remain in use. `pages.dockedFiles` and
`pages.showingFile` add file placement and selection. Page IDs are namespaced as
`file:<requestId>` and `terminal:<sessionId>`; settings uses its existing file
request ID. Selecting a terminal from the graph moves its single view to the
sidebar.

`tests/pages.browser.mjs` exports `verifyPages(page, base)` for a Playwright page
against Vite (default port 18422). It uses the real Window, React Flow, editors and
xterm with native IPC mocked. It covers view identity, terminal attachment/focus,
folding, file/settings docking, failed saves, host-specific controls, hide/show,
pinned and canvas dragging, snapshots and closing without ending a session.
