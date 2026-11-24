import assert from "node:assert/strict";
import { test } from "node:test";
import { pageCommand, pageUrls, readPages, rememberPages } from "../src/canvas/pages.ts";

const origin = "http://localhost:1420";
const page = (cwd, url, command = "pnpm dev") => ({ cwd, url, command });

test("terminal page discovery joins wrapped rows and excludes credentials and app URLs", () => {
  const lines = [
    ["Local: http://localhost:3000/very/", false],
    ["long/path?q=1#section", true],
    ["See (https://example.com/docs).", false],
    ["http://[::1]:3000/ https://example.com/a_(b)", false],
    ["http://localhost:1420/ http://tauri.localhost/ https://ipc.localhost/", false],
    ["https://user:password@example.com/ http://localhost:3000/very/long/path?q=1#section", false],
  ];
  assert.deepEqual(
    pageUrls(
      {
        length: lines.length,
        getLine: (row) => ({ isWrapped: lines[row][1], translateToString: () => lines[row][0] }),
      },
      origin,
    ),
    [
      "http://localhost:3000/very/long/path?q=1#section",
      "https://example.com/docs",
      "http://[::1]:3000/",
      "https://example.com/a_(b)",
    ],
  );
});

test("collected URLs retain their folder and command without duplicates", () => {
  const url = "http://localhost:3000/";
  const first = page("/one", url);
  const second = page("/two", url, "npm start");
  const result = rememberPages([first, second], [page("/one", url, null)]);
  assert.deepEqual(result, [first, second]);
  assert.deepEqual(rememberPages(result, [page("/one", url, "pnpm preview")]), [
    page("/one", url, "pnpm preview"),
    second,
  ]);
});

test("restored collections validate URLs and keep commands as text", () => {
  assert.deepEqual(
    readPages(
      [
        null,
        {},
        page("/one", "javascript:alert(1)"),
        page("/one", "https://example.com/", "<b>pnpm dev</b>"),
      ],
      origin,
    ),
    [page("/one", "https://example.com/", "<b>pnpm dev</b>")],
  );
  assert.deepEqual(readPages({}, origin), []);
});

test("command labels use shell commands and never store coding-agent prompts", () => {
  assert.equal(
    pageCommand({ doing: "running", said: "pnpm dev", running: "node server.js" }),
    "pnpm dev",
  );
  assert.equal(
    pageCommand({ doing: "agent", said: "private conversation", running: "codex --resume id" }),
    null,
  );
  assert.equal(
    pageCommand({ doing: "running", said: null, running: "node server.js" }),
    "node server.js",
  );
  assert.equal(pageCommand({ doing: "idle", said: null, running: null }), null);
  assert.equal(pageCommand(undefined), null);
});
