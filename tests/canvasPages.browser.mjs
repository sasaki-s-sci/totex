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
    window.pageStandings = [
      { id: "terminal-one", doing: "running", said: "pnpm dev", running: "node vite.js" },
      {
        id: "terminal-two",
        doing: "running",
        said: "python -m http.server 9000",
        running: "python",
      },
      { id: "terminal-other", doing: "running", said: "npm start", running: "node server.js" },
    ];
    const invoke = window.__TAURI_INTERNALS__.invoke;
    window.__TAURI_INTERNALS__.invoke = async (cmd, args = {}) => {
      if (cmd === "pty_standing") {
        if (window.refuseStanding) throw new Error("Status unavailable");
        return window.pageStandings;
      }
      if (cmd === "plugin:clipboard-manager|write_text" && window.refuseCopy)
        throw new Error("Clipboard unavailable");
      if (cmd === "plugin:opener|open_url" && window.refuseBrowser)
        throw new Error("Browser unavailable");
      if (cmd === "canvas_write" && window.refusePage) throw new Error("Cannot open canvas page");
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
  const otherCanvas = page.locator('[data-session-canvas="terminal-two"]');
  await otherCanvas.getByText(second, { exact: true }).waitFor({ state: "attached" });
  assert.equal(await blank.getByText("pnpm dev", { exact: true }).count(), 1);
  assert.equal(await blank.getByText(second, { exact: true }).count(), 0);
  assert.equal(await otherCanvas.getByText(url, { exact: true }).count(), 0);
  assert.equal(
    await otherCanvas.getByText("python -m http.server 9000", { exact: true }).count(),
    1,
  );
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

  let seq = 3;
  const ignored = [];
  for (const [doing, running] of [
    ["agent", "codex"],
    ["working", "claude"],
    ["agent", "opencode"],
    ["idle", null],
    ["running", "unreadable"],
  ]) {
    await page.evaluate(
      ({ doing, running }) => {
        window.refuseStanding = running === "unreadable";
        window.pageStandings[0] = { id: "terminal-one", doing, said: null, running };
      },
      { doing, running },
    );
    const ignoredUrl = `https://${running ?? "unknown"}.example/`;
    ignored.push(ignoredUrl);
    await emit("terminal-one", ++seq, `\r\n${ignoredUrl}\r\n`);
    await page.waitForTimeout(650);
  }
  await page.evaluate(() => {
    window.refuseStanding = false;
    window.pageStandings[0] = {
      id: "terminal-one",
      doing: "running",
      said: "pnpm dev",
      running: "node vite.js",
    };
  });
  await emit("terminal-one", ++seq, "\r\nhttps://known.example/\r\n");
  await blank.getByText("https://known.example/", { exact: true }).waitFor();
  const collected = await page.evaluate(
    async () => (await window.pageSnapshot()).values["canvas.pages"],
  );
  for (const ignoredUrl of ignored) {
    assert.equal(await blank.getByText(ignoredUrl, { exact: true }).count(), 0);
    assert.equal(
      collected.some(({ url }) => url === ignoredUrl),
      false,
    );
  }

  await emit("terminal-one", ++seq, `\r\n${ignored[0]}\r\n`);
  await blank.getByText(ignored[0], { exact: true }).waitFor();
  const repeated = await page.evaluate(
    async () => (await window.pageSnapshot()).values["canvas.pages"],
  );
  assert.equal(repeated.find(({ url }) => url === ignored[0]).command, "pnpm dev");
  assert.equal(await blank.getByText(ignored[1], { exact: true }).count(), 0);
  await emit("terminal-one", ++seq, `\r\n\x1b]8;;${ignored[1]}\x07Named link\x1b]8;;\x07\r\n`);
  await blank.getByText(ignored[1], { exact: true }).waitFor();

  await page.locator('[data-canvas-pane="source"]').focus();
  await page.keyboard.press("Shift+F10");
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
  await page.getByText("Error: Cannot open canvas page", { exact: true }).waitFor();
  assert.equal(await blank.count(), 1);
  await page.evaluate(() => {
    window.refusePage = false;
  });
  await blank.getByRole("button", { name: `Open ${url}`, exact: true }).click();
  await page.waitForFunction(
    (url) =>
      window.canvasStates["terminal-one"].panes.some(
        (pane) => pane.kind === "iframe" && pane.url === url,
      ),
    url,
  );
  await page
    .frameLocator(".canvas-frame")
    .frameLocator("iframe")
    .getByRole("heading", { name: "Development preview" })
    .waitFor();
  assert.equal(await blank.count(), 0);
  assert.equal(await page.locator('[data-canvas-pane="source"]').count(), 1);
  assert.equal(await page.evaluate(() => window.canvasStates["terminal-one"].panes.length), 2);
  assert.equal(
    await page.evaluate(() => window.pageCalls.some(({ cmd }) => cmd === "plugin:opener|open_url")),
    false,
  );
  assert.equal(await page.getByRole("button", { name: "New page", exact: true }).count(), 0);
  await page.locator('[data-canvas-pane="source"]').focus();
  await page.keyboard.press("Shift+F10");
  await page.getByRole("menuitem", { name: "Add pane", exact: true }).click();
  await page.waitForFunction(() => window.canvasStates["terminal-one"].panes.length === 3);
  assert.equal(await page.evaluate(() => window.canvasStates["terminal-two"].panes.length), 0);

  await page.locator('[data-canvas-pane="source"]').focus();
  await page.keyboard.press("Shift+F10");
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
  const emptyCanvas = page.locator('[data-session-canvas="terminal-one"]');
  assert.equal(JSON.parse(opened.meta).canvas, "terminal-one");
  await emptyCanvas.getByRole("button", { name: `Open ${url}`, exact: true }).waitFor();
  await page.evaluate((id) => {
    window.pageStandings.push({
      id,
      doing: "running",
      said: "pnpm preview",
      running: "node vite.js",
    });
  }, newId);
  await emit(newId, 1, `\r\n${url}\r\n`);
  await emptyCanvas.getByText("pnpm preview", { exact: true }).waitFor();
  assert.equal(
    await emptyCanvas.getByRole("button", { name: `Open ${url}`, exact: true }).count(),
    2,
  );
  assert.equal(await otherCanvas.getByText(url, { exact: true }).count(), 0);
  assert.equal(await emptyCanvas.getByText("https://elsewhere.example/").count(), 0);
  const kept = await page.evaluate(
    async () => (await window.pageSnapshot()).values["canvas.pages"],
  );
  assert.ok(
    kept.some(
      (entry) =>
        entry.sessionId === "terminal-one" && entry.url === url && entry.command === "pnpm dev",
    ),
  );
  const firstGroup = emptyCanvas.getByRole("region", { name: "Terminal 1", exact: true });
  const secondGroup = emptyCanvas.getByRole("region", { name: "Terminal 2", exact: true });
  assert.equal(await firstGroup.getByText("pnpm preview", { exact: true }).count(), 0);
  assert.equal(await secondGroup.getByText("pnpm dev", { exact: true }).count(), 0);
  assert.deepEqual(await emptyCanvas.locator(".canvas-page-group h2").allTextContents(), [
    "Terminal 1",
    "Terminal 2",
  ]);
  const collectedLink = secondGroup.getByRole("button", { name: `Open ${url}`, exact: true });
  await collectedLink.click({ button: "right" });
  assert.deepEqual(await page.getByRole("menuitem").allTextContents(), [
    "Open URL in canvas",
    "Open URL in browser",
    "Copy URL",
  ]);
  await page.getByRole("menuitem", { name: "Copy URL", exact: true }).click();
  assert.equal(
    await page.evaluate(
      () =>
        window.pageCalls.filter(({ cmd }) => cmd === "plugin:clipboard-manager|write_text").at(-1)
          .args.text,
    ),
    url,
  );
  await page.evaluate(() => {
    window.refuseCopy = true;
  });
  await collectedLink.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Copy URL", exact: true }).click();
  await emptyCanvas.getByRole("alert").filter({ hasText: "Could not copy." }).waitFor();
  await page.evaluate(() => {
    window.refuseCopy = false;
  });
  const beforeExternal = await page.evaluate(() => window.canvasStates["terminal-one"].panes);
  await page.evaluate(() => {
    window.refuseBrowser = true;
  });
  await collectedLink.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Open URL in browser", exact: true }).click();
  await emptyCanvas.getByRole("alert").filter({ hasText: "Could not open the link" }).waitFor();
  await page.evaluate(() => {
    window.refuseBrowser = false;
  });
  await collectedLink.focus();
  await page.keyboard.press("Shift+F10");
  await page.getByRole("menuitem", { name: "Open URL in browser", exact: true }).click();
  assert.equal(
    await page.evaluate(
      () => window.pageCalls.filter(({ cmd }) => cmd === "plugin:opener|open_url").at(-1).args.url,
    ),
    url,
  );
  assert.deepEqual(
    await page.evaluate(() => window.canvasStates["terminal-one"].panes),
    beforeExternal,
  );
  await collectedLink.click({ button: "right" });
  await page.keyboard.press("Control+3");
  await page.getByRole("menu").waitFor({ state: "hidden" });
  await page.keyboard.press("Control+2");
  await collectedLink.waitFor();
  assert.equal(await page.getByRole("menu").count(), 0, "Hidden canvases close their URL menu");
  await collectedLink.focus();
  await page.keyboard.press("Shift+F10");
  await page.getByRole("menuitem", { name: "Open URL in canvas", exact: true }).click();
  await page.waitForFunction(() =>
    window.canvasStates["terminal-one"].panes.every((pane) => pane.kind !== "empty"),
  );
  assert.equal(await otherCanvas.getByText(url, { exact: true }).count(), 0);
  return {
    copy: true,
    failures: true,
    sessionPages: true,
    knownCommandsOnly: true,
    commandLabels: true,
    newTerminal: true,
    contextMenuAddPane: true,
    embeddedByDefault: true,
    snapshot: true,
    terminalGroups: true,
    urlMenu: true,
    keyboardUrlMenu: true,
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
              {
                sessionId: "terminal-one",
                url: "https://restored.example/",
                command: "pnpm preview",
              },
              { cwd: "/tmp", url: "https://legacy.example/", command: "pnpm preview" },
              { sessionId: "terminal-one", url: "https://unknown.example/", command: null },
              { sessionId: "closed-terminal", url: "https://closed.example/", command: "pnpm dev" },
            ],
          },
        };
      if (cmd === "persistent_put" && args.name === "totex.relaunch")
        window.keptPages = args.value.values["canvas.pages"];
      if (cmd === "pty_standing")
        return [
          { id: "terminal-one", doing: "running", said: "pnpm dev", running: "node vite.js" },
        ];
      return invoke(cmd, args);
    };
  });
  await page.goto(`${base}/tests/fixtures/pages.html?canvas&onlyterminals&terminal-resize&carried`);
  await page.getByRole("button", { name: "Open https://restored.example/", exact: true }).waitFor();
  await page.getByText("pnpm preview", { exact: true }).waitFor();
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
  for (const name of ["history", "legacy", "unknown", "closed"]) {
    assert.equal(
      await page
        .locator(".canvas-pages")
        .getByText(`https://${name}.example/`, { exact: true })
        .count(),
      0,
    );
  }
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
