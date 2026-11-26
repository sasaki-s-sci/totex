import assert from "node:assert/strict";
import { installCanvasNative } from "./fixtures/canvas-native.mjs";

export async function verifyCanvasPreviews(page, base = "http://127.0.0.1:18426") {
  await page.exposeFunction("pageCaptureSnapshot", async () =>
    (await page.screenshot()).toString("base64"),
  );
  await installCanvasNative(page);
  await page.addInitScript(() => {
    if (window.top !== window) return;
    window.canvasStates["terminal-one"].panes = [
      { id: "live", kind: "iframe", url: "http://127.0.0.1:18424/live" },
      { id: "source", kind: "file", path: "/tmp/note.txt" },
    ];
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${base}/tests/fixtures/pages.html?canvas&grouped&onlyterminals`);
  const mini = page.locator('[data-layout-pane="live"]');
  await mini.waitFor();
  const live = page.frame({ url: "http://127.0.0.1:18424/live" });
  await live.getByRole("button", { name: "Count 0" }).click();
  const mount = await live.evaluate(() => {
    document.body.style.background = "rgb(220, 30, 60)";
    return window.canvasFixtureMount;
  });
  const pixelMatches = (red) =>
    page.waitForFunction((red) => {
      const canvas = document.querySelector('[data-layout-pane="live"] canvas[data-ready]');
      if (!canvas) return false;
      const pixel = canvas
        .getContext("2d")
        .getImageData(canvas.width / 2, canvas.height / 2, 1, 1).data;
      return Math.abs(pixel[0] - red) < 3;
    }, red);
  await pixelMatches(220);
  await mini.click();
  await mini.press("Enter");
  await mini.press("Space");
  assert.equal(await live.getByRole("button", { name: "Count 1" }).count(), 1);
  assert.equal(await mini.locator("iframe, input, a, [contenteditable]").count(), 0);
  assert.equal(
    await mini.locator("canvas").evaluate((node) => getComputedStyle(node).pointerEvents),
    "none",
  );
  await live.evaluate(() => {
    document.body.style.background = "rgb(25, 130, 70)";
  });
  await pixelMatches(25);
  await mini.dragTo(page.locator('[data-layout-pane="source"]'));
  await page.waitForFunction(() => window.canvasStates["terminal-one"].panes[0].id === "source");
  assert.equal(await live.evaluate(() => window.canvasFixtureMount), mount);
  await pixelMatches(25);
  await mini.dragTo(page.locator("[data-layout-trash]"));
  await mini.waitFor({ state: "detached" });
  assert.equal(
    await page.locator('.session-canvas:not([hidden]) [data-canvas-pane="live"]').count(),
    0,
  );
  const editor = page.getByRole("textbox", { name: "note.txt", exact: true });
  await editor.fill("keep this preview draft");
  await page.evaluate(() => {
    window.pageWriteRefused = true;
  });
  const source = page.locator('[data-layout-pane="source"]');
  await source.dragTo(page.locator("[data-layout-trash]"));
  await page.locator(".canvas-error").waitFor();
  assert.equal(await editor.textContent(), "keep this preview draft");
  assert.equal(await source.count(), 1);
  await page.evaluate(() => {
    window.pageWriteRefused = false;
  });
  await source.dragTo(page.locator("[data-layout-trash]"));
  await source.waitFor({ state: "detached" });
  assert.equal(await page.evaluate(() => window.pageFileText), "keep this preview draft");
  await page.getByRole("button", { name: "Collapse root folders", exact: true }).click();
  await page.waitForTimeout(1200);
  const calls = await page.evaluate(
    () => window.pageCalls.filter(({ cmd }) => cmd === "canvas_snapshot").length,
  );
  await page.waitForTimeout(1200);
  assert.equal(
    await page.evaluate(
      () => window.pageCalls.filter(({ cmd }) => cmd === "canvas_snapshot").length,
    ),
    calls,
  );
  return {
    actualFramePixels: true,
    refreshed: true,
    inert: true,
    dragRetainsFrame: true,
    trash: true,
    hiddenStopsCapture: true,
  };
}

async function fileDrop(page, target, path, native = false, edge = false) {
  if (native) {
    const box = await target.boundingBox();
    await page.evaluate(
      ({ path, position }) => {
        window.pageEmit("tauri://drag-enter", { paths: [path], position });
        window.pageEmit("tauri://drag-drop", { paths: [path], position });
      },
      { path, position: { x: box.x + box.width / 2, y: box.y + box.height / 2 } },
    );
  } else {
    const box = await target.boundingBox();
    const point = { clientX: box.x + (edge ? 2 : box.width / 2), clientY: box.y + box.height / 2 };
    const data = await page.evaluateHandle((path) => {
      const data = new DataTransfer();
      data.setData("application/x-totex-file", path);
      return data;
    }, path);
    await target.dispatchEvent("dragover", { dataTransfer: data, ...point });
    await target.dispatchEvent("drop", { dataTransfer: data, ...point });
    await data.dispose();
  }
}

async function matchesCanvas(page) {
  await page.waitForFunction(() => {
    const map = document.querySelector(".layout-map").getBoundingClientRect();
    const canvas = document.querySelector(".session-canvas:not([hidden])").getBoundingClientRect();
    const miniatures = [...document.querySelectorAll("[data-layout-pane]")];
    if (
      !miniatures.length ||
      Math.abs(map.width / map.height - canvas.width / canvas.height) > 0.01
    )
      return false;
    return miniatures.every((mini) => {
      const actual = [
        ...document.querySelectorAll(".session-canvas:not([hidden]) > [data-canvas-pane]"),
      ].find((pane) => pane.dataset.canvasPane === mini.dataset.layoutPane);
      const a = actual.getBoundingClientRect();
      const m = mini.getBoundingClientRect();
      return (
        Math.abs((m.x - map.x) / map.width - (a.x - canvas.x) / canvas.width) < 0.01 &&
        Math.abs((m.y - map.y) / map.height - (a.y - canvas.y) / canvas.height) < 0.01 &&
        Math.abs(m.width / map.width - a.width / canvas.width) < 0.01 &&
        Math.abs(m.height / map.height - a.height / canvas.height) < 0.01
      );
    });
  });
}

export async function verifyCanvasLayout(page, base = "http://127.0.0.1:18426") {
  await installCanvasNative(page);
  await page.addInitScript(() => {
    if (window.top !== window) return;
    // Native HTML5 dragging is unavailable in Tauri on Windows.
    document.addEventListener("dragstart", (event) => event.preventDefault(), true);
    window.canvasStates["terminal-one"].panes = [
      { id: "source", kind: "file", path: "/tmp/note.txt" },
      { id: "live", kind: "iframe", url: "http://127.0.0.1:18424/live" },
      { id: "blank", kind: "empty" },
    ];
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${base}/tests/fixtures/pages.html?canvas&grouped&onlyterminals`);
  await page.locator('[data-layout-pane="source"]').waitFor();
  await matchesCanvas(page);
  const live = page.frame({ url: "http://127.0.0.1:18424/live" });
  await live.getByRole("button", { name: "Count 0" }).click();
  const mount = await live.evaluate(() => window.canvasFixtureMount);

  // Equal-size panes move without firing ResizeObserver.
  await page
    .locator('[data-layout-pane="source"]')
    .dragTo(page.locator('[data-layout-pane="live"]'));
  await page.waitForFunction(() => window.canvasStates["terminal-one"].panes[0].id === "live");
  await matchesCanvas(page);
  assert.equal(
    await live.evaluate(() => window.canvasFixtureMount),
    mount,
    "Reordering retains the running iframe",
  );
  assert.equal(await live.getByRole("button", { name: "Count 1" }).count(), 1);
  await page
    .locator('[data-layout-pane="live"]')
    .dragTo(page.locator('[data-layout-pane="source"]'));
  await page.waitForFunction(() => window.canvasStates["terminal-one"].panes[0].id === "source");
  assert.equal(await live.evaluate(() => window.canvasFixtureMount), mount);
  await matchesCanvas(page);

  const grip = page.locator('.session-canvas:not([hidden]) [data-canvas-resize="columns"]').first();
  const box = await grip.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 100, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();
  await matchesCanvas(page);
  await page.setViewportSize({ width: 900, height: 720 });
  await matchesCanvas(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await matchesCanvas(page);

  const mini = page.locator('[data-layout-pane="source"]');
  await mini.focus();
  await page.keyboard.press("Alt+ArrowRight");
  await page.waitForFunction(() => window.canvasStates["terminal-one"].panes[0].id === "live");
  await page.waitForFunction(() => document.activeElement?.dataset.layoutPane === "source");
  await page.keyboard.press("Alt+ArrowLeft");
  await page.waitForFunction(() => window.canvasStates["terminal-one"].panes[0].id === "source");
  await page.waitForFunction(() => document.activeElement?.dataset.layoutPane === "source");
  const editor = page.getByRole("textbox", { name: "note.txt", exact: true });
  await page.evaluate(() => {
    window.pageWriteRefused = true;
  });
  await editor.fill("keep my layout draft");
  await mini.dragTo(page.locator("[data-layout-trash]"));
  await page.locator(".canvas-error").waitFor();
  assert.equal(await editor.textContent(), "keep my layout draft");
  assert.equal(await mini.count(), 1);
  await fileDrop(page, mini, "/tmp/dropped.txt");
  await page.waitForTimeout(300);
  assert.equal(await editor.textContent(), "keep my layout draft");
  assert.equal(await mini.count(), 1);
  await page.evaluate(() => {
    window.pageWriteRefused = false;
  });
  await fileDrop(page, mini, "/tmp/dropped.txt", false, true);
  await page.getByRole("textbox", { name: "dropped.txt", exact: true }).waitFor();
  assert.equal(await editor.textContent(), "keep my layout draft");
  assert.equal(await page.evaluate(() => window.canvasStates["terminal-one"].panes.length), 4);
  await mini.dragTo(page.locator("[data-layout-trash]"));
  await mini.waitFor({ state: "detached" });
  assert.equal(await page.evaluate(() => window.pageFileText), "keep my layout draft");
  assert.equal(await page.evaluate(() => window.canvasStates["terminal-one"].panes.length), 3);

  await fileDrop(page, page.locator('[data-layout-pane="blank"]'), "/tmp/sub/child.txt", true);
  await page.getByRole("textbox", { name: "child.txt", exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.canvasStates["terminal-one"].panes.length), 3);
  const dropped = page
    .locator(".layout-map")
    .getByRole("button", { name: "dropped.txt", exact: true });
  await dropped.dragTo(page.locator("[data-layout-trash]"));
  await dropped.waitFor({ state: "detached" });
  assert.equal(await page.evaluate(() => window.canvasStates["terminal-one"].panes.length), 2);
  assert.equal(
    await page.evaluate(() => window.pageCalls.some(({ cmd }) => cmd === "fs_delete_file")),
    false,
  );
  await matchesCanvas(page);

  await page.locator(".layout-map").getByRole("button", { name: "child.txt", exact: true }).focus();
  await page.keyboard.press("Delete");
  await page
    .getByRole("textbox", { name: "child.txt", exact: true })
    .waitFor({ state: "detached" });
  await page.locator('[data-terminal-shown="true"] .xterm-helper-textarea').focus();
  await page.keyboard.press("Control+2");
  await page
    .locator('[data-layout-canvas="terminal-two"] [data-layout-pane="worker-code"]')
    .waitFor();
  assert.equal(await page.locator('[data-layout-pane="live"]').count(), 0);
  return {
    scaledGeometry: true,
    resize: true,
    swap: true,
    iframeRetention: true,
    trash: true,
    saveProtection: true,
    nativeAndInternalFiles: true,
    keyboard: true,
    terminalOwnership: true,
  };
}

export async function verifyCanvasSnap(page, base = "http://127.0.0.1:18426") {
  await installCanvasNative(page);
  await page.addInitScript(() => {
    if (window.top !== window) return;
    document.addEventListener("dragstart", (event) => event.preventDefault(), true);
    window.canvasStates["terminal-one"].panes = [
      { id: "source", kind: "file", path: "/tmp/note.txt" },
      { id: "live", kind: "iframe", url: "http://127.0.0.1:18424/live" },
      { id: "blank", kind: "empty" },
    ];
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  const fixture = `${base}/tests/fixtures/pages.html?canvas&grouped&onlyterminals`;
  await page.goto(fixture);
  const source = page.locator('[data-layout-pane="source"]');
  const bounds = page.locator(".layout-bounds");
  const canvas = page.locator('[data-session-canvas="terminal-one"]');
  await source.waitFor();
  await matchesCanvas(page);
  const frameSize = await bounds.boundingBox();
  assert.equal(frameSize.height, 140);
  assert.ok(frameSize.width > (await page.locator(".layout-map").boundingBox()).width);
  assert.equal(
    await bounds.evaluate((element) => getComputedStyle(element).borderTopStyle),
    "solid",
  );
  assert.equal(await page.locator(".layout-box h2, .layout-box p").count(), 0);
  const live = page.frame({ url: "http://127.0.0.1:18424/live" });
  await live.getByRole("button", { name: "Count 0" }).click();
  const mount = await live.evaluate(() => window.canvasFixtureMount);

  const startDrag = async (pane, target, x, y) => {
    const from = await pane.boundingBox();
    const to = await target.boundingBox();
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(from.x + from.width / 2 + 6, from.y + from.height / 2, { steps: 3 });
    await page.mouse.move(to.x + x * to.width, to.y + y * to.height, { steps: 8 });
    // Chromium sends dragenter first when the last move crosses the border.
    await page.mouse.move(to.x + x * to.width, to.y + y * to.height);
    await page.locator(".layout-drop-preview").waitFor();
  };
  const waitForHalf = async (edge) => {
    await page.waitForFunction((edge) => {
      const area = document
        .querySelector('[data-session-canvas="terminal-one"]')
        .getBoundingClientRect();
      const pane = document.querySelector('[data-canvas-pane="source"]').getBoundingClientRect();
      const horizontal = edge === "left" || edge === "right";
      const expected = horizontal
        ? {
            x: edge === "left" ? 0 : area.width / 2,
            y: 0,
            width: area.width / 2,
            height: area.height,
          }
        : {
            x: 0,
            y: edge === "top" ? 0 : area.height / 2,
            width: area.width,
            height: area.height / 2,
          };
      return (
        Math.abs(pane.x - area.x - expected.x) < 2 &&
        Math.abs(pane.y - area.y - expected.y) < 2 &&
        Math.abs(pane.width - expected.width) < 2 &&
        Math.abs(pane.height - expected.height) < 2
      );
    }, edge);
    await matchesCanvas(page);
  };
  for (const [edge, x, y] of [
    ["left", 0.005, 0.5],
    ["right", 0.995, 0.5],
    ["top", 0.5, 0.005],
    ["bottom", 0.5, 0.995],
  ]) {
    await startDrag(source, bounds, x, y);
    await page.mouse.up();
    await page.locator(".layout-drop-preview").waitFor({ state: "detached" });
    await waitForHalf(edge);
  }
  assert.equal(await live.evaluate(() => window.canvasFixtureMount), mount);
  assert.equal(await live.getByRole("button", { name: "Count 1" }).count(), 1);
  assert.equal(
    await page.evaluate(() => window.pageCalls.filter(({ cmd }) => cmd === "canvas_write").length),
    0,
  );

  const beforeCancel = await page.evaluate(() => localStorage.getItem("totex.canvas.layouts"));
  await startDrag(source, bounds, 0.005, 0.5);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await page.locator(".layout-drop-preview").waitFor({ state: "detached" });
  assert.equal(
    await page.evaluate(() => localStorage.getItem("totex.canvas.layouts")),
    beforeCancel,
  );

  await source.focus();
  await page.keyboard.press("Alt+Shift+ArrowLeft");
  await waitForHalf("left");
  const target = page.locator('[data-layout-pane="live"]');
  await startDrag(page.locator('[data-layout-pane="blank"]'), target, 0.05, 0.5);
  await page.mouse.up();
  await page.waitForFunction(() => {
    const blank = document.querySelector('[data-canvas-pane="blank"]').getBoundingClientRect();
    const live = document.querySelector('[data-canvas-pane="live"]').getBoundingClientRect();
    return (
      Math.abs(blank.y - live.y) < 2 &&
      Math.abs(blank.height - live.height) < 2 &&
      Math.abs(blank.right + 1 - live.left) < 2
    );
  });
  await matchesCanvas(page);
  const grip = canvas.locator('[data-canvas-resize="columns"]').first();
  const beforeResize = (await canvas.locator('[data-canvas-pane="source"]').boundingBox()).width;
  await grip.focus();
  await page.keyboard.press("ArrowRight");
  assert.ok(
    (await canvas.locator('[data-canvas-pane="source"]').boundingBox()).width > beforeResize + 10,
  );
  await matchesCanvas(page);
  const savedSize = await canvas.locator('[data-canvas-pane="source"]').boundingBox();
  const savedLayout = await page.evaluate(() => localStorage.getItem("totex.canvas.layouts"));
  await page.reload();
  await source.waitFor();
  await matchesCanvas(page);
  assert.equal(
    await page.evaluate(() => localStorage.getItem("totex.canvas.layouts")),
    savedLayout,
  );
  assert.ok(
    Math.abs(
      (await canvas.locator('[data-canvas-pane="source"]').boundingBox()).width - savedSize.width,
    ) < 2,
  );

  await page.locator('[data-terminal-shown="true"] .xterm-helper-textarea').focus();
  await page.keyboard.press("Control+2");
  await page.locator('[data-layout-pane="worker-code"]').waitFor();
  assert.equal((await bounds.boundingBox()).height, frameSize.height);
  await page.keyboard.press("Control+1");
  await source.waitFor();
  await matchesCanvas(page);
  await page.setViewportSize({ width: 900, height: 720 });
  await matchesCanvas(page);
  assert.equal((await bounds.boundingBox()).height, frameSize.height);
  await page.evaluate(() => {
    window.canvasStates["terminal-one"].revision++;
    window.canvasStates["terminal-one"].panes = [];
  });
  await page.waitForFunction(() => document.querySelectorAll("[data-layout-pane]").length === 0);
  assert.equal((await bounds.boundingBox()).height, frameSize.height);
  return {
    fixedFrame: true,
    fourEdges: true,
    nestedSplit: true,
    preview: true,
    cancel: true,
    iframeRetention: true,
    resize: true,
    persistence: true,
    terminalIsolation: true,
    keyboard: true,
  };
}

export async function verifyLocalPageStatus(page, base = "http://127.0.0.1:18426") {
  await installCanvasNative(page);
  await page.addInitScript(() => {
    if (window.top !== window) return;
    window.canvasStates["terminal-one"].panes = [
      { id: "live", kind: "iframe", url: "http://127.0.0.1:18424/live" },
    ];
    window.localPageStatus = { kind: "frame-blocked" };
    window.pageChecks = 0;
    const invoke = window.__TAURI_INTERNALS__.invoke;
    window.__TAURI_INTERNALS__.invoke = (cmd, args) => {
      if (cmd === "canvas_page_status") {
        window.pageChecks++;
        return Promise.resolve(window.localPageStatus);
      }
      return invoke(cmd, args);
    };
  });
  await page.goto(`${base}/tests/fixtures/pages.html?canvas&onlyterminals`);
  await page
    .getByText("This page does not allow embedding. Open it in your browser.", { exact: true })
    .waitFor();
  assert.equal(await page.locator(".canvas-frame").count(), 0);
  await page.getByRole("button", { name: "Open in browser", exact: true }).click();
  assert.ok(
    await page.evaluate(() =>
      window.pageCalls.some(
        ({ cmd, args }) =>
          cmd === "plugin:opener|open_url" && args.url === "http://127.0.0.1:18424/live",
      ),
    ),
  );
  await page.evaluate(() => {
    window.localPageStatus = { kind: "http-error", status: 404 };
  });
  await page.getByRole("button", { name: "Reload page", exact: true }).click();
  await page
    .getByText("The server returned HTTP 404. Check the URL or reload the page.", { exact: true })
    .waitFor();
  await page.evaluate(() => {
    window.localPageStatus = { kind: "unavailable" };
  });
  await page.getByRole("button", { name: "Reload page", exact: true }).click();
  await page
    .getByText(
      "The local server is not responding. Check that it is running, or reload the page.",
      { exact: true },
    )
    .waitFor();
  await page.evaluate(() => {
    window.localPageStatus = { kind: "ready" };
  });
  await page
    .frameLocator(".canvas-frame")
    .frameLocator("iframe")
    .getByRole("heading", { name: "Development preview" })
    .waitFor();
  const live = page.frame({ url: "http://127.0.0.1:18424/live" });
  const mount = await live.evaluate(() => window.canvasFixtureMount);
  await page.locator('[data-canvas-pane="live"]').focus();
  await page.keyboard.press("Shift+F10");
  await page.getByRole("menuitem", { name: "Reload page", exact: true }).click();
  await page.waitForFunction(() => {
    const frame = document.querySelector(".canvas-frame")?.contentDocument?.querySelector("iframe");
    return frame && frame.src === "http://127.0.0.1:18424/live";
  });
  await page
    .frameLocator(".canvas-frame")
    .frameLocator("iframe")
    .getByRole("heading", { name: "Development preview" })
    .waitFor();
  assert.notEqual(
    await page
      .frame({ url: "http://127.0.0.1:18424/live" })
      .evaluate(() => window.canvasFixtureMount),
    mount,
  );
  return {
    embeddingReason: true,
    openBrowser: true,
    httpErrors: true,
    startupRecovery: true,
    manualReload: true,
  };
}
