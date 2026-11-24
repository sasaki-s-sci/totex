import assert from "node:assert/strict";
import { test } from "node:test";
import {
  dockSplit,
  dropEdge,
  fitSplit,
  gridBoundaries,
  insertSplit,
  paneGrid,
  readLayouts,
  reconcileSplit,
  splitRects,
  tileSplit,
} from "../src/canvas/layout.ts";
import { adjacentPane } from "../src/canvas/model.ts";

const ids = ["a", "b", "c", "d"];
const initial = tileSplit(ids, 1);

test("new files split the canvas or a target on every edge without replacing content", () => {
  for (const edge of ["left", "right", "top", "bottom"]) {
    for (const target of [undefined, "b"]) {
      const next = insertSplit(initial, "new", edge, target);
      coversCanvas(next, [...ids, "new"]);
      const rect = splitRects(next).new;
      assert.equal(rect.width * rect.height, target ? 0.125 : 0.5);
    }
    assert.equal(insertSplit(null, "new", edge), "new");
    assert.equal(insertSplit(initial, "a", edge), initial);
    coversCanvas(insertSplit(initial, "new", edge, "removed"), [...ids, "new"]);
  }
});

function coversCanvas(tree, expected = ids) {
  const rects = splitRects(tree);
  assert.deepEqual(Object.keys(rects).sort(), [...expected].sort());
  assert.ok(
    Math.abs(Object.values(rects).reduce((area, rect) => area + rect.width * rect.height, 0) - 1) <
      1e-9,
  );
  const grid = paneGrid(tree, expected, 1);
  const occupied = new Set();
  for (const cell of grid.cells) {
    for (let x = cell.column; x < cell.column + cell.span; x++) {
      for (let y = cell.row; y < cell.row + cell.rowSpan; y++) {
        const key = `${x}:${y}`;
        assert.ok(!occupied.has(key), `Overlapping grid cell ${key}`);
        occupied.add(key);
      }
    }
  }
  assert.equal(occupied.size, grid.columns * grid.rows);
}

test("edge docking creates half-screen panes on all four sides without losing content", () => {
  for (const edge of ["left", "right", "top", "bottom"]) {
    const next = dockSplit(initial, "c", edge);
    coversCanvas(next);
    const rect = splitRects(next).c;
    assert.equal(rect.width * rect.height, 0.5);
    if (edge === "left" || edge === "right") {
      assert.equal(rect.height, 1);
      assert.equal(rect.left, edge === "left" ? 0 : 0.5);
    } else {
      assert.equal(rect.width, 1);
      assert.equal(rect.top, edge === "top" ? 0 : 0.5);
    }
  }
  assert.equal(dockSplit(initial, "a", "left", "a"), initial);
  assert.equal(dockSplit(initial, "missing", "left"), initial);
  assert.equal(dockSplit(initial, "a", "left", "missing"), initial);
  assert.equal(dockSplit("a", "a", "left"), "a");
});

test("pane edges support nested splits, spanning panes and spatial keyboard movement", () => {
  const half = dockSplit(tileSplit(["a", "b", "c"], 1), "a", "left");
  const split = dockSplit(half, "c", "top", "b");
  assert.deepEqual(splitRects(split), {
    a: { left: 0, top: 0, width: 0.5, height: 1 },
    c: { left: 0.5, top: 0, width: 0.5, height: 0.5 },
    b: { left: 0.5, top: 0.5, width: 0.5, height: 0.5 },
  });
  coversCanvas(split, ["a", "b", "c"]);
  const grid = paneGrid(split, ["a", "b", "c"], 1);
  assert.deepEqual(
    gridBoundaries(grid).filter((grip) => grip.axis === "rows"),
    [{ axis: "rows", boundary: 1, start: 1, end: 2 }],
  );
  assert.equal(adjacentPane(3, 2, "ArrowDown", 1, grid), 1);
  assert.equal(adjacentPane(3, 1, "ArrowLeft", 1, grid), 0);
  assert.equal(adjacentPane(3, 0, "ArrowLeft", 1, grid), 0);
});

test("swaps, replacements, removals and additions keep the remaining layout usable", () => {
  const tree = dockSplit(initial, "c", "left");
  const original = splitRects(tree);
  const swapped = reconcileSplit(tree, ids, ["b", "a", "c", "d"]);
  assert.deepEqual(splitRects(swapped).a, original.b);
  assert.deepEqual(splitRects(swapped).b, original.a);
  const replaced = reconcileSplit(tree, ids, ["a", "b", "new", "d"]);
  assert.deepEqual(splitRects(replaced).new, original.c);
  coversCanvas(reconcileSplit(tree, ids, ["a", "b", "d"]), ["a", "b", "d"]);
  coversCanvas(reconcileSplit(tree, ids, [...ids, "new"]), [...ids, "new"]);
  assert.equal(reconcileSplit(tree, ids, []), null);
});

test("snapping uses the current resized proportions of unaffected panes", () => {
  const resized = fitSplit(initial, {
    a: { left: 0, top: 0, width: 0.7, height: 0.6 },
    b: { left: 0.7, top: 0, width: 0.3, height: 0.6 },
    c: { left: 0, top: 0.6, width: 0.7, height: 0.4 },
    d: { left: 0.7, top: 0.6, width: 0.3, height: 0.4 },
  });
  const next = dockSplit(resized, "a", "left");
  coversCanvas(next);
  const rects = splitRects(next);
  assert.ok(Math.abs(rects.c.width / rects.d.width - 7 / 3) < 1e-9);
});

test("stored layouts validate shape, unique IDs and finite ratios", () => {
  assert.deepEqual(readLayouts(JSON.parse(JSON.stringify({ terminal: initial }))), {
    terminal: initial,
  });
  for (const value of [null, [], "wrong"]) assert.deepEqual(readLayouts(value), {});
  for (const ratio of [0, 1, Infinity, NaN, "0.5"]) {
    assert.deepEqual(readLayouts({ bad: { axis: "columns", first: "a", second: "b", ratio } }), {});
  }
  assert.deepEqual(readLayouts({ bad: { axis: "rows", first: "a", second: "a", ratio: 0.5 } }), {});
  const degenerate = { axis: "columns", first: "a", second: "b", ratio: 1e-300 };
  assert.ok(paneGrid(degenerate, ["a", "b"], 1).cells.every((cell) => cell.span > 0));
});

test("drop targets distinguish edges, corners, margins and the swap area", () => {
  assert.equal(dropEdge(1, 50, 100, 100), "left");
  assert.equal(dropEdge(99, 50, 100, 100), "right");
  assert.equal(dropEdge(50, 1, 100, 100), "top");
  assert.equal(dropEdge(50, 99, 100, 100), "bottom");
  assert.equal(dropEdge(-20, 50, 100, 100), "left");
  assert.equal(dropEdge(50, 50, 100, 100), null);
  assert.equal(dropEdge(5, 10, 20, 20), "left");
});
