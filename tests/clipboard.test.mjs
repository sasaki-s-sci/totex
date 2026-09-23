import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { copyText, readClipboard } from "../src/lib/clipboard.ts";

globalThis.window ??= {};
afterEach(() => clearMocks());

test("copy writes Unicode to the native host clipboard", async () => {
  const calls = [];
  mockIPC((command, args) => calls.push({ command, args }));
  await copyText("日本語 👋\nsecond line");
  assert.deepEqual(calls, [
    {
      command: "plugin:clipboard-manager|write_text",
      args: { text: "日本語 👋\nsecond line", label: undefined },
    },
  ]);
});

test("native copy failures reach the caller", async () => {
  mockIPC(() => {
    throw new Error("clipboard unavailable");
  });
  await assert.rejects(copyText("example"), /clipboard unavailable/);
});

test("paste reads host text, including empty text, without reading images", async () => {
  for (const text of ["日本語 👋\nsecond line", ""]) {
    mockIPC((command) => {
      assert.equal(command, "plugin:clipboard-manager|read_text");
      return text;
    });
    assert.equal(await readClipboard(), text);
  }
});

test("image-only paste releases the native image resource", async () => {
  const calls = [];
  mockIPC((command, args) => {
    calls.push({ command, args });
    if (command === "plugin:clipboard-manager|read_text") throw new Error("No text");
    if (command === "plugin:clipboard-manager|read_image") return 42;
  });
  assert.equal(await readClipboard(), null);
  assert.deepEqual(calls.at(-1), { command: "plugin:resources|close", args: { rid: 42 } });
});

test("unreadable clipboard reports failure rather than sending Ctrl+V", async () => {
  mockIPC(() => {
    throw new Error("clipboard unavailable");
  });
  await assert.rejects(readClipboard(), /clipboard unavailable/);
});
