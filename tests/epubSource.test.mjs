import assert from "node:assert/strict";
import { test } from "node:test";
import JSZip from "jszip";
import {
  internalEpubLink,
  prepareEpub,
  validateEpubZip,
} from "../src/components/nodes/preview/epubSource.ts";

async function archive(data = "hello") {
  const zip = new JSZip();
  zip.file("mimetype", "application/epub+zip");
  zip.file("chapter", data);
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}

test("EPUB accepts bounded ZIP and rejects invalid headers and excessive expansion", async () => {
  const awaited = await archive();
  assert.doesNotThrow(() => validateEpubZip(awaited));
  function invalid(bytes) {
    assert.throws(() => validateEpubZip(bytes));
  }
  invalid(new Uint8Array());
  invalid(new Uint8Array([1, 2, 3]));
  const large = await archive("a".repeat(8 * 1024 * 1024 + 1));
  invalid(large);
  const count = awaited.slice();
  new DataView(count.buffer).setUint16(count.length - 12, 2049, true);
  invalid(count);
});

test("EPUB inflation rejects lying uncompressed sizes before accumulating a giant entry", async () => {
  const bytes = await archive("a".repeat(8 * 1024 * 1024 + 1));
  const view = new DataView(bytes.buffer);
  let offset = view.getUint32(bytes.length - 6, true);
  while (view.getUint32(offset, true) === 0x02014b50) {
    const name = new TextDecoder().decode(
      bytes.subarray(offset + 46, offset + 46 + view.getUint16(offset + 28, true)),
    );
    if (name === "chapter") view.setUint32(offset + 24, 1, true);
    offset +=
      46 +
      view.getUint16(offset + 28, true) +
      view.getUint16(offset + 30, true) +
      view.getUint16(offset + 32, true);
  }
  await assert.rejects(prepareEpub(bytes, new AbortController().signal), /epub-too-large/);
});

test("book navigation accepts relative chapters but not remote, executable or protocol-relative URLs", () => {
  for (const value of ["chapter.xhtml", "../chapter.xhtml#section", "#section"])
    assert.equal(internalEpubLink(value), true);
  for (const value of [
    "https://example.com",
    "javascript:alert(1)",
    "data:text/html,x",
    "//example.com",
    "\\\\example.com",
    "java\nscript:alert(1)",
  ])
    assert.equal(internalEpubLink(value), false);
});
