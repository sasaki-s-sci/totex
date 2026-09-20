import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createServer } from "vite";

const cacheDir = await mkdtemp(join(tmpdir(), "totex-history-depths-"));
const server = await createServer({ configFile: false, cacheDir, server: { watch: null } });
const { settleDepths } = await server.ssrLoadModule("/src/lib/graph/depths.ts");
await server.close();
await rm(cacheDir, { recursive: true, force: true });

// Newest first, the way a repository is read; no branches, so nothing reaches for a tip.
function repository(count) {
  return {
    id: "repo",
    commits: Array.from({ length: count }, (_, at) => ({ id: `c${count - at}`, parents: [] })),
    branches: [],
    worktrees: [],
  };
}

const none = () => ({ ask: undefined, proposed: false });
const still = { length: 3, follow: false, free: new Set() };

test("a band shows the length every band is given, and never less than one", () => {
  const ten = [repository(10)];
  assert.equal(settleDepths(ten, none, new Map(), still).shown.get("repo"), 3);
  assert.equal(settleDepths(ten, none, new Map(), { ...still, length: 0 }).shown.get("repo"), 1);
  assert.equal(
    settleDepths(ten, none, new Map(), { ...still, length: Number.MAX_SAFE_INTEGER }).shown.get(
      "repo",
    ),
    10,
  );
});

test("left alone, a fold stays where it is in history as commits arrive", () => {
  const first = settleDepths([repository(10)], none, new Map(), still);
  const next = settleDepths([repository(12)], none, first.drawn, still);
  assert.equal(next.shown.get("repo"), 5);
});

test("following, a band is cut back to its length as commits arrive", () => {
  const following = { ...still, follow: true };
  const first = settleDepths([repository(10)], none, new Map(), following);
  const next = settleDepths([repository(12)], none, first.drawn, following);
  assert.equal(next.shown.get("repo"), 3);
});

test("a repository set free keeps its place while the rest follow", () => {
  const following = { ...still, follow: true, free: new Set(["repo"]) };
  const first = settleDepths([repository(10)], none, new Map(), following);
  const next = settleDepths([repository(12)], none, first.drawn, following);
  assert.equal(next.shown.get("repo"), 5);
});

test("a length of its own is what a following band is cut back to", () => {
  const ask = { shown: 6 };
  const own = () => ({ ask, proposed: false });
  const following = { ...still, follow: true };
  const first = settleDepths([repository(10)], own, new Map(), following);
  assert.equal(first.shown.get("repo"), 6);
  assert.equal(settleDepths([repository(12)], own, first.drawn, following).shown.get("repo"), 6);
});

test("a new length moves a band that was holding its place", () => {
  const first = settleDepths([repository(10)], none, new Map(), { ...still, length: 8 });
  const next = settleDepths([repository(10)], none, first.drawn, { ...still, length: 2 });
  assert.equal(next.shown.get("repo"), 2);
});
