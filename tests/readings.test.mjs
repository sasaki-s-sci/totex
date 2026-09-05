import assert from "node:assert/strict";
import { test } from "node:test";
import { setImmediate } from "node:timers/promises";
import { watchReadings } from "../src/lib/watchReadings.ts";

function source() {
  const snapshot = Promise.withResolvers();
  const listening = Promise.withResolvers();
  const finished = Promise.withResolvers();
  const order = [];
  let change;
  let end;
  return {
    snapshot,
    listening,
    finished,
    order,
    change: (value) => change(value),
    end: (id) => end(id),
    readings: {
      listen(receive) {
        order.push("listen");
        change = receive;
        return listening.promise;
      },
      exit(receive) {
        order.push("exit");
        end = receive;
        return finished.promise;
      },
      read() {
        order.push("read");
        return snapshot.promise;
      },
    },
  };
}

test("listens before reading and keeps live, restored and exit deliveries distinct", async () => {
  const held = source();
  const delivered = [];
  const stop = watchReadings(
    held.readings,
    (value) => delivered.push(["live", value]),
    (id) => delivered.push(["exit", id]),
    (value) => delivered.push(["restored", value]),
  );
  assert.deepEqual(held.order, ["listen", "exit", "read"]);
  held.change({ id: "one", value: "working" });
  held.snapshot.resolve([
    { id: "two", value: "idle" },
    { id: "three", value: null },
  ]);
  await setImmediate();
  held.end("one");
  assert.deepEqual(delivered, [
    ["live", { id: "one", value: "working" }],
    ["restored", { id: "two", value: "idle" }],
    ["restored", { id: "three", value: null }],
    ["exit", "one"],
  ]);
  stop();
});

test("cleanup ignores late readings and releases subscriptions that arrive later", async () => {
  const held = source();
  const delivered = [];
  const released = [];
  const stop = watchReadings(
    held.readings,
    (value) => delivered.push(value),
    (id) => delivered.push(id),
  );
  stop();
  held.change("late change");
  held.end("late exit");
  held.snapshot.resolve(["late snapshot"]);
  held.listening.resolve(() => released.push("readings"));
  held.finished.resolve(() => released.push("exits"));
  await setImmediate();
  assert.deepEqual(delivered, []);
  assert.deepEqual(released, ["readings", "exits"]);
});

test("snapshot failures leave live readings usable, and failed subscriptions can be cleaned up", async () => {
  const held = source();
  const delivered = [];
  const stop = watchReadings(
    held.readings,
    (value) => delivered.push(value),
    () => {},
  );
  held.snapshot.reject(new Error("backend unavailable"));
  await setImmediate();
  held.change("still live");
  assert.deepEqual(delivered, ["still live"]);
  stop();
  held.listening.reject(new Error("listener unavailable"));
  held.finished.reject(new Error("exit listener unavailable"));
  await setImmediate();
});

test("the snapshot uses the live receiver when no separate restoration is needed", async () => {
  const held = source();
  const delivered = [];
  const stop = watchReadings(
    held.readings,
    (value) => delivered.push(value),
    () => {},
  );
  held.snapshot.resolve(["one", "two"]);
  await setImmediate();
  assert.deepEqual(delivered, ["one", "two"]);
  stop();
});
