import assert from "node:assert/strict";
import { test } from "node:test";
import { placeBeside } from "../src/lib/session.ts";

const session = (id) => ({ id, cwd: "/app", branch: "main" });
const ids = (list) => list.map((session) => session.id);

test("a terminal moves just before or just after another, wherever it started", () => {
  const [a, b, c, d] = ["a", "b", "c", "d"].map(session);
  assert.deepEqual(ids(placeBeside([a, b, c, d], d, a, false)), ["d", "a", "b", "c"]);
  assert.deepEqual(ids(placeBeside([a, b, c, d], a, c, true)), ["b", "c", "a", "d"]);
  assert.deepEqual(ids(placeBeside([a, b, c, d], b, a, false)), ["b", "a", "c", "d"]);
});

test("an anchor that is not in the list leaves the list as it was", () => {
  const [a, b] = ["a", "b"].map(session);
  const list = [a, b];
  assert.equal(placeBeside(list, a, session("gone"), true), list);
});
