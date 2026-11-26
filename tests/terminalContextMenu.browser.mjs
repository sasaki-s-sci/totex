import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { installCanvasNative } from "./fixtures/canvas-native.mjs";

/** Real xterm links, selection and MUI menu; native clipboard/files and served URL are fixtures. */
export async function verifyTerminalContextMenu(page, base = "http://127.0.0.1:18422") {
  await page.addInitScript({
    content: await readFile(
      new URL("../src-tauri/src/frame_context_menu.js", import.meta.url),
      "utf8",
    ),
  });
  await installCanvasNative(page);
  const url = "http://127.0.0.1:18424/terminal-menu-url";
  await page.route(url, (route) =>
    route.fulfill({ contentType: "text/html", body: "<h1>Opened from the terminal</h1>" }),
  );
  await page.addInitScript(() => {
    if (window.top !== window) return;
    window.menuRequests = [];
    window.addEventListener("totex:open-page", (event) => window.menuRequests.push(event.detail));
    window.addEventListener("totex:open-file", (event) => window.menuRequests.push(event.detail));
    const invoke = window.__TAURI_INTERNALS__.invoke;
    window.__TAURI_INTERNALS__.invoke = (cmd, args) => {
      if (cmd === "plugin:clipboard-manager|write_text" && window.refuseMenuCopy)
        return Promise.reject(new Error("Clipboard unavailable"));
      if (cmd === "plugin:opener|open_url" && window.refuseMenuOpen)
        return Promise.reject(new Error("Browser unavailable"));
      return invoke(cmd, args);
    };
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${base}/tests/fixtures/pages.html?canvas&grouped&onlyterminals&terminal-resize`);
  const host = (id = "terminal-one") => page.locator(`#cli-sidebar [data-terminal="${id}"]`);
  await host().locator(".xterm-screen").waitFor();
  await page.waitForFunction(() => window.pageTerminals.get("terminal-one")?.cols < 80);
  const output = async (text, id = "terminal-one") => {
    await page.evaluate(
      async ({ text, id }) => {
        const terminal = window.pageTerminals.get(id);
        terminal.clearSelection();
        await new Promise((resolve) => terminal.write(`\x1b[2J\x1b[H${text}`, resolve));
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        terminal.focus();
      },
      { text, id },
    );
  };
  const rightClick = async (row = 0, column = 4, link = false, id = "terminal-one") => {
    await page.locator(".MuiMenu-root").waitFor({ state: "detached" });
    const point = await host(id).evaluate(
      (node, { row, column, id }) => {
        const box = node.querySelector(".xterm-screen").getBoundingClientRect();
        const terminal = window.pageTerminals.get(id);
        return {
          x: box.left + (box.width / terminal.cols) * (column + 0.5),
          y: box.top + (box.height / terminal.rows) * (row + 0.5),
        };
      },
      { row, column, id },
    );
    // xterm refreshes cached links when the pointer enters a new buffer row.
    await page.mouse.move(point.x, point.y + 20);
    await page.mouse.move(point.x, point.y);
    if (link) await host(id).locator(".xterm-cursor-pointer").waitFor();
    await page.mouse.click(point.x, point.y, { button: "right" });
  };
  const action = (name) => page.getByRole("menuitem", { name, exact: true });
  const copied = () =>
    page.evaluate(
      () =>
        window.pageCalls.filter(({ cmd }) => cmd === "plugin:clipboard-manager|write_text").at(-1)
          ?.args.text,
    );
  const typeCount = () =>
    page.evaluate(() => window.pageCalls.filter(({ cmd }) => cmd === "pty_write").length);
  const beforeTyping = await typeCount();

  await output(url);
  await rightClick(0, 5, true);
  assert.deepEqual(await page.getByRole("menuitem").allTextContents(), [
    "Open URL in canvas",
    "Open URL in browser",
    "Copy URL",
  ]);
  await action("Copy URL").click();
  assert.equal(await copied(), url);
  assert.equal(
    await host()
      .locator(".xterm-helper-textarea")
      .evaluate((node) => node === document.activeElement),
    true,
  );

  await output(`\x1b]8;;${url}\x07Readable link\x1b]8;;\x07`);
  await rightClick(0, 4, true);
  const loaded = page.waitForEvent("framenavigated", { predicate: (frame) => frame.url() === url });
  await action("Open URL in canvas").click();
  await loaded;
  assert.deepEqual(await page.evaluate(() => window.menuRequests.at(-1)), {
    url,
    sessionId: "terminal-one",
  });
  assert.equal(
    await page.evaluate(() => window.pageCalls.some(({ cmd }) => cmd === "plugin:opener|open_url")),
    false,
  );

  const canvasBeforeBrowser = await page.evaluate(() => window.canvasStates["terminal-one"]);
  const requestsBeforeBrowser = await page.evaluate(() => window.menuRequests.length);
  await rightClick(0, 4, true);
  await action("Open URL in browser").click();
  await page.waitForFunction(() =>
    window.pageCalls.some(({ cmd }) => cmd === "plugin:opener|open_url"),
  );
  assert.equal(
    await page.evaluate(
      () => window.pageCalls.find(({ cmd }) => cmd === "plugin:opener|open_url").args.url,
    ),
    url,
  );
  assert.equal(await page.evaluate(() => window.menuRequests.length), requestsBeforeBrowser);
  assert.deepEqual(
    await page.evaluate(() => window.canvasStates["terminal-one"]),
    canvasBeforeBrowser,
    "Opening in the browser leaves the canvas unchanged",
  );
  await page.evaluate(() => {
    window.refuseMenuOpen = true;
  });
  await rightClick(0, 4, true);
  await action("Open URL in browser").click();
  const openError = page.getByRole("alert").filter({ hasText: "Could not open the link or file" });
  await openError.waitFor();
  await page.evaluate(() => {
    window.refuseMenuOpen = false;
  });
  await openError.getByRole("button").click();
  await rightClick(0, 4, true);
  await action("Open URL in browser").click();
  await openError.waitFor({ state: "hidden" });
  assert.equal(
    await page.evaluate(
      () => window.pageCalls.filter(({ cmd }) => cmd === "plugin:opener|open_url").length,
    ),
    2,
  );

  await output("./note.txt:12:4");
  await rightClick();
  assert.deepEqual(await page.getByRole("menuitem").allTextContents(), ["Open file", "Copy path"]);
  await action("Copy path").click();
  assert.equal(await copied(), "/tmp/note.txt");
  await rightClick();
  await action("Open file").click();
  await page.getByRole("textbox", { name: "note.txt", exact: true }).waitFor();
  assert.deepEqual(await page.evaluate(() => window.menuRequests.at(-1)), {
    path: "/tmp/note.txt",
    sessionId: "terminal-one",
  });

  await output("\x1b]8;;file:///tmp/my%20note.txt\x07Named file\x1b]8;;\x07");
  await rightClick(0, 4, true);
  await action("Copy path").click();
  assert.equal(await copied(), "/tmp/my note.txt");

  const longPath = `./${"nested/".repeat(12)}my note.txt`;
  await output(`"${longPath}"`);
  await rightClick(1, 3);
  await action("Copy path").click();
  assert.equal(await copied(), `/tmp/${longPath.slice(2)}`);

  await output('"./selected note.txt"');
  await page.evaluate(() => window.pageTerminals.get("terminal-one").select(0, 0, 21));
  await rightClick(5, 10);
  await action("Copy path").click();
  assert.equal(await copied(), "/tmp/selected note.txt");

  for (const text of ["ordinary terminal output", "javascript:alert(1)"]) {
    await output(text);
    await rightClick();
    assert.equal(
      await page.getByRole("menu").count(),
      0,
      "Ordinary output keeps terminal context behavior",
    );
  }
  await output(url);
  await rightClick(0, 5, true);
  await page.keyboard.press("Escape");
  assert.equal(await typeCount(), beforeTyping, "Menu actions do not send input to the terminal");

  await page.evaluate(() => {
    window.refuseMenuCopy = true;
  });
  await rightClick(0, 5, true);
  await action("Copy URL").click();
  await page.getByRole("alert").filter({ hasText: "Could not copy" }).waitFor();
  await page.evaluate(() => {
    window.refuseMenuCopy = false;
  });
  await page.getByRole("alert").filter({ hasText: "Could not copy" }).getByRole("button").click();
  await rightClick(0, 5, true);
  await action("Copy URL").click();
  await page.getByRole("alert").filter({ hasText: "Could not copy" }).waitFor({ state: "hidden" });

  await host().locator(".xterm-helper-textarea").focus();
  await page.keyboard.press("Control+2");
  await host("terminal-two").locator(".xterm-screen").waitFor();
  await output("./worker.txt", "terminal-two");
  await rightClick(0, 4, false, "terminal-two");
  await action("Open file").click();
  await page.getByRole("textbox", { name: "worker.txt", exact: true }).waitFor();
  assert.deepEqual(await page.evaluate(() => window.menuRequests.at(-1)), {
    path: "/tmp/worker.txt",
    sessionId: "terminal-two",
  });
  assert.equal(
    await page
      .getByRole("textbox", { name: "worker.txt", exact: true })
      .evaluate((node) => node.closest("[data-session-canvas]").dataset.sessionCanvas),
    "terminal-two",
  );
  return "Terminal URL/OSC8/path menus, canvas/browser opening, browser and clipboard errors, wrapped paths and session ownership";
}
