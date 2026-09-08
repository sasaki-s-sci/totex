import assert from "node:assert/strict";
import { test } from "node:test";
import { sourceBytes } from "../src/components/nodes/preview/documentSource.ts";
import {
  documentView,
  drawn,
  openingView,
  previewable,
  previewView,
} from "../src/lib/filePreview.ts";

test("PDF and DXF open in dedicated read-only previews, including uppercase extensions", () => {
  for (const [path, view] of [
    ["/a/design.PDF", "pdf"],
    ["/a/plan.DxF", "dxf"],
  ]) {
    assert.equal(openingView(path), view);
    assert.equal(previewView(path), view);
    assert.equal(documentView(path), view);
    assert.equal(previewable(path), true);
    assert.equal(drawn(view), true);
  }
  assert.equal(openingView("/a/file.pdf.txt"), "text");
  assert.equal(openingView("/a/image.png"), "picture");
  assert.equal(openingView("/a/image.svg"), "text");
  assert.equal(previewView("/a/readme.md"), "markdown");
});

test("whole-file preview decoding preserves binary bytes", () => {
  const bytes = Uint8Array.from([0, 255, 128, 65, 10]);
  assert.deepEqual(
    sourceBytes(`data:application/octet-stream;base64,${Buffer.from(bytes).toString("base64")}`),
    bytes,
  );
});
