import assert from "node:assert/strict";
import { installCanvasNative } from "./fixtures/canvas-native.mjs";

export async function verifyCanvasPages(page, base = "http://127.0.0.1:18426") {
  await installCanvasNative(page);
  await page.addInitScript(() => {
    if (window.top !== window) return;
    window.canvasStates["terminal-one"].panes = [
      { id: "source", kind: "file", path: "/tmp/note.txt", title: "Notes" },
      { id: "blank", kind: "empty" },
    ];
    window.canvasStates["terminal-two"].panes = [];
    window.canvasStates["terminal-other"] = { id: "terminal-other", revision: 1, panes: [] };
    const invoke = window.__TAURI_INTERNALS__.invoke;
    window.__TAURI_INTERNALS__.invoke = async (cmd, args = {}) => {
      if (cmd === "pty_standing")
        return [
          { id: "terminal-one", doing: "running", said: "pnpm dev", running: "node vite.js" },
          {
            id: "terminal-two",
            doing: "running",
            said: "python -m http.server 9000",
            running: "python",
          },
          { id: "terminal-other", doing: "running", said: "npm start", running: "node server.js" },
        ];
      if (cmd === "plugin:clipboard-manager|write_text" && window.refuseCopy)
        throw new Error("Clipboard unavailable");
      if (cmd === "canvas_write" && window.refusePage) throw new Error("Cannot save canvas");
      return invoke(cmd, args);
    };
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${base}/tests/fixtures/pages.html?canvas&grouped&onlyterminals&terminal-resize`);
  await page.waitForFunction(() => window.pageTerminals?.size === 3);
  await page.waitForFunction(
    () => window.pageCalls.filter(({ cmd }) => cmd === "pty_attach").length >= 3,
  );
  const emit = (id, seq, data) =>
    page.evaluate(({ id, seq, data }) => window.pageEmit("pty:data", { id, seq, data }), {
      id,
      seq,
      data,
    });
  const url = "http://127.0.0.1:18424/live";
  const second = "http://127.0.0.1:18424/api";
  await emit("terminal-one", 1, "\r\n\x1b[32mLocal: http://127.0.");
  await page.waitForTimeout(350);
  assert.equal(await page.locator(".canvas-page-link").count(), 0);
  await emit("terminal-one", 2, "0.1:18424/live\x1b[0m\r\n");
  await emit("terminal-two", 1, `\r\n${second}\r\n`);
  await emit("terminal-other", 1, "\r\nhttps://elsewhere.example/\r\n");
  const blank = page.locator('[data-canvas-pane="blank"]');
  await blank.getByRole("button", { name: `Open ${url}`, exact: true }).waitFor();
  await blank.getByRole("button", { name: `Open ${second}`, exact: true }).waitFor();
  assert.equal(await blank.getByText("pnpm dev", { exact: true }).count(), 1);
  assert.equal(await blank.getByText("python -m http.server 9000", { exact: true }).count(), 1);
  assert.equal(
    await blank
      .getByRole("button", { name: `Open ${url}`, exact: true })
      .evaluate(
        (button) => document.getElementById(button.getAttribute("aria-describedby"))?.textContent,
      ),
    "pnpm dev",
  );
  assert.equal(await blank.getByText("https://elsewhere.example/").count(), 0);
  await emit("terminal-one", 3, `\r\n${url}\r\n`);
  await page.waitForTimeout(350);
  assert.equal(await blank.getByRole("button", { name: `Open ${url}`, exact: true }).count(), 1);

  await page.locator('[data-canvas-pane="source"]').click({ button: "right" });
  for (const [label, value] of [
    ["Copy name", "note.txt"],
    ["Copy path", "/tmp/note.txt"],
  ]) {
    for (const role of ["menuitem", "button"]) {
      assert.equal(
        await page
          .getByRole(role, { name: label, exact: true })
          .evaluate(
            (control) =>
              document.getElementById(control.getAttribute("aria-describedby"))?.textContent,
          ),
        value,
      );
    }
  }
  await page.getByRole("button", { name: "Copy name", exact: true }).click();
  await page.getByRole("button", { name: "Copy path", exact: true }).click();
  assert.deepEqual(
    await page.evaluate(() =>
      window.pageCalls
        .filter(({ cmd }) => cmd === "plugin:clipboard-manager|write_text")
        .map(({ args }) => args.text),
    ),
    ["note.txt", "/tmp/note.txt"],
  );
  await page.evaluate(() => {
    window.refuseCopy = true;
  });
  await page.getByRole("button", { name: "Copy path", exact: true }).click();
  await page.getByText("Could not copy. Try again.", { exact: true }).waitFor();
  await page.evaluate(() => {
    window.refuseCopy = false;
  });
  await page.keyboard.press("Escape");

  await page.evaluate(() => {
    window.refusePage = true;
  });
  await blank.getByRole("button", { name: `Open ${url}`, exact: true }).click();
  await page.getByText("Error: Cannot save canvas", { exact: true }).waitFor();
  assert.equal(await blank.count(), 1);
  await page.evaluate(() => {
    window.refusePage = false;
  });
  await blank.getByRole("button", { name: `Open ${url}`, exact: true }).click();
  await blank.waitFor({ state: "detached" });
  await page.waitForFunction(
    (url) => window.canvasStates["terminal-one"].panes.some((pane) => pane.url === url),
    url,
  );
  assert.equal(await page.locator('[data-canvas-pane="source"]').count(), 1);
  assert.equal(await page.evaluate(() => window.canvasStates["terminal-one"].panes.length), 2);

  await page.locator('[data-canvas-pane="source"]').click({ button: "right" });
  await page.getByRole("menuitem", { name: "New terminal", exact: true }).click();
  await page.waitForFunction(
    () =>
      document.querySelector('[data-terminal-shown="true"]')?.dataset.terminal !== "terminal-one",
  );
  const newId = await page.locator('[data-terminal-shown="true"]').getAttribute("data-terminal");
  const opened = await page.evaluate(
    (id) => window.pageCalls.find(({ cmd, args }) => cmd === "pty_open" && args.id === id)?.args,
    newId,
  );
  assert.equal(opened.cwd, "/tmp");
  assert.equal(JSON.parse(opened.meta).branch, "main");
  assert.equal(JSON.parse(opened.meta).folder, undefined);
  const emptyCanvas = page.locator(`[data-session-canvas="${newId}"]`);
  await emptyCanvas.getByRole("button", { name: `Open ${url}`, exact: true }).waitFor();
  assert.equal(await emptyCanvas.getByText("https://elsewhere.example/").count(), 0);
  const kept = await page.evaluate(
    async () => (await window.pageSnapshot()).values["canvas.pages"],
  );
  assert.ok(
    kept.some((entry) => entry.cwd === "/tmp" && entry.url === url && entry.command === "pnpm dev"),
  );
  return {
    copy: true,
    failures: true,
    folderPages: true,
    commandLabels: true,
    newTerminal: true,
    snapshot: true,
  };
}

export async function verifyCanvasPagesRestore(page, base = "http://127.0.0.1:18426") {
  await installCanvasNative(page);
  await page.addInitScript(() => {
    if (window.top !== window) return;
    window.canvasStates["terminal-one"].panes = [];
    window.pageBacklog = {
      text: "Retained terminal\r\nhttps://restored.example/\r\nhttps://history.example/\r\n",
      upto: 1,
    };
    const invoke = window.__TAURI_INTERNALS__.invoke;
    window.__TAURI_INTERNALS__.invoke = async (cmd, args = {}) => {
      if (cmd === "persistent_get" && args.name === "totex.relaunch")
        return {
          values: {
            "canvas.pages": [
              { cwd: "/tmp", url: "https://restored.example/", command: "pnpm preview" },
            ],
          },
        };
      if (cmd === "persistent_put" && args.name === "totex.relaunch")
        window.keptPages = args.value.values["canvas.pages"];
      return invoke(cmd, args);
    };
  });
  await page.goto(`${base}/tests/fixtures/pages.html?canvas&onlyterminals&terminal-resize&carried`);
  await page.getByRole("button", { name: "Open https://restored.example/", exact: true }).waitFor();
  await page.getByText("pnpm preview", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Open https://history.example/", exact: true }).waitFor();
  assert.equal(await page.getByText("pnpm preview", { exact: true }).count(), 1);
  await page.waitForFunction(() => window.pageCalls.some(({ cmd }) => cmd === "pty_attach"));
  await page.evaluate(() =>
    window.pageEmit("pty:data", {
      id: "terminal-one",
      seq: 1,
      data: "\r\n\x1b]8;;https://linked.example/\x07A named link\x1b]8;;\x07\r\n",
    }),
  );
  await page.getByRole("button", { name: "Open https://linked.example/", exact: true }).waitFor();
  await page.waitForFunction(() =>
    window.keptPages?.some(({ url }) => url === "https://linked.example/"),
  );
  assert.ok(
    await page.evaluate(() =>
      window.keptPages.some(({ url }) => url === "https://restored.example/"),
    ),
  );
  return { startupRestore: true, persistedUpdates: true, oscLinks: true };
}
