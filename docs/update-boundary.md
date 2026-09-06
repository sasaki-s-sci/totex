# Update boundary

The persistent unit is everything that must remain alive during a view update:
the native process, CLI service, React, stateful component functions, hooks,
module stores, effects, refs, terminal instances and subscriptions. The ephemeral
unit consists of pure rendering expressions and styles. Persistence here means
lifetime across an ephemeral update, not necessarily serialization to disk.

`ephemeral-build.mjs` extracts JSX into a separate ES module. Each expression
receives explicit bindings from its original host scope. A stable `ViewSlot`
renders it and subscribes to the active implementation registry. Swapping the
registry does not replace component types, recreate a React root or reload the
webview. Hooks and subscriptions continue to belong to the original host.

The host identity hashes source outside these expressions, their binding names,
native implementation, build boundary and locked dependencies. CSS and release
numbers do not change it. Host changes require another persistent installation.
This first boundary supports JSX and CSS updates, rather than arbitrary module
replacement. Changes that require new bindings are intentionally incompatible.

| Check | Implementation | Verification |
| --- | --- | --- |
| Ephemeral preserves every CLI session | No session control, reload or exit calls in its update path | Signed-download integration test opens three real PTYs, activates views, then writes to every original session and reads output |
| Frontend updates smoothly | Preload expressions and CSS, then notify existing rendering slots in the same document | Production browser fixture retains three actual xterm DOM trees, draft text, selection and focus; no terminal detach/reattach occurs |
| Persistent updates restart totex | Download whole runtime, hand installation to the service, exit and relaunch | Browser checks command sequence; native test installs an executable and observes the new process receive the service-restart argument |
| Persistent includes its matching ephemeral | Clear previous overlay and view pin; new bundle boots its own views and service | Overlay reset tests and runtime relaunch test |
| Persistent:ephemeral is 1:N | Group runtime choices by identity; list all compatible view versions and disable incompatible ones | Model tests cover latest, rollback, unavailable releases and avoiding unnecessary runtime restarts |

Activation is staged. The old view remains displayed during download, signature
verification and module/style loading. Mounted expressions are evaluated with
current inputs before commit. Loading or validation failures leave the old
registry active. A failed native confirmation rolls back the registry and CSS.
The backend keeps the previous committed selection for recovery after an
interrupted activation. Lazy host assets stay accessible across multiple swaps.

This preserves existing instances for compatible rendering changes; deliberately
removing a component from the rendered tree still has React's usual unmount
semantics. Ephemeral expressions must remain pure; state and side effects belong
in host controllers. Backend acceptance verifies the signed artifact's runtime
identity as well as the manifest's declaration.

## Checks

- `pnpm build`
- `node --test tests/*.test.mjs`
- `cargo test --manifest-path src-tauri/Cargo.toml --workspace --lib`
- `cargo test --manifest-path src-tauri/Cargo.toml -p totex --lib a_press_downloads -- --ignored`
- Build the production browser fixture with `pnpm exec vite build --config tests/fixtures/ephemeral.config.mjs`, then serve it with `pnpm exec vite preview --config tests/fixtures/ephemeral.config.mjs --port 18421`. Run `verifyEphemeral(page)` exported by `tests/ephemeral.browser.mjs` with a fresh Playwright Page. The fixture mocks native IPC but uses production React, the actual CLI component and xterm; the signed native integration test separately covers real PTYs.

Native installer checks in this workspace exercise the Unix file-install/relaunch
path. Windows NSIS/MSI and macOS bundle installation require their respective
platform runs. The initial adoption requires a persistent installation; older
artifacts do not contain the hot-swap boundary.
