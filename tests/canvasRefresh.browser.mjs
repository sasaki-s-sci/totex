import assert from "node:assert/strict";
import { installCanvasNative } from "./fixtures/canvas-native.mjs";

export async function verifyCanvasRefresh(page, base = "http://127.0.0.1:18426") {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await installCanvasNative(page);
  let pictureAvailable = false;
  await page.route("http://127.0.0.1:18424/refresh.png", (route) =>
    pictureAvailable
      ? route.fulfill({
          contentType: "image/png",
          body: Buffer.from(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGOQ8LL+DwACuAGd8psO1AAAAABJRU5ErkJggg==",
            "base64",
          ),
        })
      : route.fulfill({ status: 404, body: "Not ready" }),
  );
  await page.addInitScript(() => {
    if (window.top !== window) return;
    window.canvasStates["terminal-one"].panes = [
      { id: "live", kind: "iframe", url: "http://127.0.0.1:18424/live" },
      { id: "second", kind: "iframe", url: "http://127.0.0.1:18424/live?second" },
      { id: "source", kind: "file", path: "/tmp/note.txt" },
      { id: "picture", kind: "image", src: "http://127.0.0.1:18424/refresh.png" },
    ];
    window.canvasStates["terminal-two"].panes = [
      { id: "other", kind: "iframe", url: "http://127.0.0.1:18424/live?other" },
    ];
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${base}/tests/fixtures/pages.html?canvas&grouped&onlyterminals`);
  const refresh = page.getByRole("button", { name: "Refresh canvas pages", exact: true });
  const trash = page.locator("[data-layout-trash]");
  const editor = page.getByRole("textbox", { name: "note.txt", exact: true });
  await editor.waitFor();
  await page.locator('[data-canvas-pane="picture"] [role="alert"]').waitFor();
  const live = (id) =>
    page.locator(`[data-canvas-pane="${id}"]`).frameLocator("iframe").frameLocator("iframe");
  for (const id of ["live", "second"])
    await live(id).getByRole("button", { name: "Count 0", exact: true }).click();
  const urls = ["", "?second", "?other"].map((suffix) => `http://127.0.0.1:18424/live${suffix}`);
  for (const url of urls)
    await page.frame({ url }).waitForFunction(() => window.canvasFixtureMount);
  const mounts = () =>
    Promise.all(urls.map((url) => page.frame({ url }).evaluate(() => window.canvasFixtureMount)));
  const originalMounts = await mounts();
  const refreshBox = await refresh.boundingBox();
  const trashBox = await trash.boundingBox();
  assert.ok(refreshBox.x >= trashBox.x + trashBox.width, "Refresh follows the trash button");
  assert.equal(refreshBox.y, trashBox.y);

  const layout = () =>
    page.evaluate(() =>
      [
        ...document.querySelectorAll(
          "#folder-sidebar button, .layout-bounds, .session-canvas:not([hidden]) > [data-canvas-pane]",
        ),
      ].map((element) => element.getBoundingClientRect().toJSON()),
    );
  const beforeDrag = await layout();
  const mini = page.locator('[data-layout-pane="live"]');
  const from = await mini.boundingBox();
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(trashBox.x + 12, trashBox.y + 12, { steps: 8 });
  await page.locator("[data-layout-trash][data-over]").waitFor();
  assert.deepEqual(await layout(), beforeDrag, "Trash feedback never moves the toolbar or pages");
  const feedback = await trash.evaluate((element) => ({
    outline: getComputedStyle(element).outlineStyle,
    background: getComputedStyle(element.querySelector("button")).backgroundColor,
  }));
  assert.equal(feedback.outline, "none");
  assert.notEqual(feedback.background, "rgba(0, 0, 0, 0)");
  const button = await trash.locator("button").elementHandle();
  await trash.locator("path").first().dispatchEvent("dragleave", { relatedTarget: button });
  assert.equal(
    await trash.getAttribute("data-over"),
    "true",
    "Moving within the icon keeps feedback",
  );
  await page.keyboard.press("Escape");
  await page.mouse.up();
  assert.equal(await trash.getAttribute("data-over"), null);
  assert.deepEqual(await layout(), beforeDrag);

  const grip = page.locator('.session-canvas:not([hidden]) [data-canvas-resize="columns"]').first();
  const miniatureStyle = await mini.getAttribute("style");
  await grip.focus();
  await page.keyboard.press("ArrowRight");
  await page.waitForFunction(
    (style) => document.querySelector('[data-layout-pane="live"]').getAttribute("style") !== style,
    miniatureStyle,
  );
  const beforeRefresh = await layout();
  const sizes = await page.evaluate(() => localStorage.getItem("totex.canvas.sizes.terminal-one"));
  const calls = () => page.evaluate(() => window.pageCalls.map(({ cmd }) => cmd));
  const beforeCalls = await calls();
  await page.evaluate(() => {
    window.pageWriteRefused = true;
  });
  await editor.fill("preserve this refresh draft");
  await refresh.click();
  await page.locator(".canvas-error").waitFor();
  assert.deepEqual(await mounts(), originalMounts, "A failed save prevents all page reloads");
  assert.equal(await editor.textContent(), "preserve this refresh draft");

  await page.evaluate(() => {
    window.pageWriteRefused = false;
  });
  pictureAvailable = true;
  await refresh.click();
  for (const id of ["live", "second"])
    await live(id).getByRole("button", { name: "Count 0", exact: true }).waitFor();
  await editor.waitFor();
  await page.waitForFunction(
    () => document.querySelector('[data-canvas-pane="picture"] img')?.naturalWidth > 0,
  );
  const refreshed = await mounts();
  assert.notEqual(refreshed[0], originalMounts[0]);
  assert.notEqual(refreshed[1], originalMounts[1]);
  assert.equal(refreshed[2], originalMounts[2], "A hidden canvas keeps its pages mounted");
  assert.equal(await editor.textContent(), "preserve this refresh draft");
  assert.equal(await page.evaluate(() => window.pageFileText), "preserve this refresh draft");
  await page.locator(".canvas-error").waitFor({ state: "detached" });
  assert.deepEqual(await layout(), beforeRefresh, "Refreshing keeps page positions and sizes");
  assert.equal(
    await page.evaluate(() => localStorage.getItem("totex.canvas.sizes.terminal-one")),
    sizes,
  );
  const afterCalls = await calls();
  assert.ok(
    afterCalls.filter((cmd) => cmd === "read_file_head").length >
      beforeCalls.filter((cmd) => cmd === "read_file_head").length,
    "Refreshing rereads the file from disk",
  );
  for (const cmd of ["canvas_write", "pty_open", "pty_close", "pty_attach"])
    assert.equal(
      afterCalls.filter((call) => call === cmd).length,
      beforeCalls.filter((call) => call === cmd).length,
    );

  await page.locator('[data-terminal-shown="true"] .xterm-helper-textarea').focus();
  await page.keyboard.press("Control+2");
  await page.locator('[data-session-canvas="terminal-two"]').waitFor({ state: "visible" });
  await live("other").getByRole("button", { name: "Count 0", exact: true }).click();
  await refresh.focus();
  await page.keyboard.press("Enter");
  await live("other").getByRole("button", { name: "Count 0", exact: true }).waitFor();
  const secondRefresh = await mounts();
  assert.deepEqual(secondRefresh.slice(0, 2), refreshed.slice(0, 2));
  assert.notEqual(secondRefresh[2], refreshed[2], "Keyboard refresh follows the active canvas");
  await page.locator('[data-terminal-shown="true"] .xterm-helper-textarea').focus();
  await page.keyboard.press("Control+3");
  await page.locator('[data-session-canvas="terminal-other"]').waitFor({ state: "visible" });
  assert.equal(await refresh.isDisabled(), true);
  assert.deepEqual(errors, []);
  return {
    activeCanvasOnly: true,
    savesDrafts: true,
    failedSaveRetainsPages: true,
    keyboard: true,
    emptyDisabled: true,
    stableTrashFeedback: true,
    layoutRetained: true,
    failedImageRetry: true,
  };
}
