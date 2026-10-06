import assert from "node:assert/strict";
import { after, afterEach, test } from "node:test";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { createServer } from "vite";

const server = await createServer({ configFile: false, server: { watch: null } });
const { startShell, endShell, shellEnded } = await server.ssrLoadModule("/src/lib/pty.ts");
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
