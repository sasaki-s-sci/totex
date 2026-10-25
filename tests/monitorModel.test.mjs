import assert from "node:assert/strict";
import { test } from "node:test";
import { HISTORY_LIMIT, isAgent, remember, shownStatus } from "../src/monitor/model.ts";

const glance = (doing, asking = false, said = "claude") => ({
  id: "t",
  doing,
  asking,
  said,
  running: null,
});
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

test("a command is running by the process table, a coding agent only while it works", () => {
  const command = { ...glance("idle", false, null), running: "npm run dev" };
  assert.equal(shownStatus(command), "running");
  // Where the process table says nothing, the screen is what there is to go by.
  assert.equal(shownStatus({ ...glance("running"), running: null }), "running");
  assert.equal(shownStatus({ ...glance("idle", false, null), running: null }), "initial");
  // A coding agent's own foreground process does not make it running.
  assert.equal(shownStatus({ ...glance("agent"), running: "claude" }), "stopped");
  assert.equal(shownStatus({ ...glance("working"), running: null }), "running");
});

test("unknown terminals and shell questions do not become coding agents", () => {
  assert.equal(isAgent(undefined), false);
  assert.equal(isAgent(glance("idle", true)), false);
  assert.equal(isAgent(glance("running", true)), false);
  assert.equal(isAgent(glance("agent", true)), true);
  assert.equal(isAgent(glance("working")), true);
  assert.equal(shownStatus(glance("agent", false, null)), "stopped");
  assert.equal(shownStatus(glance("idle", true)), "permission");
  // A previous agent's failure must not linger after returning to the shell.
  assert.equal(shownStatus(glance("idle"), snapshot(1, "failure")), "idle");
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
