import assert from "node:assert/strict";
import { after, afterEach, test } from "node:test";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { createServer } from "vite";

const server = await createServer({ configFile: false, server: { watch: null } });
const { startShell, endShell, shellEnded, shellExited, attachShell, resizeShell } =
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

test("overlapping close requests share the acknowledgement and retain a failed session", async () => {
  let rejectClose;
  let closes = 0;
  let entered;
  const closingStarted = new Promise((resolve) => {
    entered = resolve;
  });
  mockIPC((command) => {
    if (command === "pty_close") {
      closes++;
      return new Promise((_, reject) => {
        rejectClose = reject;
        entered();
      });
    }
  });
  const session = { id: "overlapping-close", cwd: "/repo", branch: "main" };
  await startShell(session);
  const first = endShell(session.id);
  const second = endShell(session.id);
  await closingStarted;
  assert.equal(first, second);
  rejectClose(new Error("close refused"));
  const results = await Promise.allSettled([first, second]);
  assert.ok(results.every((result) => result.status === "rejected"));
  assert.equal(closes, 1);
  assert.equal(shellEnded(session.id), false);
});

test("a failed opening followed by a failed close can start again", async () => {
  let refused = true;
  let opens = 0;
  mockIPC((command) => {
    if (command === "pty_open") opens++;
    if (refused) throw new Error("runtime unavailable");
  });
  const session = { id: "failed-open-close", cwd: "/repo", branch: "main" };
  await Promise.allSettled([startShell(session), endShell(session.id)]);
  refused = false;
  await startShell(session);
  assert.equal(opens, 2);
});

test("confirmed natural exit does not issue a redundant close", async () => {
  const calls = [];
  mockIPC((command) => {
    calls.push(command);
  });
  shellExited("naturally-ended");
  await endShell("naturally-ended");
  assert.deepEqual(calls, []);
});

test("attachment errors remain distinct from a missing terminal", async () => {
  mockIPC(() => {
    throw new Error("attachment transport failed");
  });
  await assert.rejects(attachShell("attach-error"), /attachment transport failed/);
  mockIPC(() => null);
  assert.equal(await attachShell("missing"), null);
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

test("a drag sends one resize at a time and keeps only the latest pending size", async () => {
  const first = Promise.withResolvers();
  const calls = [];
  mockIPC((command, args) => {
    assert.equal(command, "pty_resize");
    calls.push([args.rows, args.cols]);
    if (calls.length === 1) return first.promise;
  });
  const id = "resize-drag";
  const narrow = resizeShell(id, 20, 80);
  await new Promise(setImmediate);
  const middle = resizeShell(id, 24, 100);
  const wide = resizeShell(id, 30, 140);
  await new Promise(setImmediate);
  assert.deepEqual(calls, [[20, 80]], "The host must not apply resizes out of order");
  first.resolve();
  await Promise.all([narrow, middle, wide]);
  assert.deepEqual(calls, [
    [20, 80],
    [30, 140],
  ]);
  await resizeShell(id, 30, 140);
  assert.equal(calls.length, 2, "The final size remains deduplicated");
});

test("a refused resize does not discard a newer size", async () => {
  const first = Promise.withResolvers();
  const calls = [];
  mockIPC((command, args) => {
    assert.equal(command, "pty_resize");
    calls.push(args.cols);
    if (calls.length === 1) return first.promise;
  });
  const refused = assert.rejects(resizeShell("resize-drag-retry", 24, 80), /resize refused/);
  await new Promise(setImmediate);
  const latest = resizeShell("resize-drag-retry", 24, 120);
  first.reject(new Error("resize refused"));
  await Promise.all([refused, latest]);
  assert.deepEqual(calls, [80, 120]);
  await resizeShell("resize-drag-retry", 24, 120);
  assert.equal(calls.length, 2);
});
