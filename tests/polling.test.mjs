import assert from "node:assert/strict";
import { test } from "node:test";
import { setImmediate } from "node:timers/promises";
import { pollVisible } from "../src/lib/pollVisible.ts";

test("visible polling never overlaps and ignores completion after cleanup", async () => {
  const page = new EventTarget();
  page.hidden = false;
  const pending = Promise.withResolvers();
  let reads = 0;
  const values = [];
  const stop = pollVisible(
    () => {
      reads++;
      return pending.promise;
    },
    (v) => values.push(v),
    100,
    page,
  );
  page.dispatchEvent(new Event("visibilitychange"));
  assert.equal(reads, 1);
  stop();
  pending.resolve("late");
  await setImmediate();
  assert.deepEqual(values, []);
});

test("hidden pages pause and becoming visible refreshes immediately", async () => {
  const page = new EventTarget();
  page.hidden = true;
  let reads = 0;
  const values = [];
  const stop = pollVisible(
    async () => ++reads,
    (v) => values.push(v),
    100,
    page,
  );
  assert.equal(reads, 0);
  page.hidden = false;
  page.dispatchEvent(new Event("visibilitychange"));
  await setImmediate();
  assert.deepEqual(values, [1]);
  page.hidden = true;
  page.dispatchEvent(new Event("visibilitychange"));
  page.hidden = false;
  page.dispatchEvent(new Event("visibilitychange"));
  await setImmediate();
  assert.deepEqual(values, [1, 2]);
  stop();
});
