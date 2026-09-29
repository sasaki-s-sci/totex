import assert from "node:assert/strict";
import { test } from "node:test";
import { movePane, slotAt } from "../src/sidebar/left/paneOrder.ts";

const panes = (...ids) => ids.map((id) => ({ id }));
const ids = (list) => list.map((pane) => pane.id);

test("a pane moves up before the one it is dropped on", () => {
  assert.deepEqual(ids(movePane(panes(1, 2, 3), 3, 0)), [3, 1, 2]);
  assert.deepEqual(ids(movePane(panes(1, 2, 3), 3, 1)), [1, 3, 2]);
});

test("a pane moves down, counting slots in the list as it stood", () => {
  assert.deepEqual(ids(movePane(panes(1, 2, 3), 1, 2)), [2, 1, 3]);
  assert.deepEqual(ids(movePane(panes(1, 2, 3), 1, 3)), [2, 3, 1]);
  assert.deepEqual(ids(movePane(panes(1, 2), 1, 99)), [2, 1]);
});

test("a drop either side of the pane itself changes nothing", () => {
  const list = panes(1, 2, 3);
  assert.equal(movePane(list, 2, 1), list);
  assert.equal(movePane(list, 2, 2), list);
  assert.equal(movePane(list, 9, 0), list);
});

test("the slot is before the first pane whose middle is below the pointer", () => {
  const boxes = [
    { top: 0, bottom: 100 },
    { top: 100, bottom: 140 },
  ];
  assert.equal(slotAt(boxes, 10), 0);
  assert.equal(slotAt(boxes, 60), 1);
  assert.equal(slotAt(boxes, 125), 2);
  assert.equal(slotAt([], 5), 0);
});
