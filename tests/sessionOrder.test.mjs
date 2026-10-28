import assert from "node:assert/strict";
import { test } from "node:test";
import { orderSessions } from "../src/lib/session.ts";

test("terminal numbering follows card order and keeps sessions whose cards have not mounted", () => {
  const sessions = ["first", "second", "third"].map((id) => ({ id, cwd: "/tmp", branch: "main" }));
  const ordered = orderSessions(sessions, ["third", "second", "third", "closed"]);
  assert.deepEqual(ordered, [sessions[2], sessions[1], sessions[0]]);
  assert.equal(orderSessions(ordered, ["third", "second", "first"]), ordered);
  assert.equal(orderSessions(sessions, []), sessions);
});
