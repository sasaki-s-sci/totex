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
        ? box.x + 12
        : edge === "right"
          ? box.x + box.width - 12
          : box.x + box.width / 2,
    y:
      edge === "top"
        ? box.y + 12
        : edge === "bottom"
          ? box.y + box.height - 12
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

/** Native path routing and real browser file drops share the same live iframe fixture. */
export async function verifyCanvasDrops(page, base = "http://127.0.0.1:18422") {
  await page.setViewportSize({ width: 1600, height: 1000 });
  const errors = [];
  const collect = (error) => errors.push(error.message);
  page.on("pageerror", collect);
  const directory = await mkdtemp(join(tmpdir(), "totex-drop-"));
  const browserPath = join(directory, "browser upload.txt");
  const browserText = "Browser file bytes 日本語\n";
  await writeFile(browserPath, browserText);
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
      window.canvasStates["terminal-one"].panes = [
        { id: "upload", kind: "iframe", url: "http://127.0.0.1:18424/upload" },
        { id: "blank", kind: "empty" },
      ];
      window.canvasStates["terminal-other"] = { id: "terminal-other", revision: 1, panes: [] };
      for (const name of [
        "blank",
        "frame-edge",
        "edge",
        "native-edge",
        "expanded-edge",
        "empty-canvas",
      ])
        window.pageFiles[`/tmp/${name}.txt`] = `Preview of ${name}`;
      const nativeFiles = {
        "C:\\private\\native upload.txt": [
          ...new TextEncoder().encode("Native file bytes 日本語\n"),
        ],
        "/tmp/native.png": [
          ...atob(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGOQ8LL+DwACuAGd8psO1AAAAABJRU5ErkJggg==",
          ),
        ].map((character) => character.charCodeAt(0)),
      };
      const invoke = window.__TAURI_INTERNALS__.invoke;
      window.__TAURI_INTERNALS__.invoke = (cmd, args) => {
        if (cmd !== "fs_read_file" || !nativeFiles[args.path]) return invoke(cmd, args);
        window.pageCalls.push({ cmd, args });
        if (window.holdNativeRead)
          return new Promise((resolve) => {
            window.releaseNativeRead = () => resolve(nativeFiles[args.path]);
          });
        return Promise.resolve(nativeFiles[args.path]);
      };
    });
    await page.goto(`${base}/tests/fixtures/pages.html?canvas&grouped&onlyterminals`);
    const first = page.locator('[data-session-canvas="terminal-one"]');
    await first.locator('[data-canvas-pane="blank"]').waitFor();
    await first
      .frameLocator("iframe")
      .frameLocator("iframe")
      .getByText("Drop a file in this application", { exact: true })
      .waitFor();
    const upload = page.frame({ url: uploadUrl });
    assert.ok(upload);
    await upload
      .frameLocator("iframe")
      .getByText("Drop a file in this application", { exact: true })
      .waitFor();
    const nested = page.frame({ url: nestedUrl });
    assert.ok(nested);

    await browserDrop(page, upload.locator("#drop"), browserPath);
    await upload.waitForFunction(() => window.uploads.length === 1);
    const expectedFile = {
      name: "browser upload.txt",
      type: "text/plain",
      size: Buffer.byteLength(browserText),
      text: browserText,
    };
    assert.deepEqual(
      await upload.evaluate(() => window.uploads),
      [{ type: "drop", trusted: true, files: [expectedFile] }],
      "The served application's upload handler receives a real File and its contents",
    );
    await browserDrop(page, upload.getByLabel("Upload files"), browserPath);
    await upload.waitForFunction(() => window.uploads.length === 2);
    assert.deepEqual(
      await upload.evaluate(() => window.uploads[1]),
      { type: "change", trusted: true, files: [expectedFile] },
      "A native browser drop still populates the application's file input",
    );
    await browserDrop(page, nested.locator("#drop"), browserPath);
    await nested.waitForFunction(() => window.uploads.length === 1);
    assert.deepEqual(await nested.evaluate(() => window.uploads[0].files), [expectedFile]);
    assert.deepEqual(
      (await panes(page, "terminal-one")).map((pane) => pane.id),
      ["upload", "blank"],
      "Application uploads never create file preview panes",
    );
    assert.equal(await upload.evaluate(() => typeof window.__TAURI_INTERNALS__), "undefined");

    const nativePath = "C:\\private\\native upload.txt";
    const nativeText = "Native file bytes 日本語\n";
    const nativeFile = {
      name: "native upload.txt",
      type: "text/plain",
      size: Buffer.byteLength(nativeText),
      text: nativeText,
    };
    await nativeDrop(page, upload.locator("#drop"), [nativePath]);
    await upload.waitForFunction(() => window.uploads.length === 3);
    assert.deepEqual(
      await upload.evaluate(() => window.uploads[2]),
      { type: "drop", trusted: false, files: [nativeFile] },
      "The Windows bridge supplies full file contents without exposing the native path",
    );
    await nativeDrop(page, upload.getByLabel("Upload files"), ["/tmp/native.png"]);
    await upload.waitForFunction(() => window.uploads.length === 4);
    assert.deepEqual(
      await upload
        .getByLabel("Upload files")
        .evaluate((input) =>
          [...input.files].map((file) => ({ name: file.name, type: file.type, size: file.size })),
        ),
      [{ name: "native.png", type: "image/png", size: 70 }],
      "Upload inputs receive the original filename and image MIME type",
    );
    await nativeDrop(page, nested.locator("#drop"), [nativePath]);
    await nested.waitForFunction(() => window.uploads.length === 2);
    assert.deepEqual(
      await nested.evaluate(() => window.uploads[1].files),
      [nativeFile],
      "Native files traverse nested iframe borders and coordinate offsets",
    );
    await upload.getByLabel("Upload files").evaluate((input) => {
      input.multiple = false;
    });
    await nativeDrop(page, upload.getByLabel("Upload files"), [nativePath, "/tmp/native.png"]);
    await upload.waitForFunction(() => window.uploads.length === 5);
    assert.deepEqual(
      await upload.evaluate(() => window.uploads[4].files),
      [nativeFile],
      "An input that accepts one file receives only the first drop entry",
    );
    await upload.getByLabel("Upload files").evaluate((input) => {
      input.disabled = true;
    });
    await nativeDrop(page, upload.getByLabel("Upload files"), [nativePath]);
    assert.equal(
      await upload.evaluate(() => window.uploads.length),
      5,
      "Disabled inputs remain disabled during native drops",
    );
    await upload.getByLabel("Upload files").evaluate((input) => {
      input.disabled = false;
      input.addEventListener("drop", (event) => event.preventDefault(), { once: true });
    });
    await nativeDrop(page, upload.getByLabel("Upload files"), ["/tmp/native.png"]);
    assert.equal(
      await upload.evaluate(() => window.uploads.length),
      5,
      "The application's preventDefault overrides the file-input fallback",
    );

    await upload.evaluate(() => {
      const box = document.querySelector("#drop").getBoundingClientRect();
      window.postMessage(
        {
          type: "totex:frame-file-drop",
          x: box.x + 40,
          y: box.y + 40,
          files: [new File(["spoof"], "spoof.txt")],
        },
        "*",
      );
      parent.postMessage(
        { type: "totex:frame-file-drop", x: 40, y: 40, paths: ["/private/secret"] },
        "*",
      );
    });
    const wrapper = upload.parentFrame();
    await wrapper.evaluate(() => {
      const frame = document.querySelector("iframe");
      for (const data of [
        { x: NaN, y: 50, files: [new File(["spoof"], "spoof.txt")] },
        { x: 50, y: 50, files: [{ name: "spoof.txt", path: "/private/secret" }] },
      ])
        frame.contentWindow.postMessage(
          { type: "totex:frame-file-drop", ...data },
          "http://127.0.0.1:18424",
        );
    });
    await settle(page);
    assert.equal(
      await upload.evaluate(() => window.uploads.length),
      5,
      "The bridge rejects self messages, nonfinite coordinates and forged Files",
    );
    assert.equal(
      await page.evaluate(() =>
        window.pageCalls.some(
          ({ cmd, args }) => cmd === "fs_read_file" && args.path === "/private/secret",
        ),
      ),
      false,
    );

    await page.evaluate(() => {
      window.holdNativeRead = true;
    });
    await nativeDrop(page, upload.locator("#drop"), [nativePath]);
    await page.waitForFunction(() => typeof window.releaseNativeRead === "function");
    await switchTerminal(page, 2, "terminal-two");
    await page.evaluate(() => {
      window.holdNativeRead = false;
      window.releaseNativeRead();
    });
    await settle(page);
    assert.equal(
      await upload.evaluate(() => window.uploads.length),
      5,
      "Switching terminals cancels an unfinished upload to its hidden page",
    );
    await switchTerminal(page, 1, "terminal-one");
    assert.deepEqual(
      (await panes(page, "terminal-one")).map((pane) => pane.id),
      ["upload", "blank"],
      "Native application uploads never open extra preview panes",
    );
    await internalDrop(page, upload.locator("#drop"), ["/private/secret"]);
    await settle(page);
    assert.equal(
      await page.evaluate(() =>
        window.pageCalls.some(
          ({ cmd, args }) => cmd === "fs_read_file" && args.path === "/private/secret",
        ),
      ),
      false,
      "An arbitrary custom drag MIME cannot request native file reads",
    );
    await internalDrop(page, upload.locator("#drop"), [nativePath], undefined, true);
    await upload.waitForFunction(() => window.uploads.length === 6);
    assert.deepEqual(
      await upload.evaluate(() => window.uploads[5].files),
      [nativeFile],
      "Only a file drag created by totex can upload native paths through the iframe center",
    );

    const accepted = await internalDrop(page, first.locator('[data-canvas-pane="blank"]'), [
      "/tmp/blank.txt",
    ]);
    assert.equal(accepted.overPrevented, true);
    assert.equal(accepted.dropPrevented, true);
    await first.getByRole("textbox", { name: "blank.txt", exact: true }).waitFor();
    assert.deepEqual(
      (await panes(page, "terminal-one")).map((pane) => pane.path ?? pane.id),
      ["upload", "/tmp/blank.txt"],
      "An empty pane is filled once, without a duplicate from the outer canvas",
    );
    await nativeDrop(
      page,
      first.locator('[data-canvas-pane="upload"]'),
      ["/tmp/frame-edge.txt"],
      "bottom",
    );
    await first.getByRole("textbox", { name: "frame-edge.txt", exact: true }).waitFor();
    assert.deepEqual(
      (await panes(page, "terminal-one")).map((pane) => pane.path ?? pane.id),
      ["upload", "/tmp/frame-edge.txt", "/tmp/blank.txt"],
      "A web application's outer edge opens a sibling preview while preserving the application",
    );
    assert.equal(await upload.evaluate(() => window.uploads.length), 6);

    await switchTerminal(page, 2, "terminal-two");
    const second = page.locator('[data-session-canvas="terminal-two"]');
    const code = second.locator('[data-canvas-pane="worker-code"]');
    const beforeCenter = await panes(page, "terminal-two");
    assert.deepEqual(
      await internalDrop(page, code, ["/tmp/ignored.txt"]),
      {
        overPrevented: false,
        dropPrevented: false,
        bubble: ["dragover", "drop"],
      },
      "Occupied content keeps its drag/drop events in the center",
    );
    await nativeDrop(page, code, ["/tmp/ignored-native.txt"]);
    assert.deepEqual(
      await panes(page, "terminal-two"),
      beforeCenter,
      "An occupied pane's center never opens a native file preview",
    );

    await internalDrop(page, code, ["/tmp/edge.txt"], "right");
    await second.getByRole("textbox", { name: "edge.txt", exact: true }).waitFor();
    assert.deepEqual(
      (await panes(page, "terminal-two")).map((pane) => pane.path ?? pane.id),
      ["worker-code", "/tmp/edge.txt"],
      "An edge drop inserts beside the addressed pane",
    );
    await nativeDrop(page, code, ["/tmp/native-edge.txt"], "left");
    await second.getByRole("textbox", { name: "native-edge.txt", exact: true }).waitFor();
    assert.deepEqual(
      (await panes(page, "terminal-two")).map((pane) => pane.path ?? pane.id),
      ["worker-code", "/tmp/native-edge.txt", "/tmp/edge.txt"],
      "Native edge routing preserves the source and its terminal owner",
    );
    assert.deepEqual(
      (await panes(page, "terminal-one")).map((pane) => pane.path ?? pane.id),
      ["upload", "/tmp/frame-edge.txt", "/tmp/blank.txt"],
    );
    await code.click({ button: "right" });
    await page.getByRole("menuitem", { name: "Expand", exact: true }).click();
    const expanded = code.locator("dialog[open]");
    await expanded.waitFor();
    const expandedEdge = await pointAt(expanded, "left");
    const mainBox = await page.locator("main").boundingBox();
    assert.ok(
      expandedEdge.x < mainBox.x,
      "The expanded pane extends beyond the original canvas bounds",
    );
    await nativeDrop(page, expanded, ["/tmp/expanded-edge.txt"], "left");
    await page.waitForFunction(() =>
      window.canvasStates["terminal-two"].panes.some(
        (pane) => pane.path === "/tmp/expanded-edge.txt",
      ),
    );
    assert.deepEqual(
      (await panes(page, "terminal-two")).map((pane) => pane.path ?? pane.id),
      ["worker-code", "/tmp/expanded-edge.txt", "/tmp/native-edge.txt", "/tmp/edge.txt"],
      "A native drop on an expanded edge stays with its pane even outside the normal canvas box",
    );
    await expanded.getByRole("button", { name: "Close", exact: true }).click();
    await second.getByRole("textbox", { name: "expanded-edge.txt", exact: true }).waitFor();

    await switchTerminal(page, 3, "terminal-other");
    const empty = page.locator('[data-session-canvas="terminal-other"]');
    await nativeDrop(page, empty, ["/tmp/empty-canvas.txt"]);
    await empty.getByRole("textbox", { name: "empty-canvas.txt", exact: true }).waitFor();
    assert.deepEqual(
      (await panes(page, "terminal-other")).map((pane) => pane.path),
      ["/tmp/empty-canvas.txt"],
    );

    const terminal = page.locator('#cli-sidebar [data-terminal="terminal-other"]');
    const paths = ["/tmp/one.txt", "/tmp/two words.txt"];
    await nativeDrop(page, terminal, paths);
    await page.waitForFunction(() =>
      window.pageCalls.some(
        ({ cmd, args }) =>
          cmd === "pty_write" &&
          args.id === "terminal-other" &&
          args.data.includes("'/tmp/two words.txt'"),
      ),
    );
    await internalDrop(page, terminal, ["/tmp/internal path.txt"]);
    await page.waitForFunction(() =>
      window.pageCalls.some(
        ({ cmd, args }) =>
          cmd === "pty_write" &&
          args.id === "terminal-other" &&
          args.data.includes("'/tmp/internal path.txt'"),
      ),
    );
    assert.deepEqual(
      (await panes(page, "terminal-other")).map((pane) => pane.path),
      ["/tmp/empty-canvas.txt"],
      "Terminal drops still paste paths without creating preview panes",
    );
    assert.deepEqual(errors, []);
    return {
      browserUploads: true,
      nativeUploads: true,
      nestedUploads: true,
      emptyAreas: true,
      paneEdges: true,
      terminalPaths: true,
    };
  } finally {
    page.off("pageerror", collect);
    await rm(directory, { recursive: true, force: true });
  }
}
