import assert from "node:assert/strict";

/** Real CliView and xterm, with ConPTY's attachment and repaint supplied by the IPC fixture. */
export async function verifyTerminalResize(page, base = "http://127.0.0.1:18422") {
  await page.setViewportSize({ width: 1000, height: 800 });
  await page.goto(`${base}/tests/fixtures/pages.html?onlyterminals&terminal-resize`);
  const card = page.locator('[data-page-card="terminal:terminal-one"]');
  await card.locator(".xterm-screen").waitFor();
  await page.waitForFunction(() => window.pageCalls.some((call) => call.cmd === "pty_attach"));
  await page.waitForTimeout(100);
  const read = () =>
    page.evaluate(() => {
      const terminal = window.pageTerminals.get("terminal-one");
      const buffer = terminal.buffer.active;
      return {
        rows: terminal.rows,
        cols: terminal.cols,
        base: buffer.baseY,
        windowsPty: terminal.options.windowsPty,
        lines: Array.from({ length: buffer.length }, (_, row) =>
          buffer.getLine(row).translateToString(true),
        ),
      };
    });
  assert.deepEqual((await read()).windowsPty, { backend: "conpty", buildNumber: 22631 });
  await page.evaluate(() =>
    window.pageEmit("pty:data", {
      id: "terminal-one",
      seq: 0,
      data: "one\r\ntwo\r\nthree",
    }),
  );
  await page.waitForFunction(() => {
    const buffer = window.pageTerminals.get("terminal-one").buffer.active;
    return buffer.getLine(buffer.baseY + buffer.cursorY).translateToString(true) === "three";
  });
  const before = await read();
  assert.equal(before.rows, 2);
  assert.ok(before.base > 0, "The compact preview has scrollback");
  const resizeCount = await page.evaluate(
    () => window.pageCalls.filter((call) => call.cmd === "pty_resize").length,
  );

  const grip = card.getByRole("separator", { name: "Resize page height", exact: true });
  const box = await grip.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 240, { steps: 12 });
  await page.mouse.up();
  await page.waitForFunction(() => window.pageTerminals.get("terminal-one").rows > 2);
  assert.equal(
    await page.evaluate(() => window.pageCalls.filter((call) => call.cmd === "pty_resize").length),
    resizeCount + 1,
    "A continuous drag sends only its final grid to the PTY",
  );
  assert.equal(
    (await read()).base,
    before.base,
    "Growing ConPTY keeps scrollback out of its viewport",
  );

  for (const width of [1300, 950, 1450]) {
    const previousCols = (await read()).cols;
    await page.setViewportSize({ width, height: 800 });
    await page.waitForFunction((previousCols) => {
      const terminal = window.pageTerminals.get("terminal-one");
      const size = window.pageCalls.filter((call) => call.cmd === "pty_resize").at(-1)?.args;
      return (
        terminal.cols !== previousCols &&
        size?.cols === terminal.cols &&
        size?.rows === terminal.rows
      );
    }, previousCols);
  }
  // ConPTY repaints from the viewport's origin after a resize, leaving history above it alone.
  await page.evaluate(() =>
    window.pageEmit("pty:data", {
      id: "terminal-one",
      seq: 1,
      data: "\x1b[Htwo\r\nthree\x1b[J",
    }),
  );
  await page.waitForTimeout(100);
  const after = await read();
  assert.deepEqual(after.lines.filter(Boolean), ["Retained terminal", "one", "two", "three"]);
  assert.ok(after.cols > before.cols, "The terminal follows the wider window");
  return "ConPTY row growth, repeated width changes, matching PTY size and preserved scrollback";
}
