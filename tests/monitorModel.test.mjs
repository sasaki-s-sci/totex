import assert from "node:assert/strict";
import { test } from "node:test";
import { HISTORY_LIMIT, remember, shownStatus } from "../src/monitor/model.ts";

const glance = (doing, asking = false, said = "claude") => ({ id: "t", doing, asking, said });
const snapshot = (updatedAt, status = "running") => ({
  updatedAt,
  status,
  taskSummary: `task ${updatedAt}`,
  requestSummary: null,
  error: null,
});

test("status comes off the screen, failure off the observer", () => {
  assert.equal(shownStatus(glance("agent", true)), "permission");
  assert.equal(shownStatus(glance("working")), "running");
  assert.equal(shownStatus(glance("agent"), snapshot(1, "failure")), "failure");
  assert.equal(shownStatus(glance("working"), snapshot(1, "failure")), "running");
  assert.equal(shownStatus(glance("idle", false, null)), "initial");
  assert.equal(shownStatus(glance("idle")), "idle");
  assert.equal(shownStatus(undefined, snapshot(1, "success")), "success");
});

test("history keeps each report once, newest first, bounded", () => {
  let history = [];
  history = remember(history, snapshot(1));
  const same = remember(history, snapshot(1));
  assert.equal(same, history);
  assert.equal(remember(history, snapshot(0)), history);
  for (let at = 2; at < HISTORY_LIMIT + 10; at++) history = remember(history, snapshot(at));
  assert.equal(history.length, HISTORY_LIMIT);
  assert.equal(history[0].text, `task ${HISTORY_LIMIT + 9}`);
});
