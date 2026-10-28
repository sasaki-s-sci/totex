import assert from "node:assert/strict";
import { test } from "node:test";
import { movePage, reconcileLayout } from "../src/cards/pageLayout.ts";

const frozen = (...rows) => Object.freeze(rows.map((row) => Object.freeze(row)));

test("reconcile keeps row order, removes closed pages and appends new pages", () => {
  const rows = frozen(["b", "a"], ["closed"], ["c", "gone"]);
  assert.deepEqual(reconcileLayout(rows, ["a", "b", "c", "d", "e"]), [
    ["b", "a"],
    ["c"],
    ["d"],
    ["e"],
  ]);
  assert.deepEqual(reconcileLayout(rows, []), []);
});

test("reconcile includes each page once even when saved rows or ids contain duplicates", () => {
  assert.deepEqual(reconcileLayout([["a", "a"], [], ["a", "b"]], ["a", "b", "c", "c"]), [
    ["a"],
    ["b"],
    ["c"],
  ]);
});

test("left and right drops create additional columns without moving other rows", () => {
  const rows = frozen(["a", "b"], ["c"], ["d", "e"]);
  assert.deepEqual(movePage(rows, "c", "b", "left"), [
    ["a", "c", "b"],
    ["d", "e"],
  ]);
  assert.deepEqual(movePage(rows, "c", "b", "right"), [
    ["a", "b", "c"],
    ["d", "e"],
  ]);
  assert.equal(movePage(rows, "c", "b", "right")[1], rows[2]);
});

test("same-row reordering uses the target position after removing the source", () => {
  const rows = frozen(["a", "b", "c", "d"]);
  assert.deepEqual(movePage(rows, "a", "c", "right"), [["b", "c", "a", "d"]]);
  assert.deepEqual(movePage(rows, "d", "b", "left"), [["a", "d", "b", "c"]]);
});

test("top and bottom drops create a row above or below the target's whole row", () => {
  const rows = frozen(["a", "b"], ["c"], ["d", "e"]);
  assert.deepEqual(movePage(rows, "c", "e", "top"), [["a", "b"], ["c"], ["d", "e"]]);
  assert.deepEqual(movePage(rows, "a", "b", "bottom"), [["b"], ["a"], ["c"], ["d", "e"]]);
  assert.deepEqual(movePage(rows, "e", "c", "top"), [["a", "b"], ["e"], ["c"], ["d"]]);
});

test("missing pages and dropping onto oneself leave the layout unchanged", () => {
  const rows = frozen(["a", "b"]);
  assert.equal(movePage(rows, "missing", "a", "left"), rows);
  assert.equal(movePage(rows, "a", "missing", "bottom"), rows);
  assert.equal(movePage(rows, "a", "a", "right"), rows);
});
