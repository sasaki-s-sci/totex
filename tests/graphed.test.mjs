import assert from "node:assert/strict";
import { test } from "node:test";
import { graphedKey, readGraphed, readSeeds } from "../src/lib/graphed.ts";

test("a bare path from an earlier version is a folder seed", () => {
  assert.deepEqual(readSeeds(["/home/a", "C:\\repo"]), [
    { kind: "folder", path: "/home/a" },
    { kind: "folder", path: "C:\\repo" },
  ]);
});

test("a seed keeps the kind it was written with", () => {
  assert.deepEqual(
    readSeeds([
      { kind: "repository", path: "/home/a/repo" },
      { kind: "folder", path: "/home/a" },
    ]),
    [
      { kind: "repository", path: "/home/a/repo" },
      { kind: "folder", path: "/home/a" },
    ],
  );
});

test("what is not a seed is dropped and what is not a list is nothing", () => {
  assert.deepEqual(
    readSeeds([
      null,
      7,
      {},
      { kind: "folder" },
      { path: "/home/a" },
      { kind: "branch", path: "/home/a" },
      { kind: "folder", path: 3 },
      "/kept",
    ]),
    [{ kind: "folder", path: "/kept" }],
  );
  assert.deepEqual(readSeeds(undefined), []);
  assert.deepEqual(readSeeds("/home/a"), []);
  assert.deepEqual(readSeeds({ kind: "folder", path: "/home/a" }), []);
});

test("the canvas reads the same entries as roots", () => {
  assert.deepEqual(readGraphed(["/home/a", { kind: "repository", path: "/home/a/repo" }]), [
    { kind: "folder", root: "/home/a" },
    { kind: "repository", root: "/home/a/repo" },
  ]);
});

test("what the sidebar puts on the canvas comes back as it was", () => {
  const live = [
    { kind: "repository", root: "/home/a/repo/x" },
    { kind: "folder", root: "/home/a" },
  ];
  assert.deepEqual(readGraphed(live), live);
  assert.deepEqual(
    readGraphed([{ kind: "repository" }, { root: "/x" }, { kind: "folder", root: 1 }]),
    [],
  );
});

test("one directory graphed both ways has two keys", () => {
  const asFolder = graphedKey({ kind: "folder", root: "/home/a" });
  const asRepository = graphedKey({ kind: "repository", root: "/home/a" });
  assert.notEqual(asFolder, asRepository);
  assert.equal(asFolder, graphedKey({ kind: "folder", root: "/home/a" }));
  assert.notEqual(asFolder, graphedKey({ kind: "folder", root: "/home/b" }));
});
