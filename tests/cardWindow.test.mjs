import assert from "node:assert/strict";
import { test } from "node:test";
import {
  cardLabel,
  corner,
  inPane,
  isCardLabel,
  onPane,
  outsideWindow,
} from "../src/lib/cardWindow.ts";

test("a card window's label says what it is, and no two are the same", () => {
  const one = cardLabel(1_700_000_000_000, 0.25);
  const two = cardLabel(1_700_000_000_000, 0.75);
  assert.ok(isCardLabel(one));
  assert.notEqual(one, two);
  assert.ok(!isCardLabel("main"));
});

test("a point is outside the window once it is past any edge", () => {
  const size = { width: 900, height: 640 };
  assert.equal(outsideWindow({ x: 0, y: 0 }, size), false);
  assert.equal(outsideWindow({ x: 899, y: 639 }, size), false);
  assert.equal(outsideWindow({ x: -1, y: 10 }, size), true);
  assert.equal(outsideWindow({ x: 10, y: -1 }, size), true);
  assert.equal(outsideWindow({ x: 900, y: 10 }, size), true);
  assert.equal(outsideWindow({ x: 10, y: 640 }, size), true);
});

test("the corner follows the pointer by the offset it was taken hold at", () => {
  assert.deepEqual(corner({ x: 500, y: 300 }, { x: 40, y: 8 }), { x: 460, y: 292 });
});

test("a screen point is said in the pane's pixels through the window and the page", () => {
  // The window's page starts at (100, 50) on screen and the pane at (288, 0) on the page.
  const at = inPane({ x: 700, y: 400 }, { x: 100, y: 50 }, { x: 288, y: 0 });
  assert.deepEqual(at, { x: 312, y: 350 });
  assert.equal(onPane(at, { width: 612, height: 640 }), true);
  assert.equal(onPane({ x: -1, y: 350 }, { width: 612, height: 640 }), false);
});
