import assert from "node:assert/strict";
import { test } from "node:test";
import { zoomed, zoomKey } from "../src/lib/zoom.ts";

test("resource zoom accepts Ctrl/Command plus, minus and reset without stealing Alt or composition", () => {
  const event = { key: "+", code: "Equal", ctrlKey: true, metaKey: false, altKey: false };
  for (const key of ["+", "="]) assert.equal(zoomKey({ ...event, key }), 1);
  assert.equal(zoomKey({ ...event, key: "-" }), -1);
  assert.equal(zoomKey({ ...event, key: "0" }), 0);
  assert.equal(zoomKey({ ...event, key: "Add", code: "NumpadAdd" }), 1);
  assert.equal(zoomKey({ ...event, key: "Subtract", code: "NumpadSubtract" }), -1);
  assert.equal(zoomKey({ ...event, ctrlKey: false, metaKey: true }), 1);
  for (const change of [{ ctrlKey: false }, { altKey: true }, { isComposing: true }, { key: "a" }])
    assert.equal(zoomKey({ ...event, ...change }), null);
  assert.equal(zoomed(zoomed(1, 1), -1), 1);
  assert.equal(zoomed(1, -1), 0.8);
  assert.equal(zoomed(8, 1), 8);
  assert.equal(zoomed(0.25, -1), 0.25);
  assert.equal(zoomed(8, 0), 1);
});
