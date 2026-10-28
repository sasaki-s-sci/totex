import assert from "node:assert/strict";
import { test } from "node:test";
import { CARRIES, pickCarried, readCarried } from "../src/shell/carried.ts";

test("only workspace places and sidebar state are carried across a program restart", () => {
  const values = {
    "window.roots": [{ kind: "repository", root: "/home/a/repo" }],
    "folders.panes": [],
    "canvas.viewport": { x: 1, y: 2, zoom: 0.5 },
    "sessions.list": [{ id: "a" }],
    "cards.layout": [["file:1", "terminal:a"]],
    "cards.height.file:1": 400,
  };
  assert.deepEqual(pickCarried(values), {
    values: {
      "window.roots": [{ kind: "repository", root: "/home/a/repo" }],
      "folders.panes": [],
    },
  });
});

test("what was carried survives the store's JSON and reads back", () => {
  const values = Object.fromEntries(CARRIES.map((key, at) => [key, at]));
  assert.deepEqual(readCarried(JSON.parse(JSON.stringify(pickCarried(values)))), values);
});

test("a cleared or foreign document carries nothing", () => {
  assert.deepEqual(readCarried(null), {});
  assert.deepEqual(readCarried("x"), {});
  assert.deepEqual(readCarried({ values: [1] }), {});
  assert.deepEqual(readCarried({ values: { "sessions.list": [] } }), {});
});

test("old graph viewport and process-local page layout are not restored", () => {
  assert.deepEqual(
    readCarried({
      values: {
        "window.foldersOpen": true,
        "canvas.viewport": { x: 1, y: 2, zoom: 0.5 },
        "cards.layout": [["file:1"]],
        "cards.height.file:1": 400,
      },
    }),
    { "window.foldersOpen": true },
  );
});
