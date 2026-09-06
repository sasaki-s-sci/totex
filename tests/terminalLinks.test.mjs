import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { openTerminalLink } from "../src/lib/terminalLinks.ts";

globalThis.window ??= {};
afterEach(() => clearMocks());

function click(ctrlKey = true, button = 0) {
  return {
    ctrlKey,
    button,
    preventDefault() {},
    stopPropagation() {},
  };
}

test("Ctrl+left-click opens web URLs through the desktop opener", () => {
  const opened = [];
  mockIPC((command, args) => opened.push({ command, url: args.url }));
  for (const url of ["https://example.com/path?q=1#part", "http://localhost:3000/"]) {
    openTerminalLink(click(), url);
  }
  assert.deepEqual(opened, [
    { command: "plugin:opener|open_url", url: "https://example.com/path?q=1#part" },
    { command: "plugin:opener|open_url", url: "http://localhost:3000/" },
  ]);
});

test("ordinary clicks, other mouse buttons and non-web links do not open", () => {
  const opened = [];
  mockIPC((command) => opened.push(command));
  openTerminalLink(click(false), "https://example.com/");
  openTerminalLink(click(true, 1), "https://example.com/");
  openTerminalLink(click(true, 2), "https://example.com/");
  for (const url of ["javascript:alert(1)", "file:///tmp/example", "invalid", "/relative"]) {
    openTerminalLink(click(), url);
  }
  assert.deepEqual(opened, []);
});
