import assert from "node:assert/strict";
import { installCanvasNative } from "./fixtures/canvas-native.mjs";

async function assertWrapped(paper) {
  const layout = await paper.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    return {
      overflow: element.scrollWidth - element.clientWidth,
      rows:
        range.getBoundingClientRect().height /
        Number.parseFloat(getComputedStyle(element).lineHeight),
      lines: element.textContent.split("\n").length,
    };
  });
  assert.ok(layout.overflow <= 1, "Long prose and unbroken text stay inside the file pane");
  assert.ok(layout.rows > layout.lines + 2, "File text wraps onto additional rows by default");
}

/** Real browser decoders and file editors; only IPC and the remote media host are replaced. */
export async function verifyCanvasMedia(page, base = "http://127.0.0.1:18422") {
  await page.setViewportSize({ width: 1440, height: 900 });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await installCanvasNative(page);
  const clip = await page.request.get(`${base}/tests/fixtures/canvas-video.webm`);
  assert.equal(clip.ok(), true);
  const video = await clip.body();
  await page.route("http://127.0.0.1:18424/**", async (route) => {
    const path = decodeURIComponent(new URL(route.request().url()).pathname);
    if (path.endsWith(".webm")) {
      const range = /^bytes=(\d+)-(\d*)$/.exec(route.request().headers().range ?? "");
      const start = range ? Number(range[1]) : 0;
      const end = range?.[2] ? Math.min(Number(range[2]), video.length - 1) : video.length - 1;
      return route.fulfill({
        status: range ? 206 : 200,
        contentType: "video/webm",
        headers: {
          "Accept-Ranges": "bytes",
          ...(range ? { "Content-Range": `bytes ${start}-${end}/${video.length}` } : {}),
        },
        body: video.subarray(start, end + 1),
      });
    }
    if (path === "/image.svg")
      return route.fulfill({
        contentType: "image/svg+xml",
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="90"><rect width="160" height="90" fill="teal"/></svg>',
      });
    return route.fallback();
  });
  await page.addInitScript(() => {
    if (window.top !== window) return;
    const longText = `${"A long sentence with readable words. ".repeat(7)}\n${"unbroken".repeat(35)}`;
    window.pageFiles["/tmp/wrapped.txt"] = longText;
    window.pageFiles["/tmp/readme.md"] =
      `# Preview title\n\nA **rendered** document.\n\n${longText}\nLast line`;
    window.pageFiles["/tmp/literal.json"] =
      '{"integer":9007199254740993,"text":"<script>bad</script>"}';
    window.pageFiles["/tmp/table.csv"] = "name,count\napple,3\npear,2";
    window.pageFiles["/tmp/page.html"] =
      "<h1>HTML document</h1><script>window.top.htmlExecuted=true</script>";
    const invoke = window.__TAURI_INTERNALS__.invoke;
    window.__TAURI_INTERNALS__.invoke = async (cmd, args) => {
      if (cmd === "directory_changes")
        return { "/tmp": { changed: { "readme.md": "modified" }, ignored: [], allIgnored: false } };
      if (cmd === "file_diff" && args.path === "/tmp/readme.md")
        return {
          standing: "changed",
          patch: "",
          truncated: false,
          runs: [{ line: 7, lines: 1, mark: "modified" }],
        };
      return invoke(cmd, args);
    };
    window.canvasStates["terminal-one"].panes = [
      { id: "source", kind: "file", path: "/tmp/readme.md", view: "text" },
      {
        id: "video",
        kind: "video",
        src: "http://127.0.0.1:18424/clip.webm",
        playback: { start: 0.3, end: 1.6, position: 0.8 },
      },
      {
        id: "local",
        kind: "file",
        path: "/tmp/local.webm",
        playback: { start: 0.2, end: 1.4, position: 0.6 },
      },
      { id: "image", kind: "image", src: "http://127.0.0.1:18424/image.svg" },
    ];
  });
  await page.goto(`${base}/tests/fixtures/pages.html?canvas&grouped&onlyterminals`);
  const source = page.locator('[data-canvas-pane="source"]');
  await source.getByRole("textbox", { name: "readme.md", exact: true }).waitFor();
  assert.equal(await source.locator("button, input, fieldset, .canvas-pane-tools").count(), 0);
  assert.equal(await source.locator(".file-preview__gutter").count(), 0);
  assert.equal(
    await source.getByRole("textbox").evaluate((paper) => {
      const sheet = paper.closest(".file-preview__code");
      return paper.getBoundingClientRect().left - sheet.getBoundingClientRect().left;
    }),
    0,
    "The file text uses the full pane without a line-number column",
  );
  await assertWrapped(source.getByRole("textbox"));
  await source.locator(".file-preview__mark").waitFor();
  const markOffset = await source.evaluate((pane) => {
    const paper = pane.querySelector(".file-preview__text");
    const text = paper.firstChild;
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, 1);
    const firstRow = range.getBoundingClientRect().top;
    range.setStart(text, text.textContent.lastIndexOf("\n") + 1);
    range.setEnd(text, text.textContent.length);
    const lastRow = range.getBoundingClientRect().top - firstRow;
    const mark = pane.querySelector(".file-preview__mark").getBoundingClientRect().top;
    return (
      mark -
      paper.getBoundingClientRect().top -
      Number.parseFloat(getComputedStyle(paper).paddingTop) -
      lastRow
    );
  });
  assert.ok(Math.abs(markOffset) <= 1, "Diff bars follow the rows created by wrapping");
  await source.getByRole("textbox", { name: "readme.md", exact: true }).focus();
  await page.keyboard.press("Control+Shift+V");
  await source.getByRole("heading", { name: "Preview title", exact: true }).waitFor();
  assert.equal(await source.locator("strong").textContent(), "rendered");
  await page.evaluate(() => {
    const canvas = window.canvasStates["terminal-one"];
    canvas.revision++;
    canvas.panes[0].title = "MCP title during view selection";
    document
      .querySelector('[data-canvas-pane="source"] .page')
      .dispatchEvent(
        new KeyboardEvent("keydown", { key: "v", ctrlKey: true, shiftKey: true, bubbles: true }),
      );
  });
  const editor = source.getByRole("textbox", { name: "readme.md", exact: true });
  await editor.waitFor();
  assert.equal(
    await page.evaluate(() => window.canvasStates["terminal-one"].panes[0].title),
    "MCP title during view selection",
  );
  for (const [id, name, path] of [
    ["source", "readme.md", "/tmp/readme.md"],
    ["local", "local.webm", "/tmp/local.webm"],
    ["video", "clip.webm", "http://127.0.0.1:18424/clip.webm"],
    ["image", "image.svg", "http://127.0.0.1:18424/image.svg"],
  ]) {
    await page.locator(`[data-canvas-pane="${id}"]`).focus();
    await page.keyboard.press("Shift+F10");
    const menu = page.getByRole("menu");
    await menu.getByRole("menuitem", { name: "Remove pane", exact: true }).waitFor();
    assert.equal(await menu.locator(".canvas-menu-name").innerText(), name);
    assert.equal(await menu.locator(".canvas-menu-path").innerText(), path);
    await page.keyboard.press("Escape");
    await menu.waitFor({ state: "detached" });
  }

  await page.evaluate(() => {
    const native = window.__TAURI_INTERNALS__;
    const invoke = native.invoke;
    native.invoke = (cmd, args) => {
      if (cmd !== "read_file_head" || args.path !== "/tmp/readme.md") return invoke(cmd, args);
      native.invoke = invoke;
      return new Promise((resolve) => {
        window.releasePreviewRead = () => resolve(invoke(cmd, args));
      });
    };
    const canvas = window.canvasStates["terminal-one"];
    canvas.revision++;
    canvas.panes[0].view = "preview";
  });
  await page.waitForFunction(() => typeof window.releasePreviewRead === "function");
  await source.getByText("Loading…", { exact: true }).waitFor();
  await page.evaluate(() => {
    const canvas = window.canvasStates["terminal-one"];
    canvas.revision++;
    canvas.panes[0].view = "text";
  });
  await editor.waitFor();
  await page.evaluate(() => window.releasePreviewRead());
  await page.evaluate(() => {
    window.pageWriteRefused = true;
  });
  await editor.fill("# Unsaved title\n\nKeep my changes.");
  await page.keyboard.press("Control+Shift+V");
  await source.getByText("readme.md cannot be written", { exact: true }).waitFor();
  assert.equal(await editor.innerText(), "# Unsaved title\n\nKeep my changes.");
  assert.equal(
    await page.evaluate(() => window.canvasStates["terminal-one"].panes[0].view),
    "text",
  );
  await page.evaluate(() => {
    const canvas = window.canvasStates["terminal-one"];
    canvas.revision++;
    canvas.panes[0].view = "preview";
  });
  await page.waitForFunction(() =>
    document.querySelector(".canvas-error")?.textContent.includes("replacing"),
  );
  assert.equal(await editor.innerText(), "# Unsaved title\n\nKeep my changes.");
  await page.evaluate(() => {
    window.pageWriteRefused = false;
  });
  await source.getByRole("heading", { name: "Unsaved title", exact: true }).waitFor();
  await page.locator(".canvas-error").waitFor({ state: "detached" });
  assert.equal(
    await page.evaluate(() => window.pageFiles["/tmp/readme.md"]),
    "# Unsaved title\n\nKeep my changes.",
  );

  await page.waitForFunction(
    () =>
      [...document.querySelectorAll("video")].length === 2 &&
      [...document.querySelectorAll("video")].every((p) => p.readyState >= 2),
  );
  const movie = page.locator('[data-canvas-pane="video"] video');
  const local = page.locator('[data-canvas-pane="local"] video');
  const state = await movie.evaluate((p) => ({
    width: p.videoWidth,
    height: p.videoHeight,
    time: p.currentTime,
    duration: p.duration,
    paused: p.paused,
  }));
  assert.deepEqual(state, { width: 160, height: 90, time: 0.8, duration: 2, paused: true });
  assert.equal(await local.evaluate((p) => p.currentTime), 0.6);
  assert.equal(
    await page.evaluate(() =>
      window.pageCalls.some(
        ({ cmd, args }) => cmd === "media_file" && args.path === "/tmp/local.webm",
      ),
    ),
    true,
  );
  assert.equal(
    await page.evaluate(() =>
      window.pageCalls.some(
        ({ cmd, args }) => cmd === "read_file_data" && args.path === "/tmp/local.webm",
      ),
    ),
    false,
  );
  await page.waitForFunction(
    () => document.querySelector('[data-canvas-pane="image"] img')?.naturalWidth === 160,
  );
  await movie.evaluate(async (p) => {
    p.muted = true;
    await p.play();
  });
  await page.waitForFunction(() => {
    const p = document.querySelector('[data-canvas-pane="video"] video');
    return p.paused && p.currentTime === 1.6;
  });
  await page.evaluate(() => {
    const canvas = window.canvasStates["terminal-one"];
    canvas.revision++;
    canvas.panes.find((p) => p.id === "video").playback.position = 0.5;
  });
  await page.waitForFunction(
    () => document.querySelector('[data-canvas-pane="video"] video')?.currentTime === 0.5,
  );
  await movie.evaluate(async (p) => {
    await p.play();
  });
  await page.locator('[data-terminal-shown="true"] .xterm-helper-textarea').focus();
  await page.keyboard.press("Control+2");
  await page.locator('[data-session-canvas="terminal-two"]').waitFor({ state: "visible" });
  assert.equal(await movie.evaluate((p) => p.paused), true);
  const paused = await movie.evaluate((p) => p.currentTime);
  await page.keyboard.press("Control+1");
  await page.locator('[data-session-canvas="terminal-one"]').waitFor({ state: "visible" });
  assert.equal(await movie.evaluate((p) => p.currentTime), paused);

  const playerPane = page.locator('[data-canvas-pane="video"]');
  assert.equal(await playerPane.locator("summary, form, input, .canvas-pane-tools").count(), 0);
  await playerPane.focus();
  await page.keyboard.press("Shift+F10");
  await page.getByRole("menuitem", { name: "Playback range", exact: true }).click();
  const range = page.getByRole("dialog", { name: "Playback range", exact: true });
  await range.getByLabel("Position (s)", { exact: true }).fill("0.5");
  await range.getByLabel("Start (s)", { exact: true }).fill("0.4");
  await range.getByLabel("End (s)", { exact: true }).fill("1.2");
  await page.evaluate(() => {
    const canvas = window.canvasStates["terminal-one"];
    canvas.revision++;
    const pane = canvas.panes.find((p) => p.id === "video");
    pane.title = "MCP title during range selection";
    pane.src = "http://127.0.0.1:18424/clip.webm?updated=1";
    document.querySelector('[role="dialog"] form button').click();
  });
  await page.waitForFunction(
    () =>
      window.canvasStates["terminal-one"].panes.find((p) => p.id === "video").playback.end === 1.2,
  );
  await page.waitForFunction(
    () => document.querySelector('[data-canvas-pane="video"] video')?.currentTime === 0.5,
  );
  const latestMedia = await page.evaluate(() =>
    window.canvasStates["terminal-one"].panes.find((p) => p.id === "video"),
  );
  assert.equal(latestMedia.title, "MCP title during range selection");
  assert.equal(latestMedia.src, "http://127.0.0.1:18424/clip.webm?updated=1");
  await range.waitFor({ state: "detached" });

  const localSource = await local.getAttribute("src");
  await page.evaluate(() => {
    window.pageFiles["/tmp/local.webm"] = "A regenerated media file with a new size";
    window.dispatchEvent(new Event("focus"));
  });
  await page.waitForFunction(
    (was) => document.querySelector('[data-canvas-pane="local"] video')?.src !== was,
    localSource,
  );
  await page.waitForFunction(
    () => document.querySelector('[data-canvas-pane="local"] video')?.readyState >= 2,
  );

  const replaceSource = async (path) => {
    await page.evaluate((path) => {
      const canvas = window.canvasStates["terminal-one"];
      canvas.revision++;
      canvas.panes[0] = { id: "source", kind: "file", path, view: "preview" };
    }, path);
  };
  await replaceSource("/tmp/literal.json");
  await source.locator("pre.canvas-code").waitFor();
  assert.equal(
    await source.locator("pre.canvas-code").textContent(),
    '{"integer":9007199254740993,"text":"<script>bad</script>"}',
  );
  await replaceSource("/tmp/wrapped.txt");
  await source.locator(".file-preview__plain").filter({ hasText: "unbroken" }).waitFor();
  await assertWrapped(source.locator(".file-preview__plain"));
  await replaceSource("/tmp/table.csv");
  await source.getByRole("cell", { name: "apple", exact: true }).waitFor();
  await replaceSource("/tmp/page.html");
  await source.frameLocator("iframe").getByRole("heading", { name: "HTML document" }).waitFor();
  assert.equal(await page.evaluate(() => window.htmlExecuted), undefined);
  await source.locator(".page").focus();
  await page.keyboard.press("Control+Shift+V");
  const html = source.getByRole("textbox", { name: "page.html", exact: true });
  await html.waitFor();
  assert.match(await html.textContent(), /<h1>HTML document<\/h1>/);
  await html.focus();
  await page.keyboard.press("Control+Shift+V");
  await source.frameLocator("iframe").getByRole("heading", { name: "HTML document" }).waitFor();

  await page.evaluate(() => {
    window.pageFiles["/tmp/first-read.md"] = "# First read survives";
    const native = window.__TAURI_INTERNALS__;
    const invoke = native.invoke;
    window.openingReads = [];
    native.invoke = (cmd, args) => {
      if (cmd !== "read_file_head" || args.path !== "/tmp/first-read.md") return invoke(cmd, args);
      return new Promise((resolve) => {
        window.openingReads.push(() => resolve(invoke(cmd, args)));
      });
    };
    window.finishOpeningReads = () => {
      native.invoke = invoke;
      for (const finish of window.openingReads.slice(1)) finish();
    };
    const canvas = window.canvasStates["terminal-one"];
    canvas.revision++;
    canvas.panes.push({
      id: "opening-race",
      kind: "file",
      path: "/tmp/first-read.md",
      view: "text",
    });
  });
  await page.waitForFunction(() => window.openingReads.length >= 1);
  await page.evaluate(() => {
    const canvas = window.canvasStates["terminal-one"];
    canvas.revision++;
    canvas.panes.find((p) => p.id === "opening-race").view = "preview";
  });
  await page.waitForFunction(async () => {
    const { values } = await window.pageSnapshot();
    return (
      values["canvas.terminals"]["terminal-one"].panes.find((p) => p.id === "opening-race").view ===
      "preview"
    );
  });
  await page.evaluate(() => window.openingReads[0]());
  await page.waitForFunction(() => window.openingReads.length >= 2);
  await page.evaluate(() => {
    const canvas = window.canvasStates["terminal-one"];
    canvas.revision++;
    canvas.panes.find((p) => p.id === "opening-race").view = "text";
  });
  await page
    .locator('[data-canvas-pane="opening-race"]')
    .getByRole("textbox", { name: "first-read.md" })
    .waitFor();
  await page.evaluate(() => {
    window.finishOpeningReads();
    const canvas = window.canvasStates["terminal-one"];
    canvas.revision++;
    canvas.panes = canvas.panes.filter((p) => p.id !== "opening-race");
  });
  await page.locator('[data-canvas-pane="opening-race"]').waitFor({ state: "detached" });
  assert.deepEqual(errors, []);
  return {
    remoteVideo: true,
    localVideo: true,
    image: true,
    rawAndPreview: true,
    guardedSwitch: true,
    mediaRange: true,
  };
}
