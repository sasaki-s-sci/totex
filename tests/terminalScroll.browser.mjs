import assert from "node:assert/strict";
import { installCanvasNative } from "./fixtures/canvas-native.mjs";

/** The sidebar owns the terminal's extra scroll space; it never changes the PTY grid. */
export async function verifyTerminalScroll(page, base = "http://127.0.0.1:18422") {
  await installCanvasNative(page);
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.goto(`${base}/tests/fixtures/pages.html?canvas&onlyterminals`);
  const host = page.locator('#cli-sidebar [data-terminal="terminal-one"]');
  await host.locator(".xterm-screen").waitFor();
  await page.waitForFunction(() =>
    window.pageCalls.some(({ cmd, args }) => cmd === "pty_resize" && args.id === "terminal-one"),
  );
  await page.evaluate(() =>
    window.pageEmit("pty:data", {
      id: "terminal-one",
      seq: 1,
      data: Array.from({ length: 100 }, (_, i) => `line ${i}\r\n`).join(""),
    }),
  );
  await page.waitForTimeout(100);
  await host.hover();
  await page.mouse.wheel(0, 10000);
  await page.waitForFunction(() => {
    const host = document.querySelector('#cli-sidebar [data-terminal="terminal-one"]');
    return host.scrollTop >= host.clientHeight / 2 - 20;
  });
  const sizes = await host.evaluate((host) => ({
    height: host.clientHeight,
    offset: host.scrollTop,
    rows: window.pageCalls
      .filter((c) => c.cmd === "pty_resize" && c.args.id === "terminal-one")
      .at(-1).args.rows,
  }));
  assert.ok(sizes.offset <= sizes.height / 2, "Extra scroll stops at half the viewport");
  await page.evaluate(() =>
    window.pageEmit("pty:data", { id: "terminal-one", seq: 2, data: "more output\r\n" }),
  );
  await page.waitForTimeout(100);
  assert.equal(
    await host.evaluate((host) => host.scrollTop),
    sizes.offset,
    "Output preserves the extra space",
  );
  await page.mouse.wheel(0, -10000);
  await page.waitForFunction(
    () => document.querySelector('#cli-sidebar [data-terminal="terminal-one"]').scrollTop === 0,
  );
  await page.mouse.wheel(0, 10000);
  await page.evaluate(() =>
    window.pageEmit("pty:data", { id: "terminal-one", seq: 3, data: "\x1b[?1049h" }),
  );
  await page.waitForFunction(
    () => document.querySelector('#cli-sidebar [data-terminal="terminal-one"]').scrollTop === 0,
  );
  assert.equal(
    await host.locator(".xterm").evaluate((node) => node.style.marginBottom),
    "0px",
    "Full-screen apps keep their full viewport",
  );
  await page.evaluate(() =>
    window.pageEmit("pty:data", { id: "terminal-one", seq: 4, data: "\x1b[?1049l" }),
  );
  await page.waitForFunction(
    () => parseFloat(document.querySelector("#cli-sidebar .xterm").style.marginBottom) > 0,
  );
  assert.equal(
    await host.evaluate(
      () =>
        window.pageCalls
          .filter((c) => c.cmd === "pty_resize" && c.args.id === "terminal-one")
          .at(-1).args.rows,
    ),
    sizes.rows,
    "Scroll space does not resize the shell",
  );
  return "half-screen scroll space, output, reverse scrolling, alternate screen, unchanged shell size";
}
