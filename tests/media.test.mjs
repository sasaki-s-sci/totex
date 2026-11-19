import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeMediaPlayback } from "../src/lib/media.ts";

test("media ranges validate before clamping to decoded duration", () => {
  assert.deepEqual(normalizeMediaPlayback({ start: 0.5, end: 8, position: 4 }, 2), {
    start: 0.5,
    end: 2,
    position: 2,
  });
  assert.deepEqual(normalizeMediaPlayback({}, 2), { start: 0, end: 2, position: 0 });
  assert.deepEqual(normalizeMediaPlayback({ start: 1, playing: true }), {
    start: 1,
    position: 1,
    playing: true,
  });
  assert.deepEqual(normalizeMediaPlayback({ start: 4, end: 8, position: 5 }, 2), {
    start: 2,
    end: 2,
    position: 2,
  });
  for (const playback of [
    { start: -1 },
    { position: Infinity },
    { end: NaN },
    { start: 1, end: 1 },
    { start: 1, position: 0 },
    { end: 1, position: 2 },
    { playing: "yes" },
  ])
    assert.throws(() => normalizeMediaPlayback(playback, 2));
});
