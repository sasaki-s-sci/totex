import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createServer } from "vite";

const cacheDir = await mkdtemp(join(tmpdir(), "totex-graph-curve-"));
const server = await createServer({
  configFile: false,
  cacheDir,
  server: { watch: null },
});
const { samplesOf, midpointOf } = await server.ssrLoadModule("/src/lib/graph/geometry.ts");
await server.close();
await rm(cacheDir, { recursive: true, force: true });

const SHAPES = [
  { source: { x: 0, y: 0 }, target: { x: 120, y: 80 } },
  { source: { x: 0, y: 0 }, target: { x: 120, y: -80 } },
  { source: { x: 0, y: 0 }, target: { x: 40, y: 300 } },
  { source: { x: 0, y: 0 }, target: { x: 300, y: 10 } },
];

test("a curve turns one way from source to target (no inflection)", () => {
  for (const { source, target } of SHAPES) {
    const run = samplesOf(source, target, "curve");
    const turns = [];
    for (let index = 2; index + 3 < run.length; index += 2) {
      const ax = run[index] - run[index - 2];
      const ay = run[index + 1] - run[index - 1];
      const bx = run[index + 2] - run[index];
      const by = run[index + 3] - run[index + 1];
      turns.push(Math.sign(ax * by - ay * bx));
    }
    const sign = turns.find((turn) => turn !== 0);
    assert.ok(sign !== undefined);
    assert.ok(
      turns.every((turn) => turn === 0 || turn === sign),
      JSON.stringify(turns),
    );
  }
});

test("samples start and end on the endpoints", () => {
  for (const { source, target } of SHAPES) {
    const run = samplesOf(source, target, "curve");
    assert.deepEqual(run.slice(0, 2), [source.x, source.y]);
    assert.deepEqual(run.slice(-2), [target.x, target.y]);
  }
});

test("the midpoint lies on the sampled curve", () => {
  for (const { source, target } of SHAPES) {
    const run = samplesOf(source, target, "curve");
    const mid = midpointOf(source, target, "curve");
    const near = Math.min(
      ...Array.from({ length: run.length / 2 }, (_, index) =>
        Math.hypot(run[index * 2] - mid.x, run[index * 2 + 1] - mid.y),
      ),
    );
    assert.ok(near < 1, `midpoint ${near}px off the curve`);
  }
});
