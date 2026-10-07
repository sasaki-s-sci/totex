import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createServer } from "vite";
import { mergedReports } from "../src/lib/overseen.ts";

const cacheDir = await mkdtemp(join(tmpdir(), "totex-replies-"));
const server = await createServer({ configFile: false, cacheDir, server: { watch: null } });
const { reportCard } = await server.ssrLoadModule("/src/lib/graph/reporting.ts");
await server.close();
await rm(cacheDir, { recursive: true, force: true });

const reply = {
  key: "new",
  agent: "codex",
  sessionId: "s",
  turnId: "t",
  status: "completed",
  text: "最終返信\n本文",
  truncated: false,
};
const native = { doing: "old progress", steps: [{ title: "old step", done: false }], reply };

test("raw reply appears immediately and late summaries cannot replace the new reply", () => {
  const reports = new Map([["terminal", native]]);
  const stale = new Map([
    ["terminal", { doing: "old summary", steps: [], overseen: true, replyKey: "old" }],
  ]);
  assert.equal(mergedReports(reports, stale, true).get("terminal"), native);
  const current = new Map([
    ["terminal", { doing: "new summary", steps: [], overseen: true, replyKey: "new" }],
  ]);
  const result = mergedReports(reports, current, true).get("terminal");
  assert.equal(result.doing, "new summary");
  assert.equal(result.reply, reply);
  assert.equal(mergedReports(reports, current, false), reports);
});

test("card uses the extracted body and removes old steps after completion", () => {
  const card = reportCard(native);
  assert.ok(card.doing.join("\n").includes("最終返信"));
  assert.ok(!card.doing.join("\n").includes("old progress"));
  assert.deepEqual(card.steps, []);
  const running = reportCard({ ...native, reply: { ...reply, status: "inProgress", text: "" } });
  assert.deepEqual(running.doing, []);
  assert.ok(card.height > running.height);
});
