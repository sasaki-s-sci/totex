import assert from "node:assert/strict";
import { test } from "node:test";
import {
  kindOf,
  newHistory,
  remember,
  stepAhead,
  stepBack,
} from "../src/canvas/nodes/preview/history.ts";

const at = (text) => ({ text, caret: text.length });

test("typing in one burst is one step, and a pause starts another", () => {
  const history = newHistory();
  remember(history, at(""), kindOf("insertText"), 0, 10);
  remember(history, at("a"), kindOf("insertText"), 300, 10);
  remember(history, at("ab"), kindOf("insertText"), 2000, 10);
  assert.deepEqual(stepBack(history, at("abc")), at("ab"));
  assert.deepEqual(stepBack(history, at("ab")), at(""));
  assert.equal(stepBack(history, at("")), null);
});

test("deleting after typing is a step of its own, and a walk back comes forward again", () => {
  const history = newHistory();
  remember(history, at(""), kindOf("insertText"), 0, 10);
  remember(history, at("ab"), kindOf("deleteContentBackward"), 100, 10);
  assert.deepEqual(stepBack(history, at("a")), at("ab"));
  assert.deepEqual(stepAhead(history, at("ab")), at("a"));
  assert.equal(stepAhead(history, at("a")), null);
});

test("a new change drops the way forward, and only the depth is kept", () => {
  const history = newHistory();
  for (let step = 0; step < 5; step += 1) remember(history, at(String(step)), null, step, 3);
  assert.deepEqual(
    history.back.map((step) => step.text),
    ["2", "3", "4"],
  );
  stepBack(history, at("5"));
  remember(history, at("4"), null, 10, 3);
  assert.deepEqual(history.ahead, []);
});
