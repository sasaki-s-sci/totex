import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { OPEN_PAGE, openPage } from "../src/lib/openPage.ts";
import { openTerminalLink } from "../src/lib/terminalLinks.ts";

beforeEach(() => {
  globalThis.window = new EventTarget();
  globalThis.location = new URL("http://localhost:1420");
});
afterEach(() => clearMocks());

function click(ctrlKey = true, button = 0) {
  return {
    ctrlKey,
    button,
    preventDefault() {},
    stopPropagation() {
      throw new Error("the mouseup must reach xterm's selection drag");
    },
  };
}

test("Ctrl+left-click opens a canvas page owned by its terminal without using the desktop opener", () => {
  const opened = [];
  const native = [];
  mockIPC((command) => native.push(command));
  window.addEventListener(OPEN_PAGE, (event) => {
    opened.push(event.detail);
    event.preventDefault();
  });
  for (const url of ["https://example.com/path?q=1#part", "http://localhost:3000/"]) {
    openTerminalLink(click(), url, "terminal-one");
  }
  assert.deepEqual(opened, [
    { url: "https://example.com/path?q=1#part", sessionId: "terminal-one" },
    { url: "http://localhost:3000/", sessionId: "terminal-one" },
  ]);
  assert.deepEqual(native, []);
});

test("ordinary clicks, other mouse buttons and non-web links do not open", () => {
  const opened = [];
  mockIPC((command) => opened.push(command));
  window.addEventListener(OPEN_PAGE, (event) => opened.push(event.detail));
  openTerminalLink(click(false), "https://example.com/");
  openTerminalLink(click(true, 1), "https://example.com/");
  openTerminalLink(click(true, 2), "https://example.com/");
  for (const url of [
    "javascript:alert(1)",
    "file:///tmp/example",
    "mailto:person@example.com",
    "invalid",
    "/relative",
    "http://localhost:1420/front.html",
    "http://tauri.localhost/",
    "https://ipc.localhost/",
    "https://user:password@example.com/",
  ]) {
    openTerminalLink(click(), url);
  }
  assert.deepEqual(opened, []);
});

test("page requests report whether a canvas accepted the normalized URL", () => {
  assert.equal(openPage("https://example.com"), false);
  const requests = [];
  window.addEventListener(OPEN_PAGE, (event) => {
    requests.push(event.detail);
    if (event.detail.sessionId !== "closed-terminal") event.preventDefault();
  });
  assert.equal(openPage("https://EXAMPLE.com"), true);
  assert.equal(openPage("https://example.com/", "closed-terminal"), false);
  assert.equal(openPage("data:text/html,hello"), false);
  assert.deepEqual(requests, [
    { url: "https://example.com/", sessionId: undefined },
    { url: "https://example.com/", sessionId: "closed-terminal" },
  ]);
});
