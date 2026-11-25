import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { installCanvasNative } from "./fixtures/canvas-native.mjs";

export async function verifyResourceZoom(page, base = "http://127.0.0.1:18426") {
  await installCanvasNative(page);
  await page.addInitScript({
    content: await readFile(
      new URL("../src-tauri/src/frame_context_menu.js", import.meta.url),
      "utf8",
    ),
  });
  await page.addInitScript(() => {
    if (window.top !== window) return;
    window.canvasStates["terminal-one"].panes = [
      { id: "code", kind: "code", text: "const answer = 42;", language: "js" },
      { id: "markdown", kind: "markdown", text: "# A document\n\nReadable content" },
      { id: "file", kind: "file", path: "/tmp/note.txt" },
      { id: "movie", kind: "video", src: "http://127.0.0.1:18424/movie.mp4" },
      { id: "frame", kind: "iframe", url: "http://127.0.0.1:18424/live" },
    ];
  });
  await page.goto(`${base}/tests/fixtures/pages.html?canvas&grouped&onlyterminals&terminal-resize`);
  await page.locator('[data-canvas-pane="file"]').getByRole("textbox").waitFor();
  const viewport = await page.evaluate(() => [innerWidth, innerHeight, visualViewport.scale]);
  for (const id of ["code", "markdown", "file", "movie"]) {
    const pane = page.locator(`[data-canvas-pane="${id}"]`);
    const target = id === "file" ? pane.getByRole("textbox") : pane;
    await target.focus();
    await page.keyboard.press("Control+=");
    await page.waitForFunction(
      (id) =>
        document.querySelector(`[data-canvas-pane="${id}"] .canvas-pane-zoom`).dataset.zoom ===
        "1.25",
      id,
    );
    await page.keyboard.press("Control+-");
    await page.keyboard.press("Control+-");
    await page.waitForFunction(
      (id) =>
        document.querySelector(`[data-canvas-pane="${id}"] .canvas-pane-zoom`).dataset.zoom ===
        "0.8",
      id,
    );
    await page.keyboard.press("Control+0");
    await page.waitForFunction(
      (id) =>
        document.querySelector(`[data-canvas-pane="${id}"] .canvas-pane-zoom`).dataset.zoom === "1",
      id,
    );
  }
  const framed = page.locator('[data-canvas-pane="frame"]');
  const button = framed
    .frameLocator(".canvas-frame")
    .frameLocator("iframe")
    .getByRole("button", { name: "Count 0", exact: true });
  await button.click();
  const frame = page.frame({ url: "http://127.0.0.1:18424/live" });
  const mount = await frame.evaluate(() => window.canvasFixtureMount);
  await page.keyboard.press("Control+=");
  await page.waitForFunction(
    () =>
      document.querySelector('[data-canvas-pane="frame"] .canvas-pane-zoom').dataset.zoom ===
      "1.25",
  );
  assert.equal(await frame.evaluate(() => window.canvasFixtureMount), mount);
  // Hidden frames cannot change another canvas's zoom.
  await page.keyboard.press("Control+0");
  await page.locator('[data-terminal-shown="true"] .xterm-helper-textarea').focus();
  const font = await page.evaluate(() => window.pageTerminals.get("terminal-one").options.fontSize);
  const writes = await page.evaluate(
    () => window.pageCalls.filter(({ cmd }) => cmd === "pty_write").length,
  );
  await page.keyboard.press("Control+=");
  await page.waitForFunction(
    (font) => window.pageTerminals.get("terminal-one").options.fontSize > font,
    font,
  );
  await page.keyboard.press("Control+-");
  await page.keyboard.press("Control+-");
  await page.waitForFunction(
    (font) => window.pageTerminals.get("terminal-one").options.fontSize < font,
    font,
  );
  await page.keyboard.press("Control+0");
  await page.waitForFunction(
    (font) => window.pageTerminals.get("terminal-one").options.fontSize === font,
    font,
  );
  assert.equal(
    await page.evaluate(() => window.pageCalls.filter(({ cmd }) => cmd === "pty_write").length),
    writes,
  );
  assert.deepEqual(
    await page.evaluate(() => [innerWidth, innerHeight, visualViewport.scale]),
    viewport,
  );
  return {
    text: true,
    code: true,
    markdown: true,
    video: true,
    iframe: true,
    terminal: true,
    pageSizeStable: true,
  };
}
