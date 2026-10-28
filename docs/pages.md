# Pages and hosts

Files, settings and terminals share `src/page/PageView.tsx`, the `Page` header/body,
and `PageTools`. Folder and repository titles also use the shared `PageHeader`,
with the same regular-weight typography as file and terminal titles. Agent status
icons sit immediately after the folder name, before its action buttons. The header renders actions that the content supports, including
moving a page between its card and the sidebar. Hiding the sidebar keeps its pages
alive. Terminals start as directly editable two-row cards. Their single header
contains expand/compact, placement and close actions; expansion resizes the same
terminal without adding a header or a miniature preview. Closing a file and
ending a terminal remain separate actions.

`PageWorkspace` controls placement and sidebar selection. `PageSlot` is a host in
the card board or the right sidebar. `PagePortal` moves one stable DOM container
between hosts, keeping the same React tree. In particular, a terminal has one
xterm instance, one PTY attachment and one snapshot reader.

`src/canvas/Pages.tsx` supplies file data and actions to the common views. File and
settings views receive `FilePageActions` explicitly; they do not require
`GraphActionsProvider`. File moves use the same save guard as other file actions:
a failed save leaves the page and draft in place.

Cards are the only workspace layout. `src/cards/PageBoard.tsx` places file pages,
settings and terminals in the same rows. Drag a page header to another page's left
or right edge to put them in equal-width columns within a row. Drop at the top or
bottom edge to make a separate row. The highlighted edge previews the placement;
Alt+arrow keys on a focused header provide keyboard reordering.

Each page uses `src/cards/ResizablePage.tsx`: dragging its bottom edge changes its
height, with a minimum height for each content type. The focused resize edge also
accepts Up and Down arrow keys. Graph placement, pinning and zoom settings are no
longer available.

The existing `sessions.list`, `sessions.showing`, `sessions.paged` and
`canvas.files` snapshot keys remain in use. `pages.dockedFiles` and
`pages.showingFile` store file placement and selection. Page IDs are namespaced as
`file:<requestId>` and `terminal:<sessionId>`; settings uses its existing file
request ID. `cards.layout` stores the rows of page IDs, and `cards.height.<pageId>`
stores each resized height. These values survive a frontend handoff through the
snapshot; they are not persisted across process restarts because file request IDs
are local to the process.

`tests/pages.browser.mjs` exports `verifyPages(page, base)` for a Playwright page
against Vite (default port 18422). It uses the real Window, editors and xterm with
native IPC mocked. It covers view identity, terminal attachment/focus, mixed-page layout, dragging and resizing,
file/settings docking, failed saves, host-specific controls, hide/show, snapshots
and closing without ending a session.
