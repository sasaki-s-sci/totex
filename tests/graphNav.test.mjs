import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createServer } from "vite";

const cacheDir = await mkdtemp(join(tmpdir(), "totex-graph-nav-"));
const server = await createServer({
  configFile: false,
  cacheDir,
  server: { watch: null },
});
const { jumpable, neighbour } = await server.ssrLoadModule("/src/lib/graphNav.ts");
await server.close();
await rm(cacheDir, { recursive: true, force: true });

/** A terminal card at a place on the canvas; the geometry is what the walk must ignore. */
function cli(id, x, y) {
  return { id, type: "cli", position: { x, y }, style: { width: 100, height: 40 }, data: {} };
}

// Three terminals laid so that no geometric walk reaches them all: two level with
// one another and the third far off to one side, above the second.
const nodes = [cli("b", 800, 0), cli("a", 0, 0), cli("c", 2000, -30)];
const stacks = jumpable(nodes);

test("the numbers run down the canvas and then across", () => {
  assert.deepEqual(
    stacks.map((stack) => stack.id),
    ["c", "a", "b"],
  );
});

test("forward walks the numbers in order and wraps at the end", () => {
  assert.equal(neighbour("c", stacks, 1).id, "a");
  assert.equal(neighbour("a", stacks, 1).id, "b");
  assert.equal(neighbour("b", stacks, 1).id, "c");
});

test("back walks the numbers the other way and wraps at the start", () => {
  assert.equal(neighbour("b", stacks, -1).id, "a");
  assert.equal(neighbour("a", stacks, -1).id, "c");
  assert.equal(neighbour("c", stacks, -1).id, "b");
});

test("a walk standing on no terminal starts at either end", () => {
  assert.equal(neighbour(null, stacks, 1).id, "c");
  assert.equal(neighbour("commit", stacks, 1).id, "c");
  assert.equal(neighbour(null, stacks, -1).id, "b");
});

test("no terminals means nowhere to go", () => {
  assert.equal(neighbour(null, [], 1), null);
});
