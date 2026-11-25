import assert from "node:assert/strict";
import { installCanvasNative } from "./fixtures/canvas-native.mjs";

const pane = (page, id) => page.locator(`[data-canvas-pane="${id}"]`);
const note = (page) => page.getByRole("textbox", { name: "note.txt", exact: true });
const overlay = (page) => page.getByRole("dialog");

async function expand(page, target, title) {
  await target.focus();
  await page.keyboard.press("Shift+F10");
  await page.getByRole("menuitem", { name: "Expand", exact: true }).click();
  await overlay(page).getByRole("heading", { name: title, exact: true }).waitFor();
}

async function close(page, useEscape = false) {
  const button = overlay(page).getByRole("button", { name: "Close", exact: true });
  if (useEscape) {
    await button.focus();
    await page.keyboard.press("Escape");
  } else await button.click();
  await overlay(page).waitFor({ state: "hidden" });
}

async function switchTerminal(page, number, id) {
  const dialog = overlay(page);
  if (await dialog.count())
    await dialog.getByRole("button", { name: "Close", exact: true }).focus();
  else await page.locator('[data-terminal-shown="true"] .xterm-helper-textarea').focus();
  await page.keyboard.press(`Control+${number}`);
  await page.locator(`[data-session-canvas="${id}"]:not([hidden])`).waitFor();
  await page.locator(`[data-terminal="${id}"][data-terminal-shown="true"]`).waitFor();
}

async function assertDraft(page, text, expanded) {
  const editor = note(page);
  await editor.waitFor();
  assert.equal(await editor.count(), 1, "Expansion uses one editor instance");
  assert.equal(await editor.textContent(), text);
  assert.equal(
    await editor.evaluate(
      (element, expanded) =>
        element === window.expandEditor && Boolean(element.closest('[role="dialog"]')) === expanded,
      expanded,
    ),
    true,
    "The original editor DOM survives opening and closing the overlay",
  );
  assert.equal(
    await page.evaluate(() => window.pageFileText),
    "saved text",
    "An unsavable draft survives expansion",
  );
}

/** Real editors, iframe execution and xterm; only native IO and the served preview are fixtures. */
export async function verifyCanvasExpand(page, base = "http://127.0.0.1:18422") {
  const errors = [];
  const collect = (error) => errors.push(error.message);
  page.on("pageerror", collect);
  try {
    await installCanvasNative(page);
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.goto(`${base}/tests/fixtures/pages.html?canvas&grouped`);
    await note(page).waitFor();
    await page.locator('[data-terminal="terminal-other"] .xterm').waitFor({ state: "attached" });
    const drag = page.locator(".canvas-header-space[data-tauri-drag-region]");
    await page.mouse.move(0, 0);
    const restingDrag = await drag.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        background: style.backgroundColor,
        cursor: style.cursor,
        borders: [
          style.borderTopWidth,
          style.borderRightWidth,
          style.borderBottomWidth,
          style.borderLeftWidth,
        ],
      };
    });
    assert.equal(restingDrag.background, "rgba(0, 0, 0, 0)");
    assert.deepEqual(restingDrag.borders, ["0px", "0px", "0px", "0px"]);
    assert.equal(restingDrag.cursor, "grab");
    await page.mouse.move(0, 0);
    const live = page.frame({ url: "http://127.0.0.1:18424/live" });
    assert.ok(live);
    await live.getByRole("button", { name: "Count 0", exact: true }).click();
    await live.getByRole("button", { name: "Count 1", exact: true }).waitFor();
    const mount = await live.evaluate(() => window.canvasFixtureMount);
    await note(page).evaluate((element) => {
      window.expandEditor = element;
    });
    const before = await page.evaluate(() => {
      window.pageWriteRefused = true;
      window.expandFrame = document.querySelector(".canvas-frame");
      window.expandTerminals = [...document.querySelectorAll("[data-terminal]")].map((element) => ({
        id: element.dataset.terminal,
        element,
        xterm: element.querySelector(".xterm"),
      }));
      return {
        canvases: structuredClone(window.canvasStates),
        writes: window.pageCalls.filter(({ cmd }) => cmd === "canvas_write").length,
        attached: window.pageCalls.filter(({ cmd }) => cmd === "pty_attach").length,
        opened: window.pageCalls.filter(({ cmd }) => cmd === "pty_open").length,
      };
    });
    const originalBox = await pane(page, "file-1").boundingBox();
    assert.ok(originalBox);
    await note(page).fill("unsaved draft before expansion");
    await expand(page, note(page), "note.txt");
    await assertDraft(page, "unsaved draft before expansion", true);
    const expandedBox = await note(page)
      .locator(
        "xpath=ancestor::*[contains(concat(' ', normalize-space(@class), ' '), ' page ')][1]",
      )
      .boundingBox();
    assert.ok(
      expandedBox.width * expandedBox.height > originalBox.width * originalBox.height * 1.5,
      "The expanded file has substantially more reading area than its grid tile",
    );
    await note(page).fill("unsaved edits made in the overlay");
    await close(page);
    await assertDraft(page, "unsaved edits made in the overlay", false);
    const restoredBox = await pane(page, "file-1").boundingBox();
    assert.ok(Math.abs(restoredBox.width - originalBox.width) <= 1);
    assert.ok(Math.abs(restoredBox.height - originalBox.height) <= 1);

    await expand(page, note(page), "note.txt");
    await note(page).focus();
    await page.keyboard.press("Shift+F10");
    const restore = page.getByRole("menuitem", { name: "Restore size", exact: true });
    await restore.waitFor();
    assert.equal(
      await restore.evaluate((element) => Boolean(element.closest("dialog[open]"))),
      true,
    );
    await page.keyboard.press("Escape");
    await page.getByRole("menu").waitFor({ state: "hidden" });
    await overlay(page).getByRole("heading", { name: "note.txt", exact: true }).waitFor();
    await note(page).focus();
    await page.keyboard.press("Shift+F10");
    await restore.click();
    await overlay(page).waitFor({ state: "hidden" });
    await assertDraft(page, "unsaved edits made in the overlay", false);
    await expand(page, note(page), "note.txt");
    await close(page, true);
    await assertDraft(page, "unsaved edits made in the overlay", false);
    await expand(page, note(page), "note.txt");
    const modalBox = await overlay(page).boundingBox();
    assert.ok(modalBox.x > 0 && modalBox.y > 0);
    await page.mouse.click(modalBox.x / 2, modalBox.y / 2);
    await overlay(page).waitFor({ state: "hidden" });
    await assertDraft(page, "unsaved edits made in the overlay", false);
    await expand(page, note(page), "note.txt");
    await switchTerminal(page, 2, "terminal-two");
    await overlay(page).waitFor({ state: "hidden" });
    assert.equal(await note(page).count(), 0, "A file overlay does not leak into another terminal");
    await switchTerminal(page, 1, "terminal-one");
    assert.equal(await overlay(page).count(), 0);
    await assertDraft(page, "unsaved edits made in the overlay", false);

    async function assertLive(count) {
      assert.equal(live.isDetached(), false, "Expansion preserves the iframe browsing context");
      assert.equal(page.frame({ url: "http://127.0.0.1:18424/live" }), live);
      assert.equal(await live.evaluate(() => window.canvasFixtureMount), mount);
      assert.equal(
        await live.getByRole("button", { name: `Count ${count}`, exact: true }).count(),
        1,
      );
      assert.equal(
        await live.evaluate(() => localStorage.getItem("canvas.fixture.count")),
        String(count),
      );
      assert.equal(
        await page.evaluate(() => window.expandFrame === document.querySelector(".canvas-frame")),
        true,
      );
    }
    await expand(page, pane(page, "live"), "Development preview");
    assert.equal(await overlay(page).locator(".canvas-frame").count(), 1);
    await assertLive(1);
    await live.getByRole("button", { name: "Count 1", exact: true }).click();
    await live.getByRole("button", { name: "Count 2", exact: true }).waitFor();
    await close(page);
    await assertLive(2);
    await expand(page, pane(page, "live"), "Development preview");
    await close(page, true);
    await assertLive(2);
    await expand(page, pane(page, "live"), "Development preview");
    await switchTerminal(page, 2, "terminal-two");
    await overlay(page).waitFor({ state: "hidden" });
    await switchTerminal(page, 1, "terminal-one");
    await assertLive(2);
    await assertDraft(page, "unsaved edits made in the overlay", false);

    const after = await page.evaluate(() => ({
      canvases: structuredClone(window.canvasStates),
      writes: window.pageCalls.filter(({ cmd }) => cmd === "canvas_write").length,
      attached: window.pageCalls.filter(({ cmd }) => cmd === "pty_attach").length,
      opened: window.pageCalls.filter(({ cmd }) => cmd === "pty_open").length,
      terminalsKept: window.expandTerminals.every(
        ({ id, element, xterm }) =>
          document.querySelector(`[data-terminal="${id}"]`) === element &&
          element.querySelector(".xterm") === xterm,
      ),
    }));
    assert.deepEqual(
      after.canvases,
      before.canvases,
      "Expansion does not add panes or change canonical canvas state",
    );
    assert.equal(after.writes, before.writes, "Expansion is not persisted through canvas_write");
    assert.equal(after.attached, before.attached);
    assert.equal(after.opened, before.opened);
    assert.equal(after.terminalsKept, true, "Expansion does not restart a terminal or its DOM");

    await page.evaluate((src) => {
      const canvas = window.canvasStates["terminal-one"];
      canvas.revision += 1;
      canvas.panes.push({
        id: "expanded-video",
        kind: "video",
        title: "Recording",
        src,
        playback: { start: 0.2, end: 1.4, position: 0.6 },
      });
    }, `${base}/tests/fixtures/canvas-video.webm`);
    const movie = pane(page, "expanded-video").locator("video");
    await movie.waitFor();
    await page.waitForFunction(() => {
      const video = document.querySelector('[data-canvas-pane="expanded-video"] video');
      return video?.readyState >= 2 && Math.abs(video.currentTime - 0.6) < 0.1;
    });
    const mediaBefore = await movie.evaluate((element) => {
      window.expandVideo = element;
      return {
        position: element.currentTime,
        canvases: structuredClone(window.canvasStates),
        writes: window.pageCalls.filter(({ cmd }) => cmd === "canvas_write").length,
      };
    });
    await expand(page, pane(page, "expanded-video"), "Recording");
    await pane(page, "expanded-video").focus();
    await page.keyboard.press("Shift+F10");
    await page.getByRole("menuitem", { name: "Playback range", exact: true }).click();
    const range = page.getByRole("dialog", { name: "Playback range", exact: true });
    await range.getByLabel("Start (s)", { exact: true }).fill("0.7");
    assert.equal(await range.evaluate((element) => Boolean(element.closest("dialog[open]"))), true);
    await page.keyboard.press("Escape");
    await range.waitFor({ state: "hidden" });
    await page.getByRole("dialog", { name: "Recording", exact: true }).waitFor();
    await close(page);
    assert.equal(await movie.evaluate((element) => element === window.expandVideo), true);
    assert.equal(await movie.evaluate((element) => element.currentTime), mediaBefore.position);
    assert.deepEqual(await page.evaluate(() => window.canvasStates), mediaBefore.canvases);
    assert.equal(
      await page.evaluate(
        () => window.pageCalls.filter(({ cmd }) => cmd === "canvas_write").length,
      ),
      mediaBefore.writes,
    );
    assert.deepEqual(errors, []);
    return "File expansion, unsaved editor identity, Close/Escape/backdrop/Restore, iframe runtime, expanded media controls and terminal isolation";
  } finally {
    await page.keyboard.up("Shift");
    await page.keyboard.up("Control");
    page.off("pageerror", collect);
  }
}
