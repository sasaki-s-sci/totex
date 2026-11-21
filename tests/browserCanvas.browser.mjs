import assert from "node:assert/strict";
import { installCanvasNative } from "./fixtures/canvas-native.mjs";

const token = "01234567-89ab-4def-8123-0123456789ab";
const liveUrl = "http://127.0.0.1:18424/browser-live";

/** The real browser entry shares the canonical canvas with a separate native window. */
export async function verifyBrowserCanvas(page, base = "http://localhost:1420") {
  const native = await page.context().newPage();
  const calls = [];
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await installCanvasNative(native);
    await native.goto(`${base}/tests/fixtures/pages.html?canvas&grouped&onlyterminals`);
    await native.locator('[data-session-canvas="terminal-one"]').waitFor();
    await native.evaluate((url) => {
      const canvas = window.canvasStates["terminal-one"];
      canvas.revision++;
      canvas.panes = [
        { id: "live", kind: "iframe", url, title: "Live application" },
        { id: "file", kind: "file", path: "/tmp/note.txt", view: "text" },
      ];
    }, liveUrl);
    await page.route(liveUrl, (route) =>
      route.fulfill({
        contentType: "text/html",
        body: `<!doctype html><html lang="en"><title>Live application</title>
          <label>Name <input id="name"></label><button>Apply</button><output></output>
          <script>window.instance=crypto.randomUUID();document.querySelector('button').onclick=()=>{
          document.querySelector('output').textContent=document.querySelector('input').value;};</script></html>`,
      }),
    );
    await page.route("**/api", async (route) => {
      const request = route.request();
      const { command, args } = request.postDataJSON();
      calls.push(command);
      assert.equal(request.headers().authorization, `Bearer ${token}`);
      try {
        let value;
        if (command === "session") value = { id: "terminal-one", cwd: "/tmp", branch: "main" };
        else {
          assert.ok(
            [
              "canvas_read",
              "canvas_write",
              "read_file_head",
              "read_file_data",
              "stat_file",
              "write_file",
              "directory_changes",
              "file_diff",
              "app_settings_read",
              "themes_read",
            ].includes(command),
            `The browser only requests canvas APIs: ${command}`,
          );
          if (command === "canvas_write") assert.equal(args.id, "terminal-one");
          value = await native.evaluate(
            ({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args),
            { command, args: command === "canvas_read" ? { id: "terminal-one" } : args },
          );
        }
        await route.fulfill({ json: value });
      } catch (error) {
        await route.fulfill({ status: 400, json: { error: String(error) } });
      }
    });

    await page.goto(`${base}/browser.html#${token}`);
    const canvas = page.locator('[data-session-canvas="terminal-one"]');
    const file = canvas.locator('[data-canvas-pane="file"]');
    const reading = file.getByRole("textbox", { name: "note.txt", exact: true });
    await reading.waitFor();
    assert.equal(await reading.textContent(), "saved text");
    assert.equal(await page.title(), "main · totex canvas");
    assert.equal(await page.locator("[data-terminal]").count(), 0);
    const live = await waitFrame(page, liveUrl);
    await live.getByLabel("Name").fill("Browser automation");
    await live.getByRole("button", { name: "Apply" }).click();
    assert.equal(await live.locator("output").textContent(), "Browser automation");
    const instance = await live.evaluate(() => window.instance);

    // Changing the selected terminal changes only the native canvas.
    await native.locator('[data-terminal-shown="true"] .xterm-helper-textarea').focus();
    await native.keyboard.press("Control+2");
    await native.locator('[data-session-canvas="terminal-two"]').waitFor({ state: "visible" });
    await native.evaluate(() => {
      const other = window.canvasStates["terminal-two"];
      other.revision++;
      other.panes = [{ id: "other", kind: "code", text: "Other terminal changed" }];
      const pinned = window.canvasStates["terminal-one"];
      pinned.revision++;
      pinned.panes.push({ id: "mcp", kind: "code", text: "MCP updated the pinned canvas" });
    });
    await canvas.getByText("MCP updated the pinned canvas", { exact: true }).waitFor();
    assert.equal(await page.getByText("Other terminal changed", { exact: true }).count(), 0);
    assert.equal(await live.evaluate(() => window.instance), instance);
    assert.equal(await live.getByLabel("Name").inputValue(), "Browser automation");

    // Editing and guarded pane removal still go through the shared file/canvas state.
    await reading.fill("Browser saved this file");
    await page.keyboard.press("Control+s");
    await native.waitForFunction(() => window.pageFileText === "Browser saved this file");
    await native.evaluate(() => {
      window.pageWriteRefused = true;
    });
    await reading.fill("Keep the unsaved browser draft");
    await file.focus();
    await page.keyboard.press("Shift+F10");
    assert.equal(await page.getByRole("menuitem", { name: "Open canvas in browser" }).count(), 0);
    await page.getByRole("menuitem", { name: "Remove pane", exact: true }).click();
    await page.getByRole("alert").filter({ hasText: "Save the edited file" }).waitFor();
    assert.equal(await reading.textContent(), "Keep the unsaved browser draft");
    const leaving = page.waitForEvent("dialog");
    const refusedReload = page.reload().catch(() => undefined);
    const dialog = await leaving;
    assert.equal(dialog.type(), "beforeunload");
    await dialog.dismiss();
    await refusedReload;
    assert.equal(await reading.textContent(), "Keep the unsaved browser draft");
    assert.equal(
      await native.evaluate(() =>
        window.canvasStates["terminal-one"].panes.some((p) => p.id === "file"),
      ),
      true,
    );
    await native.evaluate(() => {
      window.pageWriteRefused = false;
    });
    await reading.focus();
    await page.keyboard.press("Control+s");
    await native.waitForFunction(() => window.pageFileText === "Keep the unsaved browser draft");

    await canvas.locator('[data-canvas-pane="mcp"]').focus();
    await page.keyboard.press("Shift+F10");
    await page.getByRole("menuitem", { name: "Add pane", exact: true }).click();
    await canvas.locator('[data-canvas-kind="empty"]').waitFor();
    await file.locator(".canvas-file-status").waitFor({ state: "hidden" });
    let cleanReloadPrompted = false;
    const unexpectedPrompt = (dialog) => {
      cleanReloadPrompted = true;
      void dialog.dismiss();
    };
    page.on("dialog", unexpectedPrompt);
    try {
      await page.reload();
      await reading.waitFor();
      assert.equal(cleanReloadPrompted, false, "A saved canvas reloads without a draft warning");
      assert.equal(await reading.textContent(), "Keep the unsaved browser draft");
    } finally {
      page.off("dialog", unexpectedPrompt);
    }
    assert.ok(calls.includes("canvas_write"));
    assert.ok(calls.includes("write_file"));
    assert.deepEqual(errors, []);
    return { pinned: "terminal-one", liveFrameRetained: true, fileSaveGuard: true };
  } finally {
    await native.close();
  }
}

async function waitFrame(page, url) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const frame = page.frames().find((frame) => frame.url() === url);
    if (frame) {
      await frame.getByLabel("Name").waitFor();
      return frame;
    }
    await page.waitForTimeout(50);
  }
  throw new Error("The browser canvas did not mount its live application");
}
