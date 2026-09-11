import assert from "node:assert/strict";
import { test } from "node:test";
import { fileSize } from "../src/hooks/filePreviewBox.ts";

test("a card's size is the node's own once an edge has been dragged", () => {
  const node = { width: 420, height: 260, data: { box: { width: 360, height: 160 } } };
  assert.deepEqual(fileSize(node), { width: 420, height: 260 });
});

test("a card put away keeps the height it had", () => {
  const node = { width: 420, data: { box: { width: 360, height: 160 }, collapsed: true } };
  assert.deepEqual(fileSize(node), { width: 420, height: 160 });
});

test("the box is the same whatever zoom the card was pinned at", () => {
  const node = { data: { box: { width: 360, height: 160 }, pinnedScale: 0.5 } };
  assert.deepEqual(fileSize(node), { width: 360, height: 160 });
});
