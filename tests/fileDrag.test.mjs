import assert from "node:assert/strict";
import { test } from "node:test";
import {
  FILE_DRAG_TYPE,
  FILES_DRAG_TYPE,
  hasFileDrag,
  readFileDrag,
  writeFileDrag,
} from "../src/lib/filePreview.ts";

function transfer() {
  const data = new Map();
  return {
    get types() {
      return [...data.keys()];
    },
    getData: (type) => data.get(type) ?? "",
    setData: (type, value) => data.set(type, value),
  };
}

test("mixed file and folder drags retain the selection without repeating descendants", () => {
  const data = transfer();
  writeFileDrag(data, [
    { path: "/work/folder/child.txt", isDir: false },
    { path: "/work/folder", isDir: true },
    { path: "/work/other.txt", isDir: false },
  ]);
  assert.equal(hasFileDrag(data), true);
  assert.equal(data.effectAllowed, "copy");
  assert.deepEqual(readFileDrag(data), [
    { path: "/work/folder", isDir: true },
    { path: "/work/other.txt", isDir: false },
  ]);
  assert.equal(data.getData(FILE_DRAG_TYPE), "");
});

test("single-file drags preserve the existing preview format", () => {
  const data = transfer();
  writeFileDrag(data, [{ path: "/work/note.txt", isDir: false }]);
  assert.equal(data.getData(FILE_DRAG_TYPE), "/work/note.txt");
  const legacy = transfer();
  legacy.setData(FILE_DRAG_TYPE, "/work/old.txt");
  assert.deepEqual(readFileDrag(legacy), [{ path: "/work/old.txt", isDir: false }]);
});

test("malformed multi-entry payloads never fall back to a different operation", () => {
  for (const value of ["broken", "null", "{}", '[{"path":"/a"}]', '[{"path":"","isDir":false}]']) {
    const data = transfer();
    data.setData(FILES_DRAG_TYPE, value);
    data.setData(FILE_DRAG_TYPE, "/work/old.txt");
    assert.deepEqual(readFileDrag(data), []);
  }
});
