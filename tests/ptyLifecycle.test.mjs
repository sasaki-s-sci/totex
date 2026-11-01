import assert from "node:assert/strict";
import { after, afterEach, test } from "node:test";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { createServer } from "vite";

const server = await createServer({ configFile: false, server: { watch: null } });
const { startShell, endShell, shellEnded, resizeShell } =
  await server.ssrLoadModule("/src/lib/pty.ts");
after(() => server.close());
afterEach(() => clearMocks());
globalThis.window ??= {};

test("deleting while terminal startup is pending closes after opening and prevents a late view restarting it", async () => {
  const calls = [];
  let opened;
  mockIPC((command) => {
    calls.push(command);
    if (command === "pty_open")
      return new Promise((resolve) => {
        opened = resolve;
      });
  });
  const session = { id: "pending-close", cwd: "/repo", branch: "main" };
  const opening = startShell(session);
  const closing = endShell(session.id);
  assert.deepEqual(calls, ["pty_open"]);
  await assert.rejects(startShell(session), /terminal has ended/);
  opened();
  await Promise.all([opening, closing]);
  assert.deepEqual(calls, ["pty_open", "pty_close"]);
  assert.equal(shellEnded(session.id), true);
});

test("a failed close remains retryable and does not start another shell", async () => {
  const calls = [];
  let refused = true;
  mockIPC((command) => {
    calls.push(command);
    if (command === "pty_close" && refused) throw new Error("runtime unreachable");
  });
  const session = { id: "retry-close", cwd: "/repo", branch: "main" };
  await startShell(session);
  await assert.rejects(endShell(session.id), /runtime unreachable/);
  assert.equal(shellEnded(session.id), false);
  await startShell(session);
  refused = false;
  await endShell(session.id);
  assert.deepEqual(calls, ["pty_open", "pty_close", "pty_close"]);
});

test("switching views sends a terminal size only when it changes", async () => {
  const sizes = [];
  mockIPC((command, args) => {
    if (command === "pty_resize") sizes.push([args.rows, args.cols]);
  });
  const id = "switch-views";
  await startShell({ id, cwd: "/repo", branch: "main" });
  await Promise.all([resizeShell(id, 42, 91), resizeShell(id, 42, 91)]);
  await resizeShell(id, 42, 91);
  await resizeShell(id, 2, 91);
  await resizeShell(id, 42, 91);
  assert.deepEqual(sizes, [
    [42, 91],
    [2, 91],
    [42, 91],
  ]);
});

test("a resize before startup is sent again after the shell opens", async () => {
  const calls = [];
  mockIPC((command) => {
    calls.push(command);
  });
  const session = { id: "early-resize", cwd: "/repo", branch: "main" };
  await resizeShell(session.id, 42, 91);
  await startShell(session);
  await resizeShell(session.id, 42, 91);
  assert.deepEqual(calls, ["pty_resize", "pty_open", "pty_resize"]);
});

test("a failed resize can be retried at the same size", async () => {
  let calls = 0;
  mockIPC((command) => {
    if (command === "pty_resize" && ++calls === 1) throw new Error("resize refused");
  });
  await assert.rejects(resizeShell("retry-resize", 42, 91), /resize refused/);
  await resizeShell("retry-resize", 42, 91);
  await resizeShell("retry-resize", 42, 91);
  assert.equal(calls, 2);
});
