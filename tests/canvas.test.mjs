import assert from "node:assert/strict";
import { test } from "node:test";
import {
  adjacentPane,
  insertFiles,
  paneSource,
  tileLayout,
  webAddress,
} from "../src/canvas/model.ts";

test("tiled canvases cover the entire area without overlap, including incomplete rows", () => {
  for (const aspect of [0.4, 1, 2.4])
    for (let count = 1; count <= 32; count++) {
      const { columns, rows, cells } = tileLayout(count, aspect);
      const occupied = new Set();
      for (const cell of cells)
        for (let x = cell.column; x < cell.column + cell.span; x++) {
          const key = `${x}:${cell.row}`;
          assert.ok(!occupied.has(key));
          occupied.add(key);
        }
      assert.equal(occupied.size, columns * rows);
    }
});

test("view changes protect editable files while media controls preserve the player", () => {
  const file = { id: "file", kind: "file", path: "/tmp/readme.md" };
  assert.notEqual(paneSource(file), paneSource({ ...file, view: "preview" }));
  const video = { id: "movie", kind: "video", src: "/tmp/demo.mp4" };
  assert.equal(paneSource(video), paneSource({ ...video, playback: { position: 10 } }));
});

test("arrows move spatially and stop at an edge", () => {
  assert.equal(adjacentPane(4, 0, "ArrowRight"), 1);
  assert.equal(adjacentPane(4, 0, "ArrowDown"), 2);
  assert.equal(adjacentPane(4, 1, "ArrowDown"), 3);
  assert.equal(adjacentPane(4, 0, "ArrowLeft"), 0);
  assert.equal(adjacentPane(3, 1, "ArrowDown"), 2);
});

test("a drop fills an empty pane but preserves an existing document", () => {
  const blank = { id: "blank", kind: "empty" };
  const old = { id: "old", kind: "file", path: "/old.txt" };
  const incoming = [{ id: "new", kind: "file", path: "/new.txt" }];
  assert.deepEqual(insertFiles([old, blank], incoming, "blank"), [old, ...incoming]);
  assert.deepEqual(insertFiles([old], incoming, "old"), [old, ...incoming]);
  assert.deepEqual(insertFiles([old], incoming), [old, ...incoming]);
  assert.deepEqual(insertFiles([old, blank], incoming, "old", true), [...incoming, blank]);
});

test("served pages cannot use app origins, native protocols or embedded credentials", () => {
  const origin = "http://localhost:1420";
  assert.equal(webAddress("http://localhost:3000/path", origin).origin, "http://localhost:3000");
  for (const url of [
    origin,
    "http://tauri.localhost",
    "http://ipc.localhost",
    "javascript:alert(1)",
    "data:text/html,hi",
    "file:///tmp/a.html",
    "https://user:secret@example.com",
  ]) {
    assert.throws(() => webAddress(url, origin));
  }
});
