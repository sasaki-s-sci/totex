import assert from "node:assert/strict";
import { installCanvasNative } from "./fixtures/canvas-native.mjs";

const host = (page, id) => page.locator(`#cli-sidebar [data-terminal="${id}"]`);

async function show(page, number, id) {
  await page.locator('[data-terminal-shown="true"] .xterm-helper-textarea').focus();
  await page.keyboard.press(`Control+${number}`);
  await page.locator(`#cli-sidebar [data-terminal="${id}"][data-terminal-shown="true"]`).waitFor();
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
}

async function emit(page, id, seq, label, color) {
  const lines = Array.from(
    { length: 10 },
    (_, row) => `${label} ${row} ABCDEFGHIJKLMNOPQRSTUVWXYZ`,
  );
  await page.evaluate(({ id, seq, data }) => window.pageEmit("pty:data", { id, seq, data }), {
    id,
    seq,
    data: `\x1b[?25l\x1b[2J\x1b[H\x1b[38;2;${color}m${lines.join("\r\n")}\x1b[0m`,
  });
  await page.waitForFunction(
    ({ id, line }) =>
      window.pageTerminals.get(id)?.buffer.active.getLine(0)?.translateToString(true) === line,
    { id, line: lines[0] },
  );
}

async function painted(page, id, color) {
  // Read a compositor screenshot: a correct xterm buffer or detached GPU canvas is insufficient.
  const screenshot = await host(page, id).locator(".xterm-screen").screenshot();
  return page.evaluate(
    async ({ png, color }) => {
      const picture = new Image();
      picture.src = `data:image/png;base64,${png}`;
      await picture.decode();
      const canvas = document.createElement("canvas");
      canvas.width = picture.width;
      canvas.height = picture.height;
      const context = canvas.getContext("2d");
      context.drawImage(picture, 0, 0);
      const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
      let ink = 0;
      const rows = new Set();
      for (let offset = 0; offset < data.length; offset += 4) {
        const channels = [data[offset], data[offset + 1], data[offset + 2]];
        if (
          channels[color] > 160 &&
          channels.every((value, index) => index === color || value < 120)
        ) {
          ink += 1;
          rows.add(Math.floor(offset / 4 / canvas.width));
        }
      }
      return { ink, rows: rows.size, width: canvas.width, height: canvas.height };
    },
    { png: screenshot.toString("base64"), color },
  );
}

function stillPainted(actual, before, label) {
  assert.ok(
    actual.ink > 500,
    `${label}: terminal characters must remain visibly painted (${actual.ink} pixels)`,
  );
  assert.ok(
    actual.ink >= before.ink * 0.85,
    `${label}: painted text disappeared (${actual.ink}/${before.ink} pixels)`,
  );
  assert.ok(actual.rows >= before.rows * 0.85, `${label}: painted text rows disappeared`);
  assert.equal(actual.width, before.width);
  assert.equal(actual.height, before.height);
}

/** Real xterm and compositor output; native PTY data and attachment alone are mocked. */
export async function verifyTerminalRendering(page, base = "http://127.0.0.1:18422") {
  const errors = [];
  const collect = (error) => errors.push(error.message);
  page.on("pageerror", collect);
  try {
    await installCanvasNative(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(
      `${base}/tests/fixtures/pages.html?canvas&grouped&onlyterminals&terminal-rendering`,
    );
    await host(page, "terminal-one").locator(".xterm-screen").waitFor();
    await page.evaluate(async () => {
      await document.fonts.ready;
    });
    await page.waitForFunction(() =>
      ["terminal-one", "terminal-two", "terminal-other"].every((id) => {
        const terminal = window.pageTerminals?.get(id);
        const size = window.pageCalls
          .filter(({ cmd, args }) => cmd === "pty_resize" && args.id === id)
          .at(-1)?.args;
        return terminal?.rows > 2 && size?.rows === terminal.rows && size?.cols === terminal.cols;
      }),
    );
    await page.evaluate(() => {
      for (const terminal of window.pageTerminals.values()) terminal.options.cursorBlink = false;
      window.renderIdentities = [...window.pageTerminals].map(([id, terminal]) => ({
        id,
        terminal,
        element: document.querySelector(`[data-terminal="${id}"] .xterm`),
      }));
    });
    await emit(page, "terminal-one", 1, "FIRST", "240;30;50");
    await emit(page, "terminal-two", 1, "SECOND", "30;210;50");
    await emit(page, "terminal-other", 1, "THIRD", "30;50;240");
    const baselines = {};
    for (const [number, id, color] of [
      [1, "terminal-one", 0],
      [2, "terminal-two", 1],
      [3, "terminal-other", 2],
    ]) {
      await show(page, number, id);
      baselines[id] = await painted(page, id, color);
      assert.ok(baselines[id].ink > 500, `${id}: initial text is visible in the screenshot`);
    }
    // Include the existing 100ms grid debounce in both native-call snapshots.
    await page.waitForTimeout(150);
    const callsBefore = await page.evaluate(() => ({
      attached: window.pageCalls.filter(({ cmd }) => cmd === "pty_attach").length,
      resized: window.pageCalls.filter(({ cmd }) => cmd === "pty_resize").length,
      written: window.pageCalls.filter(({ cmd }) => cmd === "pty_write").length,
    }));
    for (let round = 0; round < 3; round += 1) {
      for (const [number, id, color] of [
        [1, "terminal-one", 0],
        [2, "terminal-two", 1],
        [3, "terminal-other", 2],
      ]) {
        await show(page, number, id);
        stillPainted(await painted(page, id, color), baselines[id], `${id}, switch ${round + 1}`);
      }
    }

    await emit(page, "terminal-one", 2, "UPDATED WHILE HIDDEN", "30;210;50");
    await show(page, 1, "terminal-one");
    const updated = await painted(page, "terminal-one", 1);
    assert.ok(updated.ink > 500, "Output received while hidden is visibly painted on return");
    await show(page, 2, "terminal-two");
    await show(page, 1, "terminal-one");
    stillPainted(
      await painted(page, "terminal-one", 1),
      updated,
      "Hidden output after another switch",
    );

    await page.evaluate(() =>
      window.pageEmit("pty:data", { id: "terminal-one", seq: 3, data: "\x1b[?1049h" }),
    );
    await emit(page, "terminal-one", 4, "CODEX ALTERNATE", "30;210;50");
    assert.equal(
      await page.evaluate(() => window.pageTerminals.get("terminal-one").buffer.active.type),
      "alternate",
    );
    const alternate = await painted(page, "terminal-one", 1);
    assert.ok(alternate.ink > 500, "Full-screen TUI output is visibly painted");
    await show(page, 2, "terminal-two");
    await show(page, 1, "terminal-one");
    stillPainted(
      await painted(page, "terminal-one", 1),
      alternate,
      "Alternate screen after switching",
    );

    await page.evaluate(() =>
      window.pageEmit("pty:data", { id: "terminal-one", seq: 5, data: "\x1b[?1049l" }),
    );
    await page.waitForFunction(
      () => window.pageTerminals.get("terminal-one").buffer.active.type === "normal",
    );
    stillPainted(
      await painted(page, "terminal-one", 1),
      updated,
      "Normal screen after leaving the TUI",
    );
    await page.waitForTimeout(150);
    assert.equal(
      await page.evaluate(() =>
        window.renderIdentities.every(
          ({ id, terminal, element }) =>
            window.pageTerminals.get(id) === terminal &&
            document.querySelector(`[data-terminal="${id}"] .xterm`) === element,
        ),
      ),
      true,
      "Switches retain every xterm instance and DOM host",
    );
    assert.deepEqual(
      await page.evaluate(() => ({
        attached: window.pageCalls.filter(({ cmd }) => cmd === "pty_attach").length,
        resized: window.pageCalls.filter(({ cmd }) => cmd === "pty_resize").length,
        written: window.pageCalls.filter(({ cmd }) => cmd === "pty_write").length,
      })),
      callsBefore,
      "Repainting does not reattach, resize/SIGWINCH, or send redraw input to the PTY",
    );
    assert.deepEqual(errors, []);
    return {
      repeatedSwitchPixels: true,
      hiddenOutputPixels: true,
      alternateScreenPixels: true,
      preservedTerminalAndPty: true,
    };
  } finally {
    await page.keyboard.up("Control");
    page.off("pageerror", collect);
  }
}
