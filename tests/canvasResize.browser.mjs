import assert from "node:assert/strict";
import { installCanvasNative } from "./fixtures/canvas-native.mjs";

async function tracks(canvas, axis) {
  return canvas.evaluate(
    (element, axis) =>
      getComputedStyle(element)
        [axis === "columns" ? "gridTemplateColumns" : "gridTemplateRows"].split(" ")
        .map(Number.parseFloat),
    axis,
  );
}

function near(actual, expected, reason) {
  assert.ok(Math.abs(actual - expected) < 1.5, `${reason}: ${actual} ≈ ${expected}`);
}

async function beginDrag(page, grip, x, y) {
  const box = await grip.boundingBox();
  assert.ok(box);
  await grip.evaluate((element) =>
    element.addEventListener(
      "pointerdown",
      (event) => {
        window.resizePointer = event.pointerId;
      },
      { once: true },
    ),
  );
  const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + x, start.y + y, { steps: 5 });
}

async function finishDrag(page) {
  await page.mouse.up();
  await page.locator("[data-canvas-resizing]").waitFor({ state: "detached" });
}

async function switchTerminal(page, number, id) {
  await page.locator('[data-terminal-shown="true"] .xterm-helper-textarea').focus();
  await page.keyboard.press(`Control+${number}`);
  await page.locator(`[data-session-canvas="${id}"]`).waitFor({ state: "visible" });
}

/** Real grid tracks and pointer capture, with native persistence replaced by the standard fixture. */
export async function verifyCanvasResize(page, base = "http://127.0.0.1:18422") {
  const errors = [];
  const collect = (error) => errors.push(error.message);
  page.on("pageerror", collect);
  let browserPage;
  try {
    await page.setViewportSize({ width: 1600, height: 900 });
    await installCanvasNative(page);
    await page.addInitScript(() => {
      if (window.top !== window) return;
      if (!sessionStorage.getItem("resize.fixture.started")) {
        localStorage.removeItem("totex.canvas.sizes.terminal-one");
        localStorage.setItem(
          "totex.canvas.sizes.terminal-two",
          '{"columns":[null,-2],"rows":"invalid"}',
        );
        sessionStorage.setItem("resize.fixture.started", "true");
      }
      window.canvasStates["terminal-one"].panes = [
        { id: "resize-live", kind: "iframe", url: "http://127.0.0.1:18424/live" },
        { id: "resize-code", kind: "code", text: "Right-hand pane" },
        { id: "resize-note", kind: "markdown", text: "# Lower pane" },
        { id: "resize-empty", kind: "empty" },
        { id: "resize-wide", kind: "code", text: "This pane spans the entire last row" },
      ];
      window.canvasStates["terminal-two"].panes = [
        { id: "other-left", kind: "code", text: "Other left" },
        { id: "other-right", kind: "code", text: "Other right" },
        { id: "other-wide", kind: "code", text: "Other spanning pane" },
      ];
    });
    const fixture = `${base}/tests/fixtures/pages.html?canvas&grouped&onlyterminals`;
    await page.goto(fixture);
    const canvas = page.locator('[data-session-canvas="terminal-one"]');
    const column = canvas.locator('[data-canvas-resize="columns"]').first();
    const row = canvas.locator('[data-canvas-resize="rows"]').first();
    await column.waitFor();
    await page.waitForFunction(
      () =>
        document
          .querySelector('[data-session-canvas="terminal-one"]')
          .querySelectorAll('[data-canvas-resize="rows"]').length === 2,
    );
    assert.equal(await canvas.locator('[data-canvas-resize="columns"]').count(), 2);
    assert.equal(await column.getAttribute("aria-orientation"), "vertical");
    assert.equal(await row.getAttribute("aria-orientation"), "horizontal");
    assert.ok(await column.getAttribute("aria-label"));
    assert.equal(await canvas.getByRole("separator").count(), 4);
    assert.equal(
      await canvas.locator('[data-canvas-resize="columns"][data-row="2"]').count(),
      0,
      "A spanning pane has no resize handle through its interior",
    );
    const wide = canvas.locator('[data-canvas-pane="resize-wide"]');
    const hasInteriorGrip = await wide.evaluate((element) => {
      const box = element.getBoundingClientRect();
      return Boolean(
        document
          .elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)
          ?.closest(".canvas-resize-grip"),
      );
    });
    assert.equal(hasInteriorGrip, false);

    await canvas
      .locator('[data-canvas-pane="resize-live"]')
      .frameLocator("iframe")
      .frameLocator("iframe")
      .getByRole("button", { name: "Count 0", exact: true })
      .waitFor();
    const live = page.frame({ url: "http://127.0.0.1:18424/live" });
    assert.ok(live);
    await live.getByRole("button", { name: "Count 0", exact: true }).click();
    const instance = await live.evaluate(() => window.canvasFixtureMount);
    await page.locator('[data-terminal-shown="true"] .xterm-helper-textarea').focus();
    await page.evaluate(() => {
      window.resizeFocus = document.activeElement;
    });
    const initialColumns = await tracks(canvas, "columns");
    const initialRows = await tracks(canvas, "rows");
    const wideBefore = await wide.boundingBox();
    await beginDrag(page, column, 110, 0);
    const moving = await tracks(canvas, "columns");
    near(moving[0], initialColumns[0] + 110, "Dragging a boundary widens the left track");
    near(moving[1], initialColumns[1] - 110, "The adjacent track gives up the same space");
    assert.equal(
      await column.evaluate((element) => element.hasPointerCapture(window.resizePointer)),
      true,
    );
    assert.equal(
      await page.evaluate(() => document.activeElement === window.resizeFocus),
      true,
      "Pointer resizing preserves terminal focus",
    );
    await finishDrag(page);
    near(
      (await wide.boundingBox()).width,
      wideBefore.width,
      "The spanning pane keeps its full width",
    );
    await beginDrag(page, row, 0, 55);
    await finishDrag(page);
    const changedRows = await tracks(canvas, "rows");
    near(changedRows[0], initialRows[0] + 55, "Horizontal boundaries resize rows");
    near(changedRows[1], initialRows[1] - 55, "The neighboring row supplies the height");
    near(changedRows[2], initialRows[2], "Unrelated rows keep their size");
    assert.equal(await live.evaluate(() => window.canvasFixtureMount), instance);
    await live.getByRole("button", { name: "Count 1", exact: true }).waitFor();

    await column.focus();
    await page.keyboard.press("Home");
    near((await tracks(canvas, "columns"))[0], 96, "Home respects the minimum width");
    await page.keyboard.press("End");
    near((await tracks(canvas, "columns"))[1], 96, "End respects the adjacent pane minimum");
    const keyboardBefore = await tracks(canvas, "columns");
    await page.keyboard.press("ArrowLeft");
    near(
      (await tracks(canvas, "columns"))[0],
      keyboardBefore[0] - 16,
      "Arrow keys move a focused separator",
    );
    assert.ok(Number(await column.getAttribute("aria-valuenow")) > 50);
    await row.focus();
    const rowBefore = await tracks(canvas, "rows");
    await page.keyboard.press("ArrowDown");
    near(
      (await tracks(canvas, "rows"))[0],
      rowBefore[0] + 16,
      "Row separators support keyboard resizing",
    );

    for (const ending of ["Escape", "blur", "pointercancel", "lostpointercapture"]) {
      const before = await tracks(canvas, "columns");
      await beginDrag(page, column, -60, 0);
      if (ending === "Escape") await page.keyboard.press("Escape");
      else if (ending === "blur")
        await page.evaluate(() => window.dispatchEvent(new Event("blur")));
      else if (ending === "pointercancel")
        await page.evaluate(() =>
          window.dispatchEvent(
            new PointerEvent("pointercancel", { pointerId: window.resizePointer }),
          ),
        );
      else await column.evaluate((element) => element.releasePointerCapture(window.resizePointer));
      await finishDrag(page);
      near(
        (await tracks(canvas, "columns"))[0],
        before[0],
        `${ending} cancels the unfinished resize`,
      );
      await page.mouse.move(700, 700);
      near(
        (await tracks(canvas, "columns"))[0],
        before[0],
        `${ending} leaves no active move listener`,
      );
    }

    const savedColumns = await tracks(canvas, "columns");
    const savedRows = await tracks(canvas, "rows");
    await switchTerminal(page, 2, "terminal-two");
    const other = page.locator('[data-session-canvas="terminal-two"]');
    const otherColumns = await tracks(other, "columns");
    near(otherColumns[0], otherColumns[1], "Invalid stored sizes fall back to an even layout");
    await beginDrag(page, other.locator('[data-canvas-resize="columns"]').first(), -70, 0);
    await finishDrag(page);
    await switchTerminal(page, 1, "terminal-one");
    near(
      (await tracks(canvas, "columns"))[0],
      savedColumns[0],
      "Each terminal retains its own column proportions",
    );
    near(
      (await tracks(canvas, "rows"))[0],
      savedRows[0],
      "Each terminal retains its own row proportions",
    );
    await page.waitForFunction(
      () =>
        JSON.parse(localStorage.getItem("totex.canvas.sizes.terminal-one")).columns.length === 2,
    );
    const saved = await page.evaluate(
      async () => (await window.pageSnapshot()).values["canvas.sizes.terminal-one"],
    );
    assert.equal(saved.columns.length, 2);
    assert.equal(saved.rows.length, 3);
    await page.reload();
    await column.waitFor();
    near(
      (await tracks(canvas, "columns"))[0],
      savedColumns[0],
      "Column sizes survive a frontend reload",
    );
    near((await tracks(canvas, "rows"))[0], savedRows[0], "Row sizes survive a frontend reload");
    const writesBefore = await page.evaluate(
      () => window.pageCalls.filter(({ cmd }) => cmd === "canvas_write").length,
    );

    await beginDrag(page, column, -50, 0);
    await page.evaluate(() => {
      const state = window.canvasStates["terminal-one"];
      state.revision++;
      state.panes.push({ id: "mcp-added", kind: "code", text: "Added during resize" });
    });
    await canvas.locator('[data-canvas-pane="mcp-added"]').waitFor();
    await finishDrag(page);
    near(
      (await tracks(canvas, "columns"))[0],
      savedColumns[0],
      "An MCP pane change cancels a stale drag",
    );
    assert.equal(
      await page.evaluate(
        () => window.pageCalls.filter(({ cmd }) => cmd === "canvas_write").length,
      ),
      writesBefore,
      "View resizing never changes the persistent canvas or terminal schema",
    );

    browserPage = await page.context().newPage();
    browserPage.on("pageerror", collect);
    await browserPage.route("http://127.0.0.1:18424/live", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: "<!doctype html><p>Browser application remains embedded</p>",
      }),
    );
    const token = "01234567-89ab-4def-8123-0123456789ab";
    await browserPage.route("**/api", async (route) => {
      const { command, args } = route.request().postDataJSON();
      assert.equal(route.request().headers().authorization, `Bearer ${token}`);
      const value =
        command === "session"
          ? { id: "terminal-one", cwd: "/tmp", branch: "main" }
          : await page.evaluate(
              ({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args),
              { command, args: command === "canvas_read" ? { id: "terminal-one" } : args },
            );
      await route.fulfill({ json: value });
    });
    await browserPage.setViewportSize({ width: 1200, height: 800 });
    await browserPage.goto(`${base}/browser.html#${token}`);
    const publicCanvas = browserPage.locator('[data-session-canvas="terminal-one"]');
    const publicGrip = publicCanvas.locator('[data-canvas-resize="columns"]').first();
    await publicGrip.waitFor();
    const publicBefore = await tracks(publicCanvas, "columns");
    await beginDrag(browserPage, publicGrip, 55, 0);
    await finishDrag(browserPage);
    near(
      (await tracks(publicCanvas, "columns"))[0],
      publicBefore[0] + 55,
      "The external browser canvas supports pointer resizing",
    );
    await publicGrip.focus();
    await browserPage.keyboard.press("ArrowLeft");
    near(
      (await tracks(publicCanvas, "columns"))[0],
      publicBefore[0] + 39,
      "The external browser canvas supports keyboard resizing",
    );
    await browserPage.setViewportSize({ width: 220, height: 160 });
    await browserPage.waitForFunction(() => {
      const canvas = document.querySelector(".session-canvas");
      return canvas.clientWidth === 220 && canvas.scrollWidth <= 221 && canvas.scrollHeight <= 161;
    });
    assert.deepEqual(errors, []);
    return {
      pointer: true,
      keyboard: true,
      spanBoundaries: true,
      cancellation: true,
      perTerminal: true,
      reload: true,
      externalBrowser: true,
    };
  } finally {
    page.off("pageerror", collect);
    await browserPage?.close();
  }
}
