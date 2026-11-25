import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { installCanvasNative } from "./fixtures/canvas-native.mjs";

const remote = "http://127.0.0.1:18424";
const pane = (page, id) => page.locator(`[data-canvas-pane="${id}"]`);
const dialog = (page) => page.getByRole("dialog", { name: "Open URL", exact: true });
const pages = (page, id = "terminal-one") =>
  page.evaluate((id) => window.canvasStates[id].panes, id);

async function openInput(page, id) {
  await pane(page, id).focus();
  await page.keyboard.press("Shift+F10");
  await page.getByRole("menuitem", { name: "Open URL…", exact: true }).click();
  await dialog(page).waitFor();
  return dialog(page).getByRole("textbox", { name: "URL", exact: true });
}

async function opened(page, url, id = "terminal-one") {
  await page.waitForFunction(
    ({ url, id }) =>
      window.canvasStates[id].panes.some((pane) => pane.kind === "iframe" && pane.url === url),
    { url, id },
  );
}

async function terminalLink(page, label) {
  const host = page.locator('[data-terminal-shown="true"]');
  const link = host.locator(".xterm-rows").getByText(label, { exact: true });
  await link.waitFor();
  const bounds = await link.boundingBox();
  assert.ok(bounds);
  const x = bounds.x + bounds.width / 2;
  const y = bounds.y + bounds.height / 2;
  // xterm renders text below its pointer-handling screen.
  await page.mouse.move(x, y);
  await host.locator(".xterm-cursor-pointer").waitFor();
  await page.mouse.click(x, y);
}

/** Real URL input, Markdown, xterm and frames; native IO and the remote pages are fixtures. */
export async function verifyOpenUrl(page, base = "http://127.0.0.1:18422") {
  const errors = [];
  const collect = (error) => errors.push(error.message);
  page.on("pageerror", collect);
  try {
    await installCanvasNative(page);
    await page.addInitScript({
      content: await readFile(
        new URL("../src-tauri/src/frame_context_menu.js", import.meta.url),
        "utf8",
      ),
    });
    await page.route(`${remote}/url-*`, (route) =>
      route.fulfill({
        contentType: "text/html",
        body: `<h1>${new URL(route.request().url()).pathname}</h1><script>window.urlPageLoaded=true</script>`,
      }),
    );
    await page.route("https://example.com/ordinary", (route) =>
      route.fulfill({ contentType: "text/html", body: "<h1>Ordinary link</h1>" }),
    );
    await page.addInitScript(() => {
      if (window.top !== window) return;
      window.canvasStates["terminal-one"].panes = [
        { id: "blank", kind: "empty" },
        {
          id: "links",
          kind: "markdown",
          text: "[Internal link](http://127.0.0.1:18424/url-markdown)\n\n[Ordinary link](https://example.com/ordinary)",
        },
      ];
      window.pageBacklog = {
        text: "\x1b]8;;http://127.0.0.1:18424/url-terminal\x07Open terminal page\x1b]8;;\x07\r\nhttp://127.0.0.1:18424/url-detected\r\n",
        upto: 0,
      };
      window.refuseUrlWrite = false;
      const invoke = window.__TAURI_INTERNALS__.invoke;
      window.__TAURI_INTERNALS__.invoke = (cmd, args) => {
        if (cmd === "canvas_write" && window.refuseUrlWrite)
          return Promise.reject(new Error("Temporary canvas write failure"));
        return invoke(cmd, args);
      };
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(
      `${base}/tests/fixtures/pages.html?canvas&grouped&onlyterminals&terminal-rendering`,
    );
    await pane(page, "links").getByRole("link", { name: "Internal link", exact: true }).waitFor();
    const initial = await pages(page);
    const other = await pages(page, "terminal-two");
    const input = await openInput(page, "blank");
    await input.focus();
    const styles = await input.evaluate((input) =>
      [input, input.closest(".MuiInputBase-root")].map((element) => {
        const style = getComputedStyle(element);
        return {
          borders: ["Top", "Right", "Bottom", "Left"].map((side) => style[`border${side}Width`]),
          shadow: style.boxShadow,
          outline: style.outlineStyle,
        };
      }),
    );
    for (const style of styles) {
      assert.deepEqual(style.borders, ["0px", "0px", "0px", "0px"]);
      assert.equal(style.shadow, "none");
      assert.equal(style.outline, "none", "The focused URL input has no surrounding frame");
    }
    for (const url of [
      "",
      "javascript:alert(1)",
      "file:///tmp/a",
      base,
      "https://user:secret@example.com",
      "http://tauri.localhost",
    ]) {
      await input.fill(url);
      await input.press("Enter");
      assert.equal(await dialog(page).isVisible(), true);
      assert.deepEqual(await pages(page), initial, "Invalid URLs never replace a pane");
    }
    const manual = `${remote}/url-manual?q=1#part`;
    await input.fill(manual);
    await page.evaluate(() => {
      window.refuseUrlWrite = true;
    });
    await dialog(page).getByRole("button", { name: "Open", exact: true }).click();
    await dialog(page).getByRole("alert").waitFor();
    assert.equal(await input.inputValue(), manual);
    assert.deepEqual(await pages(page), initial);
    await page.evaluate(() => {
      window.refuseUrlWrite = false;
    });
    await dialog(page).getByRole("button", { name: "Open", exact: true }).click();
    await dialog(page).waitFor({ state: "hidden" });
    await opened(page, manual);
    assert.deepEqual(
      (await pages(page)).filter((pane) => pane.kind !== "iframe"),
      initial.filter((pane) => pane.kind !== "empty"),
      "Opening a URL replaces the empty pane and preserves other resources",
    );
    assert.deepEqual(await pages(page, "terminal-two"), other);
    await page
      .frameLocator(".canvas-frame")
      .frameLocator("iframe")
      .getByRole("heading", { name: "/url-manual", exact: true })
      .waitFor();
    assert.equal(await page.frame({ url: manual }).evaluate(() => window.urlPageLoaded), true);

    await pane(page, "links")
      .getByRole("link", { name: "Internal link", exact: true })
      .click({ modifiers: ["Control"] });
    await opened(page, `${remote}/url-markdown`);
    await pane(page, "links").getByRole("link", { name: "Ordinary link", exact: true }).click();
    assert.deepEqual(
      await page.evaluate(() =>
        window.pageCalls
          .filter(({ cmd }) => cmd === "plugin:opener|open_url")
          .map(({ args }) => args.url),
      ),
      [],
      "Plain and modified Markdown clicks stay inside the canvas",
    );
    await opened(page, "https://example.com/ordinary");
    await terminalLink(page, "Open terminal page");
    await opened(page, `${remote}/url-terminal`);
    await terminalLink(page, `${remote}/url-detected`);
    await opened(page, `${remote}/url-detected`);

    await pane(page, "links").focus();
    await page.keyboard.press("Shift+F10");
    await page.getByRole("menuitem", { name: "Expand", exact: true }).click();
    await page.locator("dialog[open]").waitFor();
    const expandedInput = await openInput(page, "links");
    assert.equal(
      await expandedInput.evaluate((element) => !!element.closest("dialog[open]")),
      true,
    );
    await expandedInput.fill(`${remote}/url-expanded`);
    await expandedInput.press("Enter");
    await opened(page, `${remote}/url-expanded`);
    await dialog(page).waitFor({ state: "hidden" });
    await page.locator("dialog[open]").waitFor({ state: "hidden" });

    const pending = await openInput(page, "links");
    await pending.fill(`${remote}/url-cancelled`);
    await dialog(page).getByRole("button", { name: "Open", exact: true }).focus();
    await page.keyboard.press("Control+2");
    await page.locator('[data-session-canvas="terminal-two"]:not([hidden])').waitFor();
    await dialog(page).waitFor({ state: "hidden" });
    await terminalLink(page, "Open terminal page");
    await opened(page, `${remote}/url-terminal`, "terminal-two");
    assert.equal(
      (await pages(page)).some((entry) => entry.url === `${remote}/url-cancelled`),
      false,
    );
    assert.equal(
      (await pages(page, "terminal-two")).some((entry) => entry.id === "worker-code"),
      true,
    );
    assert.equal(
      await page.evaluate(
        () => window.pageCalls.filter(({ cmd }) => cmd === "plugin:opener|open_url").length,
      ),
      0,
      "Terminal links stay inside their own canvas",
    );
    const firstUrl = (await pages(page, "terminal-two")).find(
      (pane) => pane.url === `${remote}/url-terminal`,
    );
    await pane(page, firstUrl.id).focus();
    await page.keyboard.press("Shift+F10");
    await page.getByRole("menuitem", { name: "Open in browser", exact: true }).click();
    await page.waitForFunction(() =>
      window.pageCalls.some(({ cmd }) => cmd === "plugin:opener|open_url"),
    );
    assert.equal(
      await page.evaluate(
        () =>
          window.pageCalls.filter(({ cmd }) => cmd === "plugin:opener|open_url").at(-1).args.url,
      ),
      `${remote}/url-terminal`,
    );
    assert.deepEqual(errors, []);
    return "Embedded URL input, Markdown and plain terminal clicks; validation, retry, canvas ownership and explicit external opening";
  } finally {
    await page.keyboard.up("Control");
    page.off("pageerror", collect);
  }
}
