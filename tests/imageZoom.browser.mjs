import assert from "node:assert/strict";
import { installCanvasNative } from "./fixtures/canvas-native.mjs";

const reader = (page, id) => page.locator(`[data-canvas-pane="${id}"] .picture-reading`);
const width = (target) =>
  target.locator("img").evaluate((image) => image.getBoundingClientRect().width);

async function fit(page, id) {
  await reader(page, id).press("Control+0");
  await page.waitForFunction((id) => {
    const element = document.querySelector(`[data-canvas-pane="${id}"] .picture-reading`);
    return (
      element.scrollWidth <= element.clientWidth + 1 &&
      element.scrollHeight <= element.clientHeight + 1
    );
  }, id);
}

async function zoom(page, id) {
  const target = reader(page, id);
  const before = await width(target);
  const viewport = await page.evaluate(() => [innerWidth, visualViewport.scale]);
  await target.evaluate((element) => {
    window.imageWheel = null;
    element.addEventListener(
      "wheel",
      (event) => {
        window.imageWheel = { ctrl: event.ctrlKey, prevented: event.defaultPrevented };
      },
      { once: true },
    );
  });
  await target.hover({ position: { x: 80, y: 80 } });
  await page.keyboard.down("Control");
  try {
    await page.mouse.wheel(0, -400);
  } finally {
    await page.keyboard.up("Control");
  }
  await page.waitForFunction(
    ({ id, before }) =>
      document.querySelector(`[data-canvas-pane="${id}"] img`).getBoundingClientRect().width >
      before * 1.1,
    { id, before },
  );
  assert.deepEqual(await page.evaluate(() => window.imageWheel), { ctrl: true, prevented: true });
  assert.deepEqual(await page.evaluate(() => [innerWidth, visualViewport.scale]), viewport);
  return before;
}

/** Real images, wheel events and dialogs; native file IO and the remote image host are fixtures. */
export async function verifyImageZoom(page, base = "http://127.0.0.1:18422") {
  const errors = [];
  const collect = (error) => errors.push(error.message);
  page.on("pageerror", collect);
  try {
    await installCanvasNative(page);
    await page.route("http://127.0.0.1:18424/zoom*.svg", (route) =>
      route.fulfill({
        contentType: "image/svg+xml",
        body: `<svg xmlns="http://www.w3.org/2000/svg" width="${route.request().url().includes("next") ? 320 : 160}" height="90"><rect width="100%" height="90" fill="teal"/></svg>`,
      }),
    );
    await page.addInitScript(() => {
      if (window.top !== window) return;
      const svg =
        '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="90"><rect width="160" height="90" fill="teal"/></svg>';
      window.pageFiles["/tmp/zoom.svg"] = svg;
      const invoke = window.__TAURI_INTERNALS__.invoke;
      window.__TAURI_INTERNALS__.invoke = (cmd, args) =>
        cmd === "read_file_data" && args.path === "/tmp/zoom.svg"
          ? Promise.resolve({
              path: args.path,
              name: "zoom.svg",
              size: svg.length,
              data: btoa(svg),
            })
          : invoke(cmd, args);
      window.canvasStates["terminal-one"].panes = [
        {
          id: "remote-image",
          kind: "image",
          src: "http://127.0.0.1:18424/zoom.svg",
          title: "Remote image",
        },
        { id: "local-file", kind: "file", path: "/tmp/zoom.svg", view: "preview" },
        { id: "local-image", kind: "image", src: "/tmp/zoom.svg" },
      ];
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${base}/tests/fixtures/pages.html?canvas&grouped&onlyterminals`);
    await page.waitForFunction(
      () =>
        [...document.querySelectorAll(".picture-reading img")].length === 3 &&
        [...document.querySelectorAll(".picture-reading img")].every(
          (image) => image.naturalWidth === 160,
        ),
    );
    const localWidth = await width(reader(page, "local-file"));
    const canvases = await page.evaluate(() => structuredClone(window.canvasStates));
    for (const id of ["remote-image", "local-file", "local-image"]) {
      const target = reader(page, id);
      const initialWidth = await zoom(page, id);
      if (id === "remote-image") assert.equal(await width(reader(page, "local-file")), localWidth);
      const scroll = await target.evaluate((element) => element.scrollTop);
      await page.mouse.wheel(0, 80);
      await page.waitForFunction(
        ({ id, scroll }) =>
          document.querySelector(`[data-canvas-pane="${id}"] .picture-reading`).scrollTop > scroll,
        { id, scroll },
      );
      await fit(page, id);
      assert.ok(Math.abs((await width(target)) - initialWidth) < 1);
      await target.press("Control+=");
      assert.ok((await width(target)) > initialWidth);
      await target.press("Control+-");
      await fit(page, id);
      await target.locator("img").evaluate((image) => {
        window.zoomImage = image;
      });
      await target.dblclick({ position: { x: 80, y: 80 } });
      const dialog = page.locator("dialog.canvas-expanded[open]");
      await dialog.waitFor();
      assert.equal(
        await dialog.locator("img").evaluate((image) => image === window.zoomImage),
        true,
      );
      assert.ok((await width(target)) > initialWidth, "Expansion gives the image more room");
      await zoom(page, id);
      await fit(page, id);
      await dialog.getByRole("button", { name: "Close", exact: true }).focus();
      await page.keyboard.press("Escape");
      await dialog.waitFor({ state: "hidden" });
      assert.equal(
        await target.locator("img").evaluate((image) => image === window.zoomImage),
        true,
      );
      await target.press("Enter");
      await dialog.waitFor();
      await dialog.getByRole("button", { name: "Close", exact: true }).click();
      await dialog.waitFor({ state: "hidden" });
    }
    assert.deepEqual(await page.evaluate(() => window.canvasStates), canvases);
    assert.equal(
      await page.evaluate(
        () => window.pageCalls.filter(({ cmd }) => cmd === "canvas_write").length,
      ),
      0,
    );
    await zoom(page, "remote-image");
    await page.evaluate(() => {
      const canvas = window.canvasStates["terminal-one"];
      canvas.revision++;
      canvas.panes[0].src = "http://127.0.0.1:18424/zoom-next.svg";
    });
    await page.waitForFunction(
      () => document.querySelector('[data-canvas-pane="remote-image"] img')?.naturalWidth === 320,
    );
    assert.ok(
      await reader(page, "remote-image").evaluate(
        (element) =>
          element.scrollWidth <= element.clientWidth + 1 &&
          element.scrollHeight <= element.clientHeight + 1,
      ),
      "A replacement image starts fitted instead of inheriting the previous image's zoom",
    );
    await page.evaluate(() => {
      const canvas = window.canvasStates["terminal-one"];
      canvas.revision++;
      canvas.panes[0].src = "http://127.0.0.1:18424/missing-image";
    });
    await page.locator('[data-canvas-pane="remote-image"]').getByRole("alert").waitFor();
    assert.deepEqual(errors, []);
    return "Remote/local image zoom, normal scrolling, keyboard controls, expansion DOM retention, isolated zoom, source reset and image errors";
  } finally {
    await page.keyboard.up("Control");
    page.off("pageerror", collect);
  }
}
