# Update boundary

The installed shell owns the outer browser document, native window and CLI
service. The frontend runs in a same-origin child frame and owns React, hooks,
module stores, effects, rendering and styles. `index.html` is always served from
the installed bundle; `front.html` comes from the selected frontend release.
The shell is deliberately small and does not import React or application logic.

A signed schema-2 `ephemeral.json` declares two identities:

- `contract` identifies the shell and native implementation, native dependencies
  and configuration, shell source and installed Tauri API dependency. Changes to
  frontend logic or frontend dependencies do not change it.
- `viewsContract` identifies the stateful frontend and rendering bindings. JSX
  expression contents and CSS are excluded. Matching identities allow the
  existing rendering-slot update, preserving React and terminal DOM instances.

The native download path verifies the artifact signature and shell identity.
Changing the shell identity requires installation and an application restart;
version numbering does not decide compatibility. The first migration from the
previous schema-1 architecture also requires this installation.

## Full frontend replacement

1. Download and stage the signed frontend, preserving the committed selection.
2. Flush pending settings and capture explicit handoff state. Refuse a handoff
   if pending settings cannot be saved. Pause input in the old frame, keeping
   its pixels visible. Update-induced blur does not save file drafts.
3. Create a hidden, full-size candidate frame with its own JavaScript and CSS.
   Rehydrate state and reconnect terminal emulators to existing PTYs. Wait for
   rendering and tracked startup operations, with a 30-second startup timeout.
4. Verify the candidate's version and views identity, then confirm the native
   selection. Make the candidate visible and restore focus.
5. Unmount the old React tree, unregister its native listeners and callbacks,
   then remove its frame. Retirement cannot close shared workspace watchers or
   terminal processes.

If preparation or confirmation fails, dispose the candidate, roll back the
native selection and resume the old frame. Interrupted activation recovers the
previous committed selection at the next application launch. Hashed assets from
old fronts remain available during the run, and the installed shell's original
chunks remain available even when starting with a confirmed overlay.

`src/shell/state.ts` carries structured-cloneable state under explicit keys,
independent of hook order. Current coverage includes folders and graph roots,
workspace readings, selected terminal, history depth and viewport, file cards
and unsaved drafts. Drafts retain their original disk contents for conflict
checking. Focus/selection and terminal scroll/selection are restored where their
corresponding content remains available. Terminal replay is bounded by the
service's retained output; a new emulator is not the original emulator instance.

New features must explicitly register state they need to preserve. Changing a
value's representation requires a new key or migration. Transient dialogs,
arbitrary hook state and media playback are not automatically transferred.

The bridge uses the outer document's Tauri IPC implementation and metadata,
tracks subscriptions by frontend lifetime and forwards native drag regions.
Front frames are trusted signed application code, not an isolation boundary for
untrusted HTML. Embedded document previews keep their existing isolation.

## Checks

- `pnpm build` and `pnpm test`
- `python3 -m unittest discover -s tests -p 'test_*.py'`
- `cargo test --manifest-path src-tauri/Cargo.toml --workspace --lib`
- `cargo test --manifest-path src-tauri/Cargo.toml -p totex --lib a_press_downloads -- --ignored`
- Native asset tests verify that overlays cannot replace the outer shell and
  cannot hide its original chunks after relaunch. Native signed-download tests
  open three real PTYs and verify that each can still execute commands.
- Full frontend browser check: build the app, run
  `node tests/build-shell-fixture.mjs`, serve `dist` on port 18422 and
  `/tmp/totex-shell-next-dist` on port 18423, then call `verifyShell(page)` from
  `tests/shell.browser.mjs` with a fresh Playwright Page. This uses real
  production frontend builds, React and xterm with mocked native IPC. It checks
  new executable frontend code, draft and terminal handoff, confirmation failure,
  stable shell identity and native listener cleanup.
- Rendering-only browser check: build with
  `pnpm exec vite build --config tests/fixtures/ephemeral.config.mjs`, serve
  `/tmp/totex-ephemeral-browser` on port 18421, and call `verifyEphemeral(page)`
  from `tests/ephemeral.browser.mjs` with a fresh Playwright Page.

Browser checks do not replace native WebView tests on Windows, macOS and Linux.
Platform installers and native window integration need their respective runs.
