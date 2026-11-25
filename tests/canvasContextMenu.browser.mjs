import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { installCanvasNative } from "./fixtures/canvas-native.mjs";

const bridge = new URL("../src-tauri/src/frame_context_menu.js", import.meta.url);

export async function verifyCanvasContextMenu(page, base = "http://127.0.0.1:18422") {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript({ content: await readFile(bridge, "utf8") });
  await installCanvasNative(page);
  const attempted = [];
  await page.route("http://forbidden.invalid/**", (route) => {
    attempted.push(route.request().url());
    return route.abort();
  });
  await page.route("http://127.0.0.1:18424/context", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><h1>Live page</h1><button onclick="this.textContent='Clicked'">Click me</button>
      <label>Input <input></label><p id="selection">Selectable page content</p>
      <iframe src="http://127.0.0.1:18425/nested" style="margin:25px;border:3px solid;width:80%;height:160px"></iframe>
      <script>window.addEventListener('contextmenu',()=>window.pageMenu=true);</script>`,
    }),
  );
  await page.route("http://127.0.0.1:18425/nested", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><h2>Nested foreign page</h2><button onclick=\"this.textContent='Nested clicked'\">Nested button</button>",
    }),
  );
  await page.addInitScript(() => {
    if (window.top !== window) return;
    window.pageFiles["/tmp/context.html"] = `<h1>HTML evidence</h1><p>Selectable HTML content</p>
      <script>window.contentExecuted=true</script><button onclick="window.contentExecuted=true">Blocked handler</button>
      <img src="http://forbidden.invalid/image"><style>@import url('http://forbidden.invalid/style');</style>
      <a href="http://forbidden.invalid/navigation" target="_top">Blocked link</a>
      <form action="http://forbidden.invalid/form"><input><button>Submit</button></form>`;
    window.canvasStates["terminal-one"].panes = [
      { id: "html", kind: "file", path: "/tmp/context.html", view: "preview" },
      { id: "live", kind: "iframe", url: "http://127.0.0.1:18424/context" },
    ];
    window.canvasStates["terminal-two"].panes = [
      { id: "hidden-html", kind: "file", path: "/tmp/context.html", view: "preview" },
    ];
  });
  await page.goto(`${base}/tests/fixtures/pages.html?canvas&grouped&onlyterminals`);
  const html = page.locator('[data-canvas-pane="html"]').frameLocator("iframe");
  await html.getByRole("heading", { name: "HTML evidence" }).waitFor();
  await html.getByRole("heading", { name: "HTML evidence" }).click();
  await page.keyboard.press("Control+=");
  await page.waitForFunction(
    () =>
      document.querySelector('[data-canvas-pane="html"] .canvas-pane-zoom').dataset.zoom === "1.25",
  );
  await page.keyboard.press("Control+0");
  const live = page.frame({ url: "http://127.0.0.1:18424/context" });
  assert.ok(live);
  await live.getByRole("button", { name: "Click me", exact: true }).click();
  await live.getByRole("button", { name: "Clicked", exact: true }).waitFor();
  await live.getByRole("textbox").fill("Input still works");
  assert.equal(await live.getByRole("textbox").inputValue(), "Input still works");
  await live.getByText("Selectable page content").selectText();
  assert.equal(await live.evaluate(() => getSelection().toString()), "Selectable page content");

  await live.getByRole("heading", { name: "Live page" }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Remove pane", exact: true }).waitFor();
  assert.equal(await live.evaluate(() => !!window.pageMenu), false);
  await page.keyboard.press("Escape");
  const nested = page.frame({ url: "http://127.0.0.1:18425/nested" });
  assert.ok(nested);
  await nested.getByRole("button", { name: "Nested button" }).click();
  await nested.getByRole("button", { name: "Nested clicked" }).waitFor();
  const target = nested.getByRole("heading", { name: "Nested foreign page" });
  const targetBounds = await target.boundingBox();
  await target.click({ button: "right" });
  const menu = page.getByRole("menu");
  await menu.waitFor();
  await page.waitForFunction(() => {
    const paper = document.querySelector(".MuiMenu-paper");
    return paper && getComputedStyle(paper).transform === "none";
  });
  const bounds = await menu.boundingBox();
  assert.ok(Math.abs(bounds.x - (targetBounds.x + targetBounds.width / 2)) < 25);
  const expectedY = Math.min(
    targetBounds.y + targetBounds.height / 2,
    page.viewportSize().height - bounds.height - 16,
  );
  assert.ok(Math.abs(bounds.y - expectedY) < 25);
  await page.getByRole("menuitem", { name: "Remove pane", exact: true }).click();
  await page.locator('[data-canvas-pane="live"]').waitFor({ state: "detached" });
  assert.equal(await page.locator('[data-canvas-pane="html"]').count(), 1);

  await html.getByRole("heading", { name: "HTML evidence" }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Remove pane", exact: true }).waitFor();
  await page.keyboard.press("Escape");
  await html.getByRole("button", { name: "Blocked handler" }).click();
  await html.getByText("Blocked link", { exact: true }).click();
  const htmlFrame = await page.locator('[data-canvas-pane="html"] iframe').elementHandle();
  const document = await htmlFrame.contentFrame();
  assert.deepEqual(
    await document.evaluate(() => ({
      executed: !!window.contentExecuted,
      bridge: typeof window.__TAURI_INTERNALS__,
      form: !!document.querySelector("form"),
      script: !!document.querySelector("script"),
      originIsolated: (() => {
        try {
          void parent.document;
          return false;
        } catch {
          return true;
        }
      })(),
    })),
    { executed: false, bridge: "undefined", form: false, script: false, originIsolated: true },
  );
  await document.evaluate(() => {
    const script = document.createElement("script");
    script.textContent = "window.contentExecuted=true";
    document.body.append(script);
  });
  assert.equal(
    await document.evaluate(() => !!window.contentExecuted),
    false,
    "CSP independently blocks inserted document scripts",
  );
  assert.deepEqual(attempted, []);

  await page.locator('[data-session-canvas="terminal-one"]').focus();
  await page.keyboard.press("Control+2");
  const hidden = page.locator('[data-canvas-pane="hidden-html"]').frameLocator("iframe");
  await hidden.getByRole("heading", { name: "HTML evidence" }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Remove pane", exact: true }).click();
  await page.locator('[data-canvas-pane="hidden-html"]').waitFor({ state: "detached" });
  assert.equal(await page.locator('[data-canvas-pane="html"]').count(), 1);
  return {
    iframeMenus: true,
    nestedCoordinates: true,
    scriptlessHtml: true,
    initialHiddenPane: true,
  };
}

export async function verifyContextMenuShell(page) {
  await page.addInitScript({ content: await readFile(bridge, "utf8") });
  await page.route("http://127.0.0.1:18426/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body:
        new URL(route.request().url()).pathname === "/shell"
          ? '<iframe src="/front" style="width:900px;height:600px;border:0"></iframe>'
          : `<h1>Frontend menu</h1><div data-canvas-pane="owned"><iframe data-canvas-context-menu sandbox="allow-scripts" srcdoc="&lt;h2&gt;Preview menu&lt;/h2&gt;"></iframe></div>
        <iframe srcdoc="&lt;h2&gt;Unrelated frame&lt;/h2&gt;"></iframe>`,
    }),
  );
  await page.goto("http://127.0.0.1:18426/shell");
  const front = page.frame({ url: "http://127.0.0.1:18426/front" });
  await front.evaluate(() => {
    window.menus = [];
    window.messageBarriers = 0;
    window.addEventListener("message", (event) => {
      if (event.data === "test-message-barrier") window.messageBarriers++;
    });
    window.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      window.menus.push(
        event.target.closest("[data-canvas-pane]")?.dataset.canvasPane ?? "frontend",
      );
    });
  });
  await front.getByRole("heading", { name: "Frontend menu" }).click({ button: "right" });
  await front
    .frameLocator("iframe[data-canvas-context-menu]")
    .getByRole("heading")
    .click({ button: "right" });
  await front.waitForFunction(() => window.menus.length === 2);
  assert.deepEqual(await front.evaluate(() => window.menus), ["frontend", "owned"]);
  await front.evaluate(() =>
    window.postMessage({ type: "totex:frame-context-menu", x: 0, y: 0 }, "*"),
  );
  await front
    .frameLocator("iframe:not([data-canvas-context-menu])")
    .getByRole("heading")
    .click({ button: "right" });
  assert.deepEqual(await front.evaluate(() => window.menus), ["frontend", "owned"]);
  const unrelated = await (
    await front.locator("iframe:not([data-canvas-context-menu])").elementHandle()
  ).contentFrame();
  await unrelated.evaluate(() => {
    parent.postMessage({ type: "totex:frame-context-menu", x: 20, y: 20, paneId: "owned" }, "*");
    parent.postMessage("test-message-barrier", "*");
  });
  await front.waitForFunction(() => window.messageBarriers === 1);
  assert.deepEqual(await front.evaluate(() => window.menus), ["frontend", "owned"]);
  const preview = await (
    await front.locator("iframe[data-canvas-context-menu]").elementHandle()
  ).contentFrame();
  await preview.evaluate(() => {
    parent.postMessage({ type: "totex:frame-context-menu", x: NaN, y: 20 }, "*");
    parent.postMessage({ type: "totex:frame-context-menu", x: 20, y: Infinity }, "*");
    parent.postMessage("test-message-barrier", "*");
  });
  await front.waitForFunction(() => window.messageBarriers === 2);
  await front.locator("[data-canvas-pane]").evaluate((pane) => {
    pane.inert = true;
  });
  await preview.evaluate(() => {
    parent.postMessage({ type: "totex:frame-context-menu", x: 20, y: 20 }, "*");
    parent.postMessage("test-message-barrier", "*");
  });
  await front.waitForFunction(() => window.messageBarriers === 3);
  assert.deepEqual(await front.evaluate(() => window.menus), ["frontend", "owned"]);
  return { frontendHandlersPreserved: true, unrelatedFramesIgnored: true };
}
