import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installCanvasNative } from "./fixtures/canvas-native.mjs";

const uploadUrl = "http://127.0.0.1:18424/upload";
const nestedUrl = "http://127.0.0.1:18425/upload";
const bridge = new URL("../src-tauri/src/frame_context_menu.js", import.meta.url);
const uploadBridge = new URL("../src-tauri/src/frame_file_drop.js", import.meta.url);

function uploadDocument(nested = false) {
  return `<!doctype html><html lang="en"><meta charset="utf-8"><title>Upload application</title>
    <style>body{margin:24px;font:16px sans-serif}#drop{padding:30px;background:#def}
    label{display:block;margin:24px 0}iframe{display:block;margin:24px 0;border:5px solid;width:80%;height:240px}</style>
    <div id="drop">Drop a file in this application</div>
    <label>Upload files <input type="file" multiple></label><output>Waiting for files</output>
    ${nested ? `<iframe title="Nested uploader" src="${nestedUrl}"></iframe>` : ""}
    <script>
      window.uploads = [];
      const accept = async (event, files) => {
        const uploaded = await Promise.all([...files].map(async file => ({
          name: file.name, type: file.type, size: file.size, text: await file.text()
        })));
        window.uploads.push({type: event.type, trusted: event.isTrusted, files: uploaded});
        document.querySelector('output').textContent = uploaded.map(file => file.name).join(', ');
      };
      const drop = document.querySelector('#drop');
      drop.addEventListener('dragover', event => event.preventDefault());
      drop.addEventListener('drop', event => { event.preventDefault(); accept(event, event.dataTransfer.files); });
      document.querySelector('input').addEventListener('change', event => accept(event, event.target.files));
    </script></html>`;
}

async function pointAt(target, edge) {
  const box = await target.boundingBox();
  assert.ok(box, "The drop target is visible");
  return {
    x:
      edge === "left"
        ? box.x + 2
        : edge === "right"
          ? box.x + box.width - 2
          : box.x + box.width / 2,
    y:
      edge === "top"
        ? box.y + 2
        : edge === "bottom"
          ? box.y + box.height - 2
          : box.y + box.height / 2,
  };
}

async function settle(page) {
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
}

async function nativeDrop(page, target, paths, edge) {
  const position = await pointAt(target, edge);
  await page.evaluate(
    ({ paths, position }) => {
      window.pageEmit("tauri://drag-enter", { paths, position });
      window.pageEmit("tauri://drag-drop", { paths, position });
    },
    { paths, position },
  );
  await settle(page);
}

async function internalDrop(page, target, paths, edge, local = false) {
  const position = await pointAt(target, edge);
  return page.evaluate(
    async ({ paths, position, local }) => {
      const data = new DataTransfer();
      if (local) {
        const { writeFileDrag } = await import("/src/lib/filePreview.ts");
        writeFileDrag(
          data,
          paths.map((path) => ({ path, isDir: false })),
        );
      } else {
        data.setData(
          "application/x-totex-files",
          JSON.stringify(paths.map((path) => ({ path, isDir: false }))),
        );
        data.setData("text/plain", paths.join("\n"));
      }
      const target = document.elementFromPoint(position.x, position.y);
      const bubble = [];
      const observe = (event) => bubble.push(event.type);
      document.addEventListener("dragover", observe);
      document.addEventListener("drop", observe);
      const dispatch = (type) =>
        !target.dispatchEvent(
          new DragEvent(type, {
            bubbles: true,
            cancelable: true,
            clientX: position.x,
            clientY: position.y,
            dataTransfer: data,
          }),
        );
      const overPrevented = dispatch("dragover");
      const dropPrevented = dispatch("drop");
      document.removeEventListener("dragover", observe);
      document.removeEventListener("drop", observe);
      return { overPrevented, dropPrevented, bubble };
    },
    { paths, position, local },
  );
}

async function browserDrop(page, target, path) {
  const position = await pointAt(target);
  const client = await page.context().newCDPSession(page);
  try {
    for (const type of ["dragEnter", "dragOver", "drop"])
      await client.send("Input.dispatchDragEvent", {
        type,
        ...position,
        data: { items: [], files: [path], dragOperationsMask: 1 },
      });
  } finally {
    await client.detach();
  }
}

async function switchTerminal(page, number, id) {
  await page.locator('[data-terminal-shown="true"] .xterm-helper-textarea').focus();
  await page.keyboard.press(`Control+${number}`);
  await page.locator(`[data-session-canvas="${id}"]`).waitFor({ state: "visible" });
}

async function panes(page, id) {
  return page.evaluate((id) => window.canvasStates[id]?.panes ?? [], id);
}

export async function verifyCanvasDropsWithoutTerminal(page, base = "http://127.0.0.1:18426") {
  await installCanvasNative(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  for (const action of ["layout", "page", "double-click", "multiple"]) {
    await page.goto(`${base}/tests/fixtures/pages.html?canvas&onlyterminals&no-sessions`);
    await page.locator(".layout-bounds").waitFor();
    await page.locator("#folder-sidebar").getByText("tmp", { exact: true }).first().click();
    await page.locator('[data-pick-row="/tmp/sub"]').click();
    const file = page.locator('[data-pick-row="/tmp/sub/child.txt"]');
    await file.waitFor();
    assert.equal(await page.locator("[data-session-canvas]").count(), 0);
    if (action === "double-click") await file.dblclick();
    else if (action === "multiple")
      await internalDrop(page, page.locator("main .canvas-empty"), [
        "/tmp/sub/child.txt",
        "/tmp/note.txt",
      ]);
    else {
      const from = await file.boundingBox();
      const to = await page
        .locator(action === "layout" ? ".layout-bounds" : "main .canvas-empty")
        .boundingBox();
      await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
      await page.mouse.down();
      await page.mouse.move(from.x + from.width / 2 + 10, from.y + from.height / 2, { steps: 3 });
      await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 8 });
      await page.locator(".canvas-drop-preview").waitFor();
      await page.mouse.up();
    }
    await page.getByRole("textbox", { name: "child.txt", exact: true }).waitFor();
    if (action === "multiple")
      await page.getByRole("textbox", { name: "note.txt", exact: true }).waitFor();
    const started = await page.evaluate(() =>
      window.pageCalls.filter(({ cmd }) => cmd === "pty_open"),
    );
    assert.equal(started.length, 1, `${action}: starts exactly one terminal`);
    assert.equal(started[0].args.cwd, action === "double-click" ? "/tmp" : "/tmp/sub");
    assert.equal(await page.locator("[data-session-canvas]").count(), 1);
    assert.equal(
      await page.locator("[data-canvas-kind=file]").count(),
      action === "multiple" ? 2 : 1,
    );
  }
  return { emptyLayoutBox: true, emptyPage: true, doubleClick: true, oneSessionPerDrop: true };
}

/** Centers belong to the page; edges add panes for native and explorer file drops. */
export async function verifyCanvasDrops(page, base = "http://127.0.0.1:18426") {
  await page.setViewportSize({ width: 1600, height: 1000 });
  const errors = [];
  const collect = (error) => errors.push(error.message);
  page.on("pageerror", collect);
  const directory = await mkdtemp(join(tmpdir(), "totex-drop-"));
  const browserPath = join(directory, "browser upload.txt");
  await writeFile(browserPath, "Browser file bytes 日本語\n");
  try {
    await page.addInitScript({ content: await readFile(bridge, "utf8") });
    await page.addInitScript({ content: await readFile(uploadBridge, "utf8") });
    await installCanvasNative(page);
    await page.route(uploadUrl, (route) =>
      route.fulfill({ contentType: "text/html", body: uploadDocument(true) }),
    );
    await page.route(nestedUrl, (route) =>
      route.fulfill({ contentType: "text/html", body: uploadDocument() }),
    );
    await page.addInitScript(() => {
      if (window.top !== window) return;
      localStorage.removeItem("totex.canvas.layouts");
      window.canvasStates["terminal-one"].panes = [
        { id: "upload", kind: "iframe", url: "http://127.0.0.1:18424/upload" },
        { id: "blank", kind: "empty" },
      ];
      window.canvasStates["terminal-other"] = { id: "terminal-other", revision: 1, panes: [] };
    });
    const fixture = `${base}/tests/fixtures/pages.html?canvas&grouped&onlyterminals`;
    const first = page.locator('[data-session-canvas="terminal-one"]');
    const editor = (name) => page.getByRole("textbox", { name, exact: true });
    const reset = async () => {
      await page.goto(fixture);
      await page.locator('[data-layout-pane="blank"]').waitFor();
      await first
        .frameLocator("iframe")
        .frameLocator("iframe")
        .getByText("Drop a file in this application", { exact: true })
        .waitFor();
      await settle(page);
    };
    await reset();
    const upload = page.frame({ url: uploadUrl });
    const nested = page.frame({ url: nestedUrl });
    await browserDrop(page, upload.locator("#drop"), browserPath);
    await upload.waitForFunction(() => window.uploads.length === 1);
    assert.equal(
      await upload.evaluate(() => window.uploads[0].files[0].text),
      "Browser file bytes 日本語\n",
    );
    await browserDrop(page, nested.locator("#drop"), browserPath);
    await nested.waitForFunction(() => window.uploads.length === 1);
    assert.equal(await upload.evaluate(() => typeof window.__TAURI_INTERNALS__), "undefined");

    // Native and explorer drops deliver actual files to the running app, including nested frames.
    await nativeDrop(page, upload.locator("#drop"), ["/tmp/dropped.txt", "/tmp/note.txt"]);
    await upload.waitForFunction(() => window.uploads.length === 2);
    assert.deepEqual(await upload.evaluate(() => window.uploads[1].files), [
      { name: "dropped.txt", type: "text/plain", size: 17, text: "Dropped file text" },
      { name: "note.txt", type: "text/plain", size: 10, text: "saved text" },
    ]);
    await internalDrop(page, nested.locator("#drop"), ["/tmp/note.txt"], undefined, true);
    await nested.waitForFunction(() => window.uploads.length === 2);
    assert.equal(await nested.evaluate(() => window.uploads[1].files[0].text), "saved text");
    await nativeDrop(page, nested.locator("input"), ["/tmp/dropped.txt"]);
    await nested.waitForFunction(() => window.uploads.length === 3);
    assert.equal(await nested.evaluate(() => window.uploads[2].type), "change");
    assert.equal(await nested.evaluate(() => window.uploads[2].files[0].text), "Dropped file text");

    // A MIME marker from outside the app must never authorize reading and uploading local files.
    const reads = () =>
      page.evaluate(() => window.pageCalls.filter(({ cmd }) => cmd === "fs_read_file").length);
    const readCount = await reads();
    await internalDrop(page, upload.locator("#drop"), ["/tmp/private.txt"]);
    await settle(page);
    assert.equal(await reads(), readCount);
    assert.equal(await upload.evaluate(() => window.uploads.length), 2);
    assert.equal(await page.locator(".canvas-drop-preview").count(), 0);

    // Failed reads report the failure and leave both the page and the upload unchanged.
    await page.evaluate(() => {
      window.pageReadRefused = true;
    });
    await nativeDrop(page, upload.locator("#drop"), ["/tmp/dropped.txt"]);
    await page
      .getByRole("alert")
      .filter({ hasText: "Could not upload the dropped files" })
      .waitFor();
    assert.equal(await upload.evaluate(() => window.uploads.length), 2);
    await page.evaluate(() => {
      window.pageReadRefused = false;
    });
    await page.getByRole("alert").getByRole("button", { name: "Close" }).click();

    assert.deepEqual(
      (await panes(page, "terminal-one")).map((p) => p.id),
      ["upload", "blank"],
    );
    assert.ok(!upload.isDetached(), "Uploads never reload or replace the running page");

    // The layout map preserves occupied centers too; an empty pane still opens the file.
    await nativeDrop(page, page.locator('[data-layout-pane="upload"]'), ["/tmp/dropped.txt"]);
    assert.deepEqual(
      (await panes(page, "terminal-one")).map((p) => p.id),
      ["upload", "blank"],
    );
    const accepted = await internalDrop(page, first.locator('[data-canvas-pane="blank"]'), [
      "/tmp/note.txt",
    ]);
    assert.equal(accepted.overPrevented, true);
    assert.equal(accepted.dropPrevented, true);
    await editor("note.txt").waitFor();
    assert.equal((await panes(page, "terminal-one")).length, 2, "A center drop opens exactly once");
    await editor("note.txt").fill("unsaved work");
    await nativeDrop(page, editor("note.txt"), ["/tmp/dropped.txt"]);
    await internalDrop(page, editor("note.txt"), ["/tmp/dropped.txt"], undefined, true);
    assert.equal(await editor("note.txt").innerText(), "unsaved work");
    assert.equal((await panes(page, "terminal-one")).length, 2);

    // Both drop sources and both surfaces use the same preview and all four root edges.
    for (const [edge, miniature, native] of [
      ["left", true, true],
      ["right", false, true],
      ["top", true, false],
      ["bottom", false, false],
    ]) {
      await reset();
      const running = page.frame({ url: uploadUrl });
      const target = miniature ? page.locator(".layout-bounds") : first;
      const position = await pointAt(target, edge);
      await page.evaluate(
        ({ position, native }) => {
          if (native) {
            window.pageEmit("tauri://drag-enter", { paths: ["/tmp/dropped.txt"], position });
          } else {
            const data = new DataTransfer();
            data.setData("application/x-totex-file", "/tmp/dropped.txt");
            window.testFileDrag = data;
            document.elementFromPoint(position.x, position.y).dispatchEvent(
              new DragEvent("dragover", {
                bubbles: true,
                cancelable: true,
                clientX: position.x,
                clientY: position.y,
                dataTransfer: data,
              }),
            );
          }
        },
        { position, native },
      );
      const preview = page.locator(".canvas-drop-preview");
      await preview.waitFor();
      assert.equal(await preview.getAttribute("data-edge"), edge);
      const previewBox = await preview.boundingBox();
      const hostBox = await preview.locator("..").boundingBox();
      assert.ok(
        Math.abs((previewBox.width * previewBox.height) / (hostBox.width * hostBox.height) - 0.5) <
          0.02,
      );
      if (edge === "left")
        await page.screenshot({ path: "/tmp/totex-file-drop-preview.png", animations: "disabled" });
      await page.evaluate(
        ({ position, native }) => {
          if (native)
            window.pageEmit("tauri://drag-drop", { paths: ["/tmp/dropped.txt"], position });
          else
            document.elementFromPoint(position.x, position.y).dispatchEvent(
              new DragEvent("drop", {
                bubbles: true,
                cancelable: true,
                clientX: position.x,
                clientY: position.y,
                dataTransfer: window.testFileDrag,
              }),
            );
        },
        { position, native },
      );
      await editor("dropped.txt").waitFor();
      await page.waitForFunction((edge) => {
        const canvas = document
          .querySelector('[data-session-canvas="terminal-one"]')
          .getBoundingClientRect();
        const pane = [...document.querySelectorAll("[data-canvas-pane]")]
          .find((p) => p.querySelector('[aria-label="dropped.txt"]'))
          .getBoundingClientRect();
        const horizontal = edge === "left" || edge === "right";
        return (
          Math.abs(pane.width / canvas.width - (horizontal ? 0.5 : 1)) < 0.01 &&
          Math.abs(pane.height / canvas.height - (horizontal ? 1 : 0.5)) < 0.01 &&
          Math.abs((pane.x - canvas.x) / canvas.width - (edge === "right" ? 0.5 : 0)) < 0.01 &&
          Math.abs((pane.y - canvas.y) / canvas.height - (edge === "bottom" ? 0.5 : 0)) < 0.01
        );
      }, edge);
      assert.deepEqual(
        (await panes(page, "terminal-one")).slice(0, 2).map((p) => p.id),
        ["upload", "blank"],
      );
      assert.ok(!running.isDetached(), "Splitting keeps the running iframe mounted");
      assert.equal(await preview.count(), 0);
    }

    // A pane's inner edge divides only that pane, on the page and in its miniature.
    for (const miniature of [true, false]) {
      await reset();
      const whole = await first.boundingBox();
      const original = await first.locator('[data-canvas-pane="upload"]').boundingBox();
      const edge = original.width < whole.width * 0.9 ? "right" : "bottom";
      const target = miniature
        ? page.locator('[data-layout-pane="upload"]')
        : first.locator('[data-canvas-pane="upload"]');
      await internalDrop(page, target, ["/tmp/dropped.txt"], edge);
      await editor("dropped.txt").waitFor();
      await settle(page);
      const file = await editor("dropped.txt")
        .locator("xpath=ancestor::*[@data-canvas-pane]")
        .boundingBox();
      assert.ok(
        Math.abs((file.width * file.height) / (original.width * original.height) - 0.5) < 0.02,
      );
      const untouched = await first.locator('[data-canvas-pane="blank"]').boundingBox();
      assert.ok(
        Math.abs((untouched.width * untouched.height) / (whole.width * whole.height) - 0.5) < 0.02,
      );
    }

    // Empty canvases, expanded pages, terminal ownership and terminal path drops.
    await switchTerminal(page, 2, "terminal-two");
    const second = page.locator('[data-session-canvas="terminal-two"]');
    const code = second.locator('[data-canvas-pane="worker-code"]');
    await code.focus();
    await page.keyboard.press("Shift+F10");
    await page.getByRole("menuitem", { name: "Expand", exact: true }).click();
    await page.getByRole("menu").waitFor({ state: "hidden" });
    const expanded = code.locator("dialog[open]");
    await expanded.waitFor();
    await nativeDrop(page, expanded, ["/tmp/expanded.txt"], "left");
    await editor("expanded.txt").waitFor();
    assert.equal(await expanded.count(), 0, "A split restores the grid so both panes are visible");
    assert.equal(await code.count(), 1);
    assert.equal((await panes(page, "terminal-one")).length, 3);
    await code.hover();
    await nativeDrop(page, code, ["/tmp/center.txt"]);
    assert.equal(await editor("center.txt").count(), 0);
    assert.equal(await code.count(), 1);
    assert.equal((await panes(page, "terminal-two")).length, 2);

    await switchTerminal(page, 3, "terminal-other");
    const empty = page.locator('[data-session-canvas="terminal-other"]');
    await nativeDrop(page, empty, ["/tmp/one.txt", "/tmp/two.txt"]);
    await editor("one.txt").waitFor();
    await editor("two.txt").waitFor();
    assert.equal((await panes(page, "terminal-other")).length, 2);
    const terminal = page.locator('#cli-sidebar [data-terminal="terminal-other"]');
    await nativeDrop(page, terminal, ["/tmp/two words.txt"]);
    await page.waitForFunction(() =>
      window.pageCalls.some(
        ({ cmd, args }) =>
          cmd === "pty_write" &&
          args.id === "terminal-other" &&
          args.data.includes("'/tmp/two words.txt'"),
      ),
    );
    assert.equal((await panes(page, "terminal-other")).length, 2);

    // A pre-existing file-0 must not swallow a new double-click after a frontend restart.
    await reset();
    await page.evaluate(() => {
      window.canvasStates["terminal-one"].panes.push({
        id: "file-0",
        kind: "file",
        path: "/tmp/note.txt",
      });
      window.canvasStates["terminal-one"].revision++;
    });
    await editor("note.txt").waitFor();
    await page.locator("#folder-sidebar").getByText("tmp", { exact: true }).first().click();
    await page.locator('[data-pick-row="/tmp/sub"]').click();
    const entry = page.locator('[data-pick-row="/tmp/sub/child.txt"]');
    const source = await entry.boundingBox();
    const running = page.frame({ url: uploadUrl });
    const uploadTo = await running.locator("#drop").boundingBox();
    await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
    await page.mouse.down();
    await page.mouse.move(source.x + source.width / 2 + 10, source.y + source.height / 2, {
      steps: 3,
    });
    await page.mouse.move(uploadTo.x + uploadTo.width / 2, uploadTo.y + uploadTo.height / 2, {
      steps: 10,
    });
    assert.equal(await page.locator(".canvas-drop-preview").count(), 0);
    await page.mouse.up();
    await running.waitForFunction(() => window.uploads.length === 1);
    assert.equal(
      await running.evaluate(() => window.uploads[0].files[0].text),
      "Explorer file text",
    );
    await entry.dblclick();
    await editor("child.txt").waitFor();
    assert.equal(
      (await panes(page, "terminal-one")).filter((p) => p.path === "/tmp/sub/child.txt").length,
      1,
    );
    assert.equal(await page.locator('[data-canvas-pane="file-0"]').count(), 1);

    const before = (await panes(page, "terminal-one")).length;
    const to = await page.locator(".layout-bounds").boundingBox();
    await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
    await page.mouse.down();
    await page.mouse.move(source.x + source.width / 2 + 10, source.y + source.height / 2, {
      steps: 3,
    });
    await page.mouse.move(to.x + 2, to.y + to.height / 2, { steps: 10 });
    await page.locator(".canvas-drop-preview").waitFor();
    await page.mouse.up();
    await page.waitForFunction(
      (before) => window.canvasStates["terminal-one"].panes.length === before + 1,
      before,
    );
    assert.equal(
      await page.evaluate(() =>
        window.pageCalls.some(({ cmd }) =>
          ["fs_move_into", "fs_copy_into", "fs_delete_file"].includes(cmd),
        ),
      ),
      false,
    );
    await page.screenshot({ path: "/tmp/totex-file-drop-result.png", animations: "disabled" });
    assert.deepEqual(errors, []);
    return {
      emptyCenterOpen: true,
      occupiedCenterPreserved: true,
      nestedUploads: true,
      uploadFailure: true,
      trustedFilesOnly: true,
      snapEdges: true,
      nestedSplits: true,
      nativeAndPointerDrag: true,
      doubleClick: true,
      iframeRetention: true,
      expanded: true,
      terminalOwnership: true,
    };
  } finally {
    page.off("pageerror", collect);
    await rm(directory, { recursive: true, force: true });
  }
}
