import assert from "node:assert/strict";
import { once } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { launch, stop, stopPersistent, waitFor } from "./runtime.mjs";

// Explicitly opt in: this test uses the selected agent's existing authentication
// and can consume provider credits. It never opens a developer's existing PTY.
const command = process.env.TOTEX_TEST_ACP_COMMAND;
if (!command) throw new Error("Set TOTEX_TEST_ACP_COMMAND to an installed ACP executable");
const args = JSON.parse(process.env.TOTEX_TEST_ACP_ARGS ?? '["acp", "--pure"]');
const model = process.env.TOTEX_TEST_ACP_MODEL ?? "";
assert.ok(Array.isArray(args) && args.every((arg) => typeof arg === "string"));
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const temporary = mkdtempSync(join(tmpdir(), "totex-live-monitor-"));
const output = join(
  root,
  "test-results",
  "live-monitor",
  new Date().toISOString().replaceAll(":", "-"),
);
mkdirSync(output, { recursive: true });
const addressPath = join(temporary, "keep", "address.json");
const result = { status: "failed", started: new Date().toISOString(), command, args, model };
let service;
let socket;
let serial = 0;
const pending = new Map();

function ask(command, payload = {}) {
  return new Promise((resolve, reject) => {
    const id = ++serial;
    const timeout = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Persistent request timed out: ${command}`));
    }, 10000);
    pending.set(id, {
      resolve(value) {
        clearTimeout(timeout);
        resolve(value);
      },
      reject(error) {
        clearTimeout(timeout);
        reject(error);
      },
    });
    socket.write(`${JSON.stringify({ id, do: command, with: payload })}\n`);
  });
}

try {
  const binary = join(root, "src-tauri/target/debug/totex-persistent");
  assert.ok(existsSync(binary), "Build the persistent binary first");
  service = launch(binary, ["--home", join(temporary, "keep")], join(output, "service.log"), {
    ...process.env,
    SHELL: "/bin/sh",
  });
  await waitFor(() => existsSync(addressPath), "private persistent service");
  const address = JSON.parse(readFileSync(addressPath, "utf8"));
  socket = createConnection({ host: "127.0.0.1", port: address.port });
  socket.on("error", (error) => {
    for (const request of pending.values()) request.reject(error);
    pending.clear();
  });
  let buffer = "";
  socket.on("data", (chunk) => {
    buffer += chunk;
    while (buffer.includes("\n")) {
      const newline = buffer.indexOf("\n");
      const reply = JSON.parse(buffer.slice(0, newline));
      buffer = buffer.slice(newline + 1);
      const request = pending.get(reply.id);
      if (!request) continue;
      pending.delete(reply.id);
      if ("said" in reply) request.resolve(reply.said);
      else request.reject(new Error(reply.but ?? "Unsupported persistent command"));
    }
  });
  await once(socket, "connect");
  socket.write(`${JSON.stringify({ token: address.token })}\n`);
  const id = "live-monitor-test";
  await ask("open", { id, cwd: temporary, rows: 24, cols: 100, meta: null });
  const evidence = [
    "User request: Add keyboard navigation to the document editor. 日本語対応も含む。",
    "Current task: Implementing focus traversal; status running.",
    "Goal mode: active. Goal: ship accessible keyboard navigation.",
    "Background subagent review-1: Reviewing keyboard tests, running, progress 40%.",
    "Background shell build-1: Compiling editor, running.",
    "Estimated implementation time remaining: 10 minutes, medium confidence.",
  ].join("\n");
  const quoted = `'${evidence.replaceAll("'", "'\\''")}'`;
  await ask("write", { id, data: `printf '%s\\n' ${quoted}\n` });
  await waitFor(
    async () => (await ask("attach", { id }))?.text.includes("medium confidence"),
    "terminal evidence",
  );
  const config = {
    enabled: true,
    command,
    args,
    model,
    intervalSecs: 3600,
    features: {
      status: true,
      agents: true,
      taskSummary: true,
      requestSummary: true,
      estimate: true,
      goal: true,
    },
  };
  await ask("monitor_configure", { config });
  await waitFor(
    async () => {
      const snapshot = (await ask("monitor_snapshots")).find((entry) => entry.id === id);
      if (snapshot?.error) throw new Error(snapshot.error);
      if (!snapshot?.updatedAt) return false;
      result.snapshot = snapshot;
      return true;
    },
    "live ACP agent observation",
    140000,
  );
  assert.equal(result.snapshot.source, "inferred");
  // A real model may decline to infer a status from terminal text. Unknown is
  // valid; deterministic lifecycle assertions belong to the native ACP fixture.
  assert.ok(["running", "unknown"].includes(result.snapshot.status));
  assert.ok(result.snapshot.taskSummary?.trim(), "Agent must summarize the current task");
  assert.ok(result.snapshot.requestSummary?.trim(), "Agent must summarize the request");
  assert.equal(result.snapshot.goal?.status, "active");
  assert.ok(
    result.snapshot.agents.some(
      (agent) => agent.kind === "subagent" && agent.source === "inferred",
    ),
  );
  assert.ok(result.snapshot.estimate?.seconds > 0);
  await ask("monitor_configure", { config: { ...config, enabled: false } });
  await ask("close", { id });
  result.status = "passed";
} catch (error) {
  result.error = error.stack ?? String(error);
  process.exitCode = 1;
} finally {
  try {
    await stopPersistent(addressPath);
  } catch (error) {
    result.cleanupError = String(error);
    result.status = "failed";
    process.exitCode = 1;
  }
  socket?.destroy();
  for (const request of pending.values()) request.reject(new Error("Test finished"));
  pending.clear();
  await stop(service);
  rmSync(temporary, { recursive: true, force: true });
  writeFileSync(join(output, "result.json"), `${JSON.stringify(result, null, 2)}\n`);
  console.log(`Live Monitor ${result.status}: ${join(output, "result.json")}`);
  if (result.error) console.error(result.error);
  if (result.cleanupError) console.error(result.cleanupError);
}
