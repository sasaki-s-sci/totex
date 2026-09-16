import assert from "node:assert/strict";
import { test } from "node:test";
import { byName, withFound } from "../src/sidebar/left/repoOrder.ts";

const row = (name, path = `/r/${name}`) => ({ name, path });

test("a capital does not put a repository ahead of the alphabet", () => {
  const sorted = [row("Zed"), row("abc"), row("notes"), row("Blender-mcp")].sort(byName);
  assert.deepEqual(
    sorted.map((r) => r.name),
    ["abc", "Blender-mcp", "notes", "Zed"],
  );
});

test("same-named repositories stand by path", () => {
  const sorted = [row("x", "/b/x"), row("X", "/a/X")].sort(byName);
  assert.deepEqual(
    sorted.map((r) => r.path),
    ["/a/X", "/b/x"],
  );
});

test("a repository found mid-walk takes its place among the rows", () => {
  let held = [];
  for (const name of ["notes", "Zed", "abc", "Blender"]) held = withFound(held, row(name));
  assert.deepEqual(
    held.map((r) => r.name),
    ["abc", "Blender", "notes", "Zed"],
  );
  assert.equal(withFound(held, row("abc")), held, "a row already held is left as it is");
});
