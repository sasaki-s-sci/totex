import assert from "node:assert/strict";
import { installCanvasNative } from "./fixtures/canvas-native.mjs";

/** Chromium's real IME events reproduce caret-driven scrolling that synthetic input misses. */
export async function verifyTerminalInput(page, base = "http://127.0.0.1:18422") {
  await installCanvasNative(page);
  await page.addInitScript(() => {
    if (window.top !== window) return;
    localStorage.setItem("totex.panel.width", "420");
    window.inputSeq = 0;
    const invoke = window.__TAURI_INTERNALS__.invoke;
    window.__TAURI_INTERNALS__.invoke = async (cmd, args) => {
      const result = await invoke(cmd, args);
      if (cmd === "pty_write" && args.id === "terminal-one")
        window.pageEmit("pty:data", { id: args.id, seq: ++window.inputSeq, data: args.data });
      return result;
    };
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${base}/tests/fixtures/pages.html?canvas&grouped&onlyterminals&terminal-resize`);
  const host = page.locator('#cli-sidebar [data-terminal="terminal-one"]');
  await host.locator(".xterm-screen").waitFor();
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => {
    const terminal = window.pageTerminals.get("terminal-one");
    const size = window.pageCalls
      .filter(({ cmd, args }) => cmd === "pty_resize" && args.id === "terminal-one")
      .at(-1)?.args;
    return terminal?.cols < 80 && terminal.cols === size?.cols;
  });
  // Include the existing grid debounce before recording native resize calls.
  await page.waitForTimeout(150);
  const gap = await host.evaluate((host) => {
    const screen = host.querySelector(".xterm-screen").getBoundingClientRect();
    const scrollbar = host.querySelector(".scrollbar.vertical").getBoundingClientRect();
    const right = host.getBoundingClientRect().right;
    return {
      edge: right - scrollbar.right,
      text: right - screen.right,
      scrollbar: scrollbar.width,
      cell: screen.width / window.pageTerminals.get("terminal-one").cols,
    };
  });
  assert.equal(gap.edge, 0, "The scrollbar reaches the terminal's right edge");
  assert.ok(
    gap.text >= gap.scrollbar && gap.text < gap.scrollbar + gap.cell + 1,
    "Only the scrollbar and incomplete character cell remain beside the text",
  );

  await page.evaluate(() => {
    const nodes = [
      document.querySelector("#cli-sidebar"),
      document.querySelector('[data-terminal="terminal-one"]'),
      document.querySelector('[data-terminal="terminal-one"] .xterm-screen'),
    ];
    const geometry = () =>
      nodes.map((node) => {
        const rect = node.getBoundingClientRect();
        return [rect.x, rect.width, node.scrollLeft];
      });
    const initial = JSON.stringify(geometry());
    window.inputJumps = [];
    window.inputResizeCount = window.pageCalls.filter(({ cmd }) => cmd === "pty_resize").length;
    const sample = () => {
      const next = JSON.stringify(geometry());
      if (next !== initial) window.inputJumps.push(next);
      window.inputFrame = requestAnimationFrame(sample);
    };
    sample();
  });
  const output = async (data) => {
    await page.evaluate(async (data) => {
      window.pageEmit("pty:data", { id: "terminal-one", seq: ++window.inputSeq, data });
      await new Promise((resolve) => window.pageTerminals.get("terminal-one").write("", resolve));
    }, data);
  };
  const cdp = await page.context().newCDPSession(page);
  try {
    for (const mode of ["normal", "alternate"]) {
      if (mode === "alternate") await output("\x1b[?1049h");
      await host.locator(".xterm-helper-textarea").focus();
      await page.keyboard.insertText("a long chat prompt ".repeat(100));
      const cols = await page.evaluate(() => window.pageTerminals.get("terminal-one").cols);
      await output(`\x1b[2J\x1b[H> ${".".repeat(cols - 8)}`);
      for (const count of [1, 10, 50]) {
        const text = "長い日本語の入力テキスト".repeat(count);
        await cdp.send("Input.imeSetComposition", {
          text,
          selectionStart: text.length,
          selectionEnd: text.length,
        });
        await page.evaluate(
          () =>
            new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
        );
        assert.equal(await host.evaluate((host) => host.scrollLeft), 0, mode);
        assert.equal(await host.locator(".composition-view").textContent(), text);
      }
      const committed = "長い日本語の入力テキスト".repeat(50);
      await cdp.send("Input.insertText", { text: committed });
      await page.waitForFunction(
        ({ committed, count }) =>
          window.pageCalls.filter(({ cmd, args }) => cmd === "pty_write" && args.data === committed)
            .length === count,
        { committed, count: mode === "normal" ? 1 : 2 },
      );
      await output("");
      assert.equal(
        await host
          .locator(".xterm-helper-textarea")
          .evaluate((node) => node === document.activeElement),
        true,
      );
    }
    await output("\x1b[?1049l");
    const result = await page.evaluate(() => {
      cancelAnimationFrame(window.inputFrame);
      return {
        jumps: window.inputJumps,
        resizeDelta:
          window.pageCalls.filter(({ cmd }) => cmd === "pty_resize").length -
          window.inputResizeCount,
      };
    });
    assert.deepEqual(result.jumps, [], "No frame moves the sidebar or terminal during long input");
    assert.equal(result.resizeDelta, 0, "Input and composition never resize the PTY grid");
  } finally {
    await page.evaluate(() => cancelAnimationFrame(window.inputFrame));
    await cdp.detach();
  }
  return "Stable long input and native IME composition, normal/alternate screens, exact commits and right gutter";
}
