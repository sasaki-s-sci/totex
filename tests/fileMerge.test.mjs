import assert from "node:assert/strict";
import { test } from "node:test";
import { carried, merge } from "../src/canvas/nodes/preview/merge.ts";

const base = "one\ntwo\nthree\nfour\n";

test("an edit on one side only is that side", () => {
  assert.equal(merge(base, base, "one\n2\nthree\nfour\n"), "one\n2\nthree\nfour\n");
  assert.equal(merge(base, "one\n2\nthree\nfour\n", base), "one\n2\nthree\nfour\n");
});

test("edits apart from each other are both kept, whichever comes first", () => {
  const ours = "ONE\ntwo\nthree\nfour\n";
  const theirs = "one\ntwo\nthree\nFOUR\n";
  assert.equal(merge(base, ours, theirs), "ONE\ntwo\nthree\nFOUR\n");
  assert.equal(merge(base, theirs, ours), "ONE\ntwo\nthree\nFOUR\n");
});

test("typing at the end while the top is rewritten keeps both", () => {
  assert.equal(
    merge(base, `${base}five\n`, "zero\none\ntwo\nthree\nfour\n"),
    "zero\none\ntwo\nthree\nfour\nfive\n",
  );
});

test("the same edit on both sides is taken once", () => {
  const both = "one\ntwo\n3\nfour\n";
  assert.equal(merge(base, both, both), both);
});

test("edits that meet are refused", () => {
  assert.equal(merge(base, "one\nTWO\nthree\nfour\n", "one\ntwo!\nthree\nfour\n"), null);
  // Touching is meeting: which of the two goes first cannot be told.
  assert.equal(merge("ab", "aXb", "aYb"), null);
});

test("a caret is carried past what was written ahead of it, and left before what came after", () => {
  assert.equal(carried(5, base, `zero\n${base}`), 10);
  assert.equal(carried(5, base, `${base}five\n`), 5);
  // Inside what was replaced, it stands at the end of what replaced it.
  assert.equal(carried(5, base, "one\nTWO!\nthree\nfour\n"), 8);
});
