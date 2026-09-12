import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createServer } from "vite";

const cacheDir = await mkdtemp(join(tmpdir(), "totex-grid-"));
const server = await createServer({
  configFile: false,
  cacheDir,
  server: { watch: null },
});
const { heldToGrid, onGrid, placeOnGrid, sizeOnGrid, upToGrid } =
  await server.ssrLoadModule("/src/lib/grid.ts");
await server.close();
await rm(cacheDir, { recursive: true, force: true });

const LEAST = { width: 180, height: 96 };
const leastOf = (id) => (id === "card" ? LEAST : null);

test("a point goes to the nearest line and a length to the nearest whole step", () => {
  assert.equal(onGrid(35, 24), 24);
  assert.equal(onGrid(37, 24), 48);
  assert.equal(onGrid(-13, 24), -24);
  assert.equal(upToGrid(25, 24), 48);
  assert.equal(upToGrid(48, 24), 48);
});

test("a size is never rounded below the least the card may be", () => {
  // 180 rounds down to 168, which the edge would never have allowed.
  assert.equal(sizeOnGrid(180, 24, 180), 192);
  assert.equal(sizeOnGrid(185, 24, 180), 192);
  assert.equal(sizeOnGrid(300, 24, 180), 312);
});

test("a card opened on the grid has its corner and box on it", () => {
  assert.deepEqual(placeOnGrid({ x: 101, y: 59 }, { width: 360, height: 160 }, 24, LEAST), {
    position: { x: 96, y: 48 },
    box: { width: 360, height: 168 },
  });
});

test("a dragged card's position lands on the grid, and nothing else's does", () => {
  const changes = [
    { id: "card", type: "position", position: { x: 130, y: 70 }, dragging: true },
    { id: "head", type: "position", position: { x: 130, y: 70 }, dragging: true },
    { id: "card", type: "select", selected: true },
  ];
  const held = heldToGrid(changes, leastOf, 24);
  assert.deepEqual(held[0], {
    id: "card",
    type: "position",
    position: { x: 120, y: 72 },
    positionAbsolute: { x: 120, y: 72 },
    dragging: true,
  });
  assert.equal(held[1], changes[1]);
  assert.equal(held[2], changes[2]);
});

test("an edge dragged sets only what it set, and the canvas's own measure is left alone", () => {
  const measured = { id: "card", type: "dimensions", dimensions: { width: 301, height: 33 } };
  const both = {
    id: "card",
    type: "dimensions",
    resizing: true,
    setAttributes: true,
    dimensions: { width: 301, height: 150 },
  };
  const wide = { ...both, setAttributes: "width", dimensions: { width: 301, height: 33 } };
  const [kept, whole, across] = heldToGrid([measured, both, wide], leastOf, 24);
  assert.equal(kept, measured);
  assert.deepEqual(whole.dimensions, { width: 312, height: 144 });
  assert.deepEqual(across.dimensions, { width: 312, height: 33 });
});
