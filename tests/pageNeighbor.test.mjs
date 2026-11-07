import assert from "node:assert/strict";
import { test } from "node:test";
import { horizontalNeighbor } from "../src/page/neighbor.ts";

const box = (id, left, top, width = 100, height = 100) => ({
  id,
  left,
  right: left + width,
  top,
  bottom: top + height,
});

test("left and right follow geometry regardless of registration order", () => {
  const left = box("left", 0, 0);
  const middle = box("middle", 120, 0);
  const right = box("right", 240, 0);
  const cards = Object.freeze([right, left]);
  assert.equal(horizontalNeighbor(middle, cards, "left"), left);
  assert.equal(horizontalNeighbor(middle, cards, "right"), right);
  assert.equal(horizontalNeighbor(left, [right, middle], "right"), middle);
});

test("stacked cards and the opposite edge never become horizontal destinations", () => {
  const source = box("source", 0, 120);
  const stacked = [box("above", 0, 0), box("below", 0, 240)];
  assert.equal(horizontalNeighbor(source, stacked, "left"), undefined);
  assert.equal(horizontalNeighbor(source, stacked, "right"), undefined);
  assert.equal(horizontalNeighbor(source, [box("right", 120, 120)], "left"), undefined);
});

test("the same visual row wins over a closer column in a different row", () => {
  const source = box("source", 0, 0);
  const sameRow = box("same row", 240, 20);
  assert.equal(horizontalNeighbor(source, [box("lower", 120, 140), sameRow], "right"), sameRow);
});

test("unequal heights pick the nearest vertical center in the adjacent column", () => {
  const source = box("source", 0, 0, 100, 400);
  const middle = box("middle", 120, 150);
  assert.equal(
    horizontalNeighbor(source, [box("top", 120, 0), box("bottom", 120, 300), middle], "right"),
    middle,
  );
});

test("empty hosts are skipped and fractional borders do not block an adjacent card", () => {
  const source = box("source", 0, 0);
  const next = box("next", 99.5, 0);
  assert.equal(horizontalNeighbor(source, [box("hidden", 100, 0, 0), next], "right"), next);
});
