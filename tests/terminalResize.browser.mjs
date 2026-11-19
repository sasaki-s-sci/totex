import assert from "node:assert/strict";
import { installCanvasNative } from "./fixtures/canvas-native.mjs";

/** Real sidebar CliView and xterm, with ConPTY attachment and repaint supplied by IPC. */
export async function verifyTerminalResize(page, base = "http://127.0.0.1:18422") {
  await installCanvasNative(page);
  await page.addInitScript(() => {
    if (window.top === window) localStorage.setItem("totex.panel.width", "420");
  });
  await page.setViewportSize({ width: 1200, height: 700 });
  await page.goto(`${base}/tests/fixtures/pages.html?canvas&grouped&onlyterminals&terminal-resize`);
  const host = page.locator('#cli-sidebar [data-terminal="terminal-one"]');
  await host.locator(".xterm-screen").waitFor();
  await page.waitForFunction(() => {
    const terminal = window.pageTerminals.get("terminal-one");
    const size = window.pageCalls
      .filter(({ cmd, args }) => cmd === "pty_resize" && args.id === "terminal-one")
      .at(-1)?.args;
    return terminal?.rows > 2 && size?.rows === terminal.rows && size?.cols === terminal.cols;
  });
  await page.waitForFunction(() =>
    ["terminal-one", "terminal-two", "terminal-other"].every(
      (id) =>
        window.pageTerminals.get(id)?.buffer.active.getLine(0)?.translateToString(true) ===
        "Retained terminal",
    ),
  );
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
      id: "terminal-two",
      seq: 1,
      data: "\x1b[6n",
    }),
  );
  await page.waitForFunction(() =>
    window.pageCalls.some(
      ({ cmd, args }) =>
        cmd === "pty_write" &&
        args.id === "terminal-two" &&
        args.data.startsWith("\x1b[") &&
        /\d+;\d+R$/.test(args.data),
    ),
  );
  await page.evaluate(() => {
    window.resizeTerminalIdentity = document.querySelector('[data-terminal="terminal-one"] .xterm');
    window.resizeAttachCount = window.pageCalls.filter(({ cmd }) => cmd === "pty_attach").length;
    window.pageEmit("pty:data", {
      id: "terminal-one",
      seq: 1,
      data: Array.from({ length: 120 }, (_, index) => `line ${index}`).join("\r\n"),
    });
  });
  await page.waitForFunction(() => {
    const buffer = window.pageTerminals.get("terminal-one").buffer.active;
    return buffer.getLine(buffer.baseY + buffer.cursorY).translateToString(true) === "line 119";
  });
  const before = await read();
  assert.ok(before.base > 0, "The full-height terminal has genuine scrollback");

  await page.setViewportSize({ width: 1200, height: 940 });
  await page.waitForFunction((rows) => {
    const terminal = window.pageTerminals.get("terminal-one");
    const size = window.pageCalls
      .filter(({ cmd, args }) => cmd === "pty_resize" && args.id === "terminal-one")
      .at(-1)?.args;
    return terminal.rows > rows && size?.rows === terminal.rows;
  }, before.rows);
  assert.equal((await read()).base, before.base, "Growing ConPTY keeps history above its viewport");

  const resizeCount = await page.evaluate(
    () =>
      window.pageCalls.filter(({ cmd, args }) => cmd === "pty_resize" && args.id === "terminal-one")
        .length,
  );
  const previousCols = (await read()).cols;
  const grip = page.locator("#cli-sidebar").getByRole("separator");
  const box = await grip.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 - 32, box.y + box.height / 2, { steps: 12 });
  await page.mouse.up();
  await page.waitForFunction((cols) => {
    const terminal = window.pageTerminals.get("terminal-one");
    const size = window.pageCalls
      .filter(({ cmd, args }) => cmd === "pty_resize" && args.id === "terminal-one")
      .at(-1)?.args;
    return terminal.cols > cols && size?.cols === terminal.cols && size?.rows === terminal.rows;
  }, previousCols);
  assert.equal(
    await page.evaluate(
      () =>
        window.pageCalls.filter(
          ({ cmd, args }) => cmd === "pty_resize" && args.id === "terminal-one",
        ).length,
    ),
    resizeCount + 1,
    "A continuous sidebar drag sends only its settled grid to the PTY",
  );

  for (const key of ["ArrowLeft", "ArrowRight", "ArrowLeft"]) {
    const cols = (await read()).cols;
    await grip.focus();
    await page.keyboard.press(key);
    await page.waitForFunction((cols) => {
      const terminal = window.pageTerminals.get("terminal-one");
      const size = window.pageCalls
        .filter(({ cmd, args }) => cmd === "pty_resize" && args.id === "terminal-one")
        .at(-1)?.args;
      return terminal.cols !== cols && size?.cols === terminal.cols && size?.rows === terminal.rows;
    }, cols);
  }
  const grown = await read();
  assert.deepEqual(grown.lines.filter(Boolean), before.lines.filter(Boolean));

  // ConPTY redraws the current viewport without rewriting the scrollback above it.
  const visible = grown.lines.slice(grown.base);
  while (visible.at(-1) === "") visible.pop();
  await page.evaluate(
    async (data) => {
      window.pageEmit("pty:data", { id: "terminal-one", seq: 2, data });
      await new Promise((resolve) => window.pageTerminals.get("terminal-one").write("", resolve));
    },
    `\x1b[H${visible.join("\r\n")}\x1b[J`,
  );
  assert.deepEqual((await read()).lines.filter(Boolean), before.lines.filter(Boolean));

  await host.locator(".xterm-helper-textarea").focus();
  await page.keyboard.press("Control+2");
  await page.locator('[data-terminal="terminal-two"][data-terminal-shown="true"]').waitFor();
  await page.waitForFunction(() => {
    const terminal = window.pageTerminals.get("terminal-two");
    const size = window.pageCalls
      .filter(({ cmd, args }) => cmd === "pty_resize" && args.id === "terminal-two")
      .at(-1)?.args;
    return terminal.rows > 2 && size?.cols === terminal.cols && size?.rows === terminal.rows;
  });
  await page.keyboard.press("Control+1");
  await host.locator(".xterm-helper-textarea").waitFor();
  assert.equal(
    await page.evaluate(
      () =>
        window.resizeTerminalIdentity ===
          document.querySelector('[data-terminal="terminal-one"] .xterm') &&
        window.resizeAttachCount ===
          window.pageCalls.filter(({ cmd }) => cmd === "pty_attach").length,
    ),
    true,
    "Resizing and switching preserve the original terminal and PTY attachment",
  );
  assert.deepEqual((await read()).lines.filter(Boolean), before.lines.filter(Boolean));
  return "ConPTY row growth, sidebar resize, settled PTY grids, hidden startup and preserved scrollback";
}
