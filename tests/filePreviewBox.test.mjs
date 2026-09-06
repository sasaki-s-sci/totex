import assert from "node:assert/strict";
import { test } from "node:test";
import { unpinnedSize } from "../src/hooks/filePreviewBox.ts";

test("unpinning preserves screen dimensions after the canvas zoom changes", () => {
  for (const pinnedScale of [0.5, 1, 1.5]) {
    for (const zoom of [0.25, 1, 2]) {
      const node = {
        width: 420,
        height: 260,
        data: { box: { width: 360, height: 160 }, pinnedScale },
      };
      const box = unpinnedSize(node, zoom);
      assert.equal(box.width * zoom, 420 * pinnedScale);
      assert.equal(box.height * zoom, 260 * pinnedScale);
    }
  }
});

test("collapsed cards retain their expanded height when unpinned", () => {
  const node = {
    width: 420,
    data: { box: { width: 360, height: 160 }, pinnedScale: 1.5, collapsed: true },
  };
  assert.deepEqual(unpinnedSize(node, 0.75), { width: 840, height: 320 });
});
