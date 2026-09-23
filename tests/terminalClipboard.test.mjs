import assert from "node:assert/strict";
import { test } from "node:test";
import { registerTerminalClipboard } from "../src/lib/terminalClipboard.ts";

function fixture(copy) {
  const writes = [];
  const errors = [];
  let handler;
  let active = true;
  const terminal = {
    parser: {
      registerOscHandler(identifier, callback) {
        assert.equal(identifier, 52);
        handler = callback;
        return {
          dispose: () => {
            handler = undefined;
          },
        };
      },
    },
  };
  const registration = registerTerminalClipboard(
    terminal,
    copy ??
      (async (text) => {
        writes.push(text);
      }),
    (error) => {
      errors.push(error);
    },
    () => active,
  );
  return {
    writes,
    errors,
    receive: (data) => handler?.(data),
    setActive: (value) => {
      active = value;
    },
    dispose: () => registration.dispose(),
  };
}

test("OSC 52 copies UTF-8, default selections, unpadded base64, and empty text", () => {
  const f = fixture();
  const text = "\uFEFF日本語 👋\nsecond line";
  assert.equal(f.receive(`c;${Buffer.from(text).toString("base64")}`), true);
  f.receive(";aGk=");
  f.receive("c;aGk");
  f.receive("c;");
  assert.deepEqual(f.writes, [text, "hi", "hi", ""]);
  assert.deepEqual(f.errors, []);
});

test("queries and unsupported selections are consumed without clipboard access", () => {
  const f = fixture();
  for (const data of ["c;?", ";?", "p;aGk=", "s;aGk=", "cp;aGk=", "missing separator"]) {
    assert.equal(f.receive(data), true);
  }
  assert.deepEqual(f.writes, []);
  assert.deepEqual(f.errors, []);
});

test("invalid base64, invalid UTF-8, and excessive payloads never overwrite the clipboard", () => {
  const f = fixture();
  for (const payload of ["%", "a", "aGk==", "a Gk=", "aGl=", "/w==", "A".repeat(1024 * 1024 + 1)]) {
    assert.equal(f.receive(`c;${payload}`), true);
  }
  assert.deepEqual(f.writes, []);
  assert.equal(f.errors.length, 7);
  f.receive("c;aGk=");
  assert.deepEqual(f.writes, ["hi"]);
});

test("inactive sessions ignore writes and the returned registration is disposable", () => {
  const f = fixture();
  f.setActive(false);
  f.receive("c;aGk=");
  f.setActive(true);
  f.receive("c;aGk=");
  f.dispose();
  f.receive("c;aGk=");
  assert.deepEqual(f.writes, ["hi"]);
});

test("pending writes do not suspend parsing and rejected writes report errors", async () => {
  let reject;
  const failure = new Error("clipboard unavailable");
  const f = fixture(
    () =>
      new Promise((_, rejectWrite) => {
        reject = rejectWrite;
      }),
  );
  assert.equal(f.receive("c;aGk="), true);
  reject(failure);
  await Promise.resolve();
  assert.deepEqual(f.errors, [failure]);
});

test("synchronous clipboard failures are reported without interrupting parsing", () => {
  const failure = new Error("clipboard unavailable");
  const f = fixture(() => {
    throw failure;
  });
  assert.equal(f.receive("c;aGk="), true);
  assert.deepEqual(f.errors, [failure]);
});
