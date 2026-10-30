import assert from "node:assert/strict";
import { test } from "node:test";
import { topLevelEntries } from "../src/lib/fileSelection.ts";

test("selected trees include descendants once, independent of selection order", () => {
  const folder = { path: "/work/a", isDir: true };
  const sibling = { path: "/work/ab.txt", isDir: false };
  assert.deepEqual(
    topLevelEntries([
      { path: "/work/a/child.txt", isDir: false },
      folder,
      sibling,
      { ...folder },
      { path: "/work/a/sub", isDir: true },
    ]),
    [folder, sibling],
  );
});

test("remote hosts and Windows path boundaries stay separate", () => {
  const entries = [
    { path: "ssh://one/work", isDir: true },
    { path: "ssh://two/work/file", isDir: false },
    { path: "C:\\work", isDir: true },
    { path: "C:\\worker\\file", isDir: false },
  ];
  assert.deepEqual(
    topLevelEntries([
      ...entries,
      { path: "ssh://one/work/file", isDir: false },
      { path: "C:\\work\\file", isDir: false },
    ]),
    entries,
  );
});
