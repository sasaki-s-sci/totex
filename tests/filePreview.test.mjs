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

test("media opens rendered while authored HTML keeps its native text view", () => {
  for (const extension of ["mp4", "m4v", "MOV", "webm"]) {
    assert.equal(openingView(`/a/movie.${extension}`), "video");
    assert.equal(previewView(`/a/movie.${extension}`), "video");
  }
  for (const extension of ["mp3", "m4a", "aac", "ogg", "oga", "opus", "wav", "FLAC"]) {
    assert.equal(openingView(`/a/song.${extension}`), "audio");
    assert.equal(previewView(`/a/song.${extension}`), "audio");
  }
  for (const extension of ["html", "HTM"]) {
    assert.equal(openingView(`/a/page.${extension}`), "text");
    assert.equal(previewView(`/a/page.${extension}`), "html");
    assert.equal(previewable(`/a/page.${extension}`), true);
  }
  for (const view of ["video", "audio", "html"]) assert.equal(drawn(view), true);
});

test("Office and excluded formats do not advertise a rendered preview", () => {
  for (const extension of [
    "docx",
    "xlsx",
    "pptx",
    "psd",
    "raw",
    "dwg",
    "step",
    "eps",
    "rar",
    "avi",
  ]) {
    assert.equal(previewable(`/a/file.${extension}`), false);
    assert.equal(openingView(`/a/file.${extension}`), "text");
  }
  assert.equal(openingView("/a/movie.mp4.txt"), "text");
});

test("tables and models/books choose their preview while preserving excluded formats", () => {
  for (const [extension, view] of [
    ["csv", "table"],
    ["TSV", "table"],
    ["gltf", "model"],
    ["GLB", "model"],
    ["obj", "model"],
    ["stl", "model"],
    ["EPUB", "epub"],
  ]) {
    const path = `/a/file.${extension}`;
    assert.equal(openingView(path), view);
    assert.equal(previewView(path), view);
    assert.equal(previewable(path), true);
    assert.equal(drawn(view), true);
  }
  for (const extension of ["zip", "heic", "tiff", "step", "docx"]) {
    assert.equal(previewable(`/a/file.${extension}`), false);
    assert.equal(openingView(`/a/file.${extension}`), "text");
  }
  assert.equal(openingView("/a/file.gltf.txt"), "text");
  assert.equal(documentView("/a/file.csv"), null);
});
