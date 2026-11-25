import assert from "node:assert/strict";
import { installCanvasNative } from "./fixtures/canvas-native.mjs";

export async function verifyCanvasFolderShortcut(page, base = "http://127.0.0.1:18426") {
  await installCanvasNative(page);
  await page.goto(`${base}/tests/fixtures/pages.html?canvas&grouped&onlyterminals`);
  const terminal = page.locator('[data-terminal-shown="true"] .xterm-helper-textarea');
  const chooser = page.getByRole("menu", { name: "New canvas", exact: true });
  await terminal.focus();
  await page.keyboard.down("Control");
  await page.keyboard.down("Shift");
  await chooser.waitFor();
  assert.equal(await terminal.evaluate((element) => element === document.activeElement), true);
  assert.equal(await chooser.locator(".Mui-selected").innerText(), "/tmp");
  for (const [key, folder] of [
    ["ArrowDown", "/elsewhere"],
    ["ArrowLeft", "/tmp"],
    ["ArrowRight", "/elsewhere"],
    ["ArrowUp", "/tmp"],
  ]) {
    await page.keyboard.press(key);
    assert.equal(await chooser.locator(".Mui-selected").innerText(), folder);
    assert.equal(await page.evaluate(() => document.activeElement?.textContent), folder);
  }
  await page.keyboard.press("ArrowDown");
  await page.keyboard.down("Enter");
  await page.keyboard.down("Enter");
  await page.keyboard.up("Enter");
  await page.keyboard.up("Shift");
  await page.keyboard.up("Control");
  await chooser.waitFor({ state: "hidden" });
  await page.locator(".canvas-tab").nth(3).waitFor();
  assert.equal(await page.locator(".canvas-tab").count(), 4);
  assert.equal(
    await page.locator('.canvas-tab[data-active] [role="tab"]').getAttribute("title"),
    "/elsewhere",
  );
  const opened = await page.evaluate(() =>
    window.pageCalls.filter(({ cmd }) => cmd === "pty_open"),
  );
  assert.equal(opened.length, 1);
  assert.equal(opened[0].args.cwd, "/elsewhere");

  // Either modifier order works, and releasing a modifier cancels without creating anything.
  await terminal.focus();
  await page.keyboard.down("Shift");
  await page.keyboard.down("Control");
  await chooser.waitFor();
  assert.equal(await chooser.locator(".Mui-selected").innerText(), "/elsewhere");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.up("Control");
  await page.keyboard.up("Shift");
  await chooser.waitFor({ state: "hidden" });
  assert.equal(await terminal.evaluate((element) => element === document.activeElement), true);
  assert.equal(await page.locator(".canvas-tab").count(), 4);

  await page.keyboard.down("Control");
  await page.keyboard.down("Shift");
  await chooser.waitFor();
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Escape");
  await chooser.waitFor({ state: "hidden" });
  assert.equal(await terminal.evaluate((element) => element === document.activeElement), true);
  await page.keyboard.up("Shift");
  await page.keyboard.up("Control");

  // A clipboard chord still reaches the original terminal before folder navigation starts.
  await page.evaluate(() => {
    window.pageClipboard = "canvas-shortcut-paste";
  });
  await page.keyboard.press("Control+Shift+V");
  await page.waitForFunction(() =>
    window.pageCalls.some(
      ({ cmd, args }) => cmd === "pty_write" && args.data.includes("canvas-shortcut-paste"),
    ),
  );
  await chooser.waitFor({ state: "hidden" });
  assert.equal(await page.locator(".canvas-tab").count(), 4);

  await page.keyboard.down("Control");
  await page.keyboard.down("Shift");
  await chooser.waitFor();
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await chooser.waitFor({ state: "hidden" });
  await page.keyboard.up("Shift");
  await page.keyboard.up("Control");

  await page.evaluate(() => {
    const input = document.createElement("input");
    input.value = "keep word selection";
    document.body.append(input);
    input.focus();
  });
  await page.keyboard.press("Control+Shift+ArrowLeft");
  assert.equal(await chooser.count(), 0);
  assert.equal(await page.evaluate(() => document.activeElement?.tagName), "INPUT");
  return {
    fourArrows: true,
    createsSeparateCanvas: true,
    cancelRestoresFocus: true,
    clipboardPreserved: true,
    editorSelectionPreserved: true,
  };
}

export async function verifyCanvasTabLabels(page, base = "http://127.0.0.1:18426") {
  await installCanvasNative(page);
  await page.addInitScript(() => {
    if (window.top !== window) return;
    const invoke = window.__TAURI_INTERNALS__.invoke;
    window.__TAURI_INTERNALS__.invoke = (cmd, args) => {
      if (cmd === "persistent_get" && args.name === "totex.relaunch")
        return Promise.resolve({
          values: {
            "canvas.tabs": ["/work/team/app", "/home/team/app", "/work/docs"].map((cwd) => ({
              id: cwd,
              cwd,
              branch: "main",
              folder: true,
            })),
            "canvas.active": "/work/team/app",
          },
        });
      return invoke(cmd, args);
    };
  });
  await page.goto(`${base}/tests/fixtures/pages.html?canvas&onlyterminals&no-sessions&carried`);
  const labels = page.getByRole("tab");
  await labels.nth(2).waitFor();
  assert.deepEqual(await labels.allTextContents(), ["work/team/app", "home/team/app", "docs"]);
  assert.equal(await labels.first().getAttribute("title"), "/work/team/app");
  await page.getByRole("tab", { name: "/home/team/app", exact: true }).click();
  assert.equal(await labels.nth(1).getAttribute("aria-selected"), "true");
  await page.getByRole("button", { name: "Close canvas /home/team/app", exact: true }).click();
  await page.waitForFunction(
    () => document.querySelectorAll('.canvas-header [role="tab"]').length === 2,
  );
  assert.deepEqual(await labels.allTextContents(), ["app", "docs"]);
  await page.getByRole("button", { name: "New canvas", exact: true }).click();
  await page.getByRole("menuitem", { name: "/work/team/app", exact: true }).click();
  await labels.nth(2).waitFor();
  assert.deepEqual(await labels.allTextContents(), ["app", "docs", "app"]);
  return { shortestDistinctPaths: true, duplicateFolderNames: true, fullPathOnHover: true };
}

export async function verifyCanvasTabs(page, base = "http://127.0.0.1:18426") {
  await installCanvasNative(page);
  await page.goto(`${base}/tests/fixtures/pages.html?canvas&grouped&onlyterminals&terminal-resize`);
  await page.locator(".canvas-tab").nth(2).waitFor();
  const first = page.locator('[data-session-canvas="terminal-one"]');
  await first.locator('[data-canvas-pane="live"]').waitFor();
  const initial = await page.evaluate(() => window.canvasStates["terminal-one"]);
  await first
    .frameLocator(".canvas-frame")
    .frameLocator("iframe")
    .getByRole("button", { name: "Count 0", exact: true })
    .waitFor();
  const frame = page.frame({ url: "http://127.0.0.1:18424/live" });
  await frame.waitForFunction(() => window.canvasFixtureMount);
  const mount = await frame.evaluate(() => window.canvasFixtureMount);
  assert.equal(await page.locator("#cli-sidebar .page__terminal-list").count(), 0);
  const tab = page.locator(".canvas-tab").first();
  await tab.getByRole("button", { name: "New terminal", exact: true }).click();
  await page.waitForFunction(
    () =>
      document.querySelectorAll(".canvas-tab:first-child .canvas-tab-terminals button").length ===
      3,
  );
  const member = await page.locator('[data-terminal-shown="true"]').getAttribute("data-terminal");
  assert.notEqual(member, "terminal-one");
  assert.equal(await page.locator("[data-session-canvas]").count(), 3);
  assert.equal(await first.isVisible(), true);
  assert.deepEqual(await page.evaluate(() => window.canvasStates["terminal-one"]), initial);
  assert.equal(await frame.evaluate(() => window.canvasFixtureMount), mount);
  const meta = await page.evaluate(
    (member) =>
      JSON.parse(
        window.pageCalls.find(({ cmd, args }) => cmd === "pty_open" && args.id === member).args
          .meta,
      ),
    member,
  );
  assert.equal(meta.canvas, "terminal-one");
  await page.locator('[data-terminal-shown="true"] .xterm-helper-textarea').focus();
  await page.keyboard.press("Control+ArrowLeft");
  assert.equal(
    await page.locator('[data-terminal-shown="true"]').getAttribute("data-terminal"),
    "terminal-one",
  );
  await page.keyboard.press("Control+ArrowRight");
  assert.equal(
    await page.locator('[data-terminal-shown="true"]').getAttribute("data-terminal"),
    member,
  );
  await page.keyboard.press("Control+ArrowDown");
  await page.locator('[data-session-canvas="terminal-two"]').waitFor({ state: "visible" });
  await page.keyboard.press("Control+ArrowUp");
  await first.waitFor({ state: "visible" });
  assert.equal(
    await page.locator('[data-terminal-shown="true"]').getAttribute("data-terminal"),
    member,
  );
  assert.equal(await frame.evaluate(() => window.canvasFixtureMount), mount);
  await page.getByRole("button", { name: "New canvas", exact: true }).click();
  await page.getByRole("menuitem", { name: "/tmp", exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll(".canvas-tab").length === 4);
  const duplicate = page.locator(".canvas-tab").last();
  assert.equal(await duplicate.getByRole("tab").innerText(), "tmp");
  const duplicateId = await page
    .locator("[data-session-canvas]:not([hidden])")
    .getAttribute("data-session-canvas");
  assert.notEqual(duplicateId, "terminal-one");
  assert.equal(
    await page.locator("[data-session-canvas]:not([hidden]) [data-canvas-pane]").count(),
    0,
  );
  await page.locator('[data-terminal-shown="true"] .xterm-helper-textarea').focus();
  await page.keyboard.press("Control+x");
  await page.waitForFunction(
    () =>
      document.querySelectorAll(".canvas-tab:last-child .canvas-tab-terminals button").length === 1,
  );
  assert.equal(
    await page.locator("[data-session-canvas]:not([hidden])").getAttribute("data-session-canvas"),
    duplicateId,
  );
  assert.equal(await page.locator('[data-terminal-shown="true"]').count(), 0);
  // Empty header space accepts sidebar file drags even after the last terminal closes.
  await page.locator(".canvas-header-space").evaluate((element) => {
    const transfer = new DataTransfer();
    transfer.setData(
      "application/x-totex-files",
      JSON.stringify([{ path: "/tmp/note.txt", isDir: false }]),
    );
    const rect = element.getBoundingClientRect();
    element.dispatchEvent(
      new DragEvent("drop", {
        bubbles: true,
        cancelable: true,
        dataTransfer: transfer,
        clientX: rect.left + 5,
        clientY: rect.top + 10,
      }),
    );
  });
  await page.locator(`[data-session-canvas="${duplicateId}"] [data-canvas-pane]`).waitFor();
  await duplicate.getByRole("button", { name: "New terminal", exact: true }).click();
  assert.equal(
    await page.locator("[data-session-canvas]:not([hidden])").getAttribute("data-session-canvas"),
    duplicateId,
  );
  assert.equal(
    await page.locator(`[data-session-canvas="${duplicateId}"] [data-canvas-pane]`).count(),
    1,
  );
  const draft = page
    .locator(`[data-session-canvas="${duplicateId}"]`)
    .getByRole("textbox", { name: "note.txt", exact: true });
  await page.evaluate(() => {
    window.pageWriteRefused = true;
  });
  await draft.fill("Shared draft survives failed tab close");
  await duplicate.getByRole("button", { name: "Close canvas /tmp", exact: true }).click();
  await page.locator(".canvas-error").waitFor();
  assert.equal(await duplicate.count(), 1);
  assert.equal(await draft.textContent(), "Shared draft survives failed tab close");
  await page.evaluate(() => {
    window.pageWriteRefused = false;
  });
  await duplicate.getByRole("button", { name: "Close canvas /tmp", exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll(".canvas-tab").length === 3);
  assert.equal(await page.locator(`[data-session-canvas="${duplicateId}"]`).count(), 0);
  assert.deepEqual(await page.evaluate(() => window.canvasStates["terminal-one"]), initial);
  return {
    sharedCanvas: true,
    independentTabs: true,
    navigation: true,
    emptyCanvasDrop: true,
    retainedFrame: true,
  };
}

export async function verifyCanvasTabRestore(page, base = "http://127.0.0.1:18426") {
  await installCanvasNative(page);
  await page.addInitScript(() => {
    if (window.top !== window) return;
    window.canvasStates["/tmp cli 120"] = {
      id: "/tmp cli 120",
      revision: 1,
      panes: [{ id: "kept", kind: "code", text: "Kept canvas" }],
    };
    const invoke = window.__TAURI_INTERNALS__.invoke;
    window.__TAURI_INTERNALS__.invoke = (cmd, args) => {
      if (cmd === "persistent_get" && args.name === "totex.relaunch")
        return Promise.resolve({
          values: {
            "canvas.tabs": [{ id: "/tmp cli 120", cwd: "/tmp", branch: "main", folder: true }],
            "canvas.active": "/tmp cli 120",
          },
        });
      return invoke(cmd, args);
    };
  });
  await page.goto(`${base}/tests/fixtures/pages.html?canvas&onlyterminals&no-sessions&carried`);
  await page.getByText("Kept canvas", { exact: true }).waitFor();
  assert.equal(await page.locator(".canvas-tab").count(), 1);
  await page.getByRole("button", { name: "New terminal", exact: true }).click();
  await page.locator('[data-terminal-shown="true"]').waitFor();
  const id = await page.locator('[data-terminal-shown="true"]').getAttribute("data-terminal");
  assert.ok(
    Number(id.split(" cli ").at(-1)) > 120,
    "Closed canvas IDs remain reserved after restart",
  );
  assert.equal(
    await page.locator("[data-session-canvas]:not([hidden])").getAttribute("data-session-canvas"),
    "/tmp cli 120",
  );
  assert.equal(await page.getByText("Kept canvas", { exact: true }).count(), 1);
  return { emptyTabRestored: true, contentRetained: true, idsReserved: true };
}
