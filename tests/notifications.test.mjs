import assert from "node:assert/strict";
import { test } from "node:test";
import { notifications } from "../src/lib/notifications.ts";

test("notifies synchronously in subscription order and deduplicates listeners", () => {
  const { subscribe, notify } = notifications();
  const calls = [];
  const first = () => calls.push("first");
  const off = subscribe(first);
  subscribe(first);
  subscribe(() => calls.push("second"));
  notify();
  assert.deepEqual(calls, ["first", "second"]);
  off();
  off();
  notify();
  assert.deepEqual(calls, ["first", "second", "second"]);
});

test("a listener removed during delivery is not called, and other stores are independent", () => {
  const changes = notifications();
  const other = notifications();
  const calls = [];
  changes.subscribe(() => {
    calls.push("first");
    off();
  });
  const off = changes.subscribe(() => calls.push("removed"));
  other.subscribe(() => calls.push("other"));
  changes.notify();
  assert.deepEqual(calls, ["first"]);
  other.notify();
  assert.deepEqual(calls, ["first", "other"]);
});
