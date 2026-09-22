import assert from "node:assert/strict";

/** Real Window, React Flow, file editors and xterm; only native IPC is replaced. */
export async function verifyPages(page, base = "http://127.0.0.1:18422") {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem("totex.language", "en");
    let serial = 0;
    const callbacks = new Map();
    window.pageCalls = [];
    window.pageWriteRefused = false;
    window.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
      transformCallback(callback) {
        callbacks.set(++serial, callback);
        return serial;
      },
      unregisterCallback(id) {
        callbacks.delete(id);
      },
      async invoke(cmd, args) {
        window.pageCalls.push({ cmd, args });
        if (cmd === "plugin:event|listen") return ++serial;
        if (cmd === "pty_sessions")
          return [
            { id: "terminal-one", cwd: "/tmp", rows: 24, cols: 80, meta: '{"branch":"main"}' },
          ];
        if (cmd === "pty_attach") return { text: "Retained terminal\r\n", upto: 0 };
        if (
          [
            "pty_asking",
            "pty_doing",
            "mcp_reports",
            "list_roots",
            "describe_folders",
            "update_standing",
          ].includes(cmd)
        )
          return [];
        if (cmd === "app_settings_read")
          return {
            path: "/tmp/totex.json",
            text: JSON.stringify(args.initial),
            value: args.initial,
          };
        if (cmd === "read_file_head")
          return {
            path: args.path,
            name: "note.txt",
            text: "saved text",
            size: 10,
            truncated: false,
          };
        if (cmd === "write_file") {
          if (window.pageWriteRefused) throw new Error("Write refused");
          return args.text.length;
        }
        if (cmd === "file_diff")
          return { standing: "unknown", patch: "", truncated: false, runs: [] };
        return null;
      },
    };
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
  });
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto(`${base}/tests/fixtures/pages.html`);
  await page.getByRole("textbox", { name: "note.txt", exact: true }).waitFor();
  await page.locator('[data-terminal="terminal-one"] .xterm-screen').waitFor();
  await page.locator(".settings-page input").first().waitFor();
  const sidebar = page.locator("#cli-sidebar");
  const terminal = page.locator('[data-terminal="terminal-one"]');
  const note = page.getByRole("textbox", { name: "note.txt", exact: true });
  await page.evaluate(() => {
    window.heldTerminal = document.querySelector('[data-terminal="terminal-one"]');
    window.heldSettings = document.querySelector(".settings-page input");
    window.heldNote = document.querySelector('[role="textbox"][aria-label="note.txt"]');
    window.initialAttaches = window.pageCalls.filter((call) => call.cmd === "pty_attach").length;
  });

  // Settings are an ordinary page and keep their form instance when docked.
  await page.getByRole("button", { name: "Move totex.json to the sidebar", exact: true }).click();
  await sidebar.locator(".settings-page").waitFor();
  assert.equal(
    await sidebar
      .locator(".settings-page input")
      .first()
      .evaluate((element) => element === window.heldSettings),
    true,
  );
  await sidebar
    .getByRole("combobox", { name: "Select page" })
    .selectOption("terminal:terminal-one");
  await page.getByRole("button", { name: "Move main to the canvas", exact: true }).click();
  await page.locator('.react-flow__node-cli-page [data-terminal="terminal-one"]').waitFor();
  assert.equal(await terminal.evaluate((element) => element === window.heldTerminal), true);
  assert.equal(await terminal.count(), 1);
  assert.equal(
    await terminal.evaluate((element) => element.contains(document.activeElement)),
    true,
    "Moving a terminal restores keyboard focus",
  );
  await page.getByRole("button", { name: "Fold main away", exact: true }).click();
  await page.waitForFunction(
    () => !document.querySelector('[data-terminal="terminal-one"]').getClientRects().length,
  );
  await page.getByRole("button", { name: "Open main", exact: true }).click();
  await page.getByRole("button", { name: "Move main to the sidebar", exact: true }).click();
  await sidebar.locator('[data-terminal="terminal-one"]').waitFor();
  assert.equal(await terminal.evaluate((element) => element === window.heldTerminal), true);
  assert.equal(
    await page.evaluate(
      () =>
        window.pageCalls.filter((call) => call.cmd === "pty_attach").length ===
        window.initialAttaches,
    ),
    true,
  );

  // Failed writes leave the draft and its page in place.
  await note.fill("edited content");
  await page.evaluate(() => {
    window.pageWriteRefused = true;
  });
  await page.getByRole("button", { name: "Move note.txt to the sidebar", exact: true }).click();
  await page.locator(".file-preview__unsaved.is-refused").waitFor();
  assert.equal(await note.evaluate((element) => !!element.closest(".react-flow__node")), true);
  assert.equal(await note.textContent(), "edited content");
  await page.evaluate(() => {
    window.pageWriteRefused = false;
  });
  await page.getByRole("button", { name: "Move note.txt to the sidebar", exact: true }).click();
  await sidebar.locator(".file-preview").waitFor();
  assert.equal(await note.evaluate((element) => element === window.heldNote), true);
  assert.equal(await note.textContent(), "edited content");
  assert.equal(await sidebar.getByRole("button", { name: "Pin note.txt", exact: true }).count(), 0);
  assert.equal(
    await sidebar.getByRole("button", { name: "Fold note.txt away", exact: true }).count(),
    0,
  );

  // Hiding is not closing, and the selector can reach every docked kind.
  await page.getByRole("button", { name: "Hide page sidebar", exact: true }).click();
  await page.getByRole("button", { name: "Show page sidebar", exact: true }).click();
  await sidebar.getByRole("combobox", { name: "Select page" }).selectOption("file:1");
  assert.equal(await note.textContent(), "edited content");
  await page.getByRole("button", { name: "Move note.txt to the canvas", exact: true }).click();
  await page.getByRole("button", { name: "Pin note.txt", exact: true }).click();
  const pinned = page.locator(".graph__pin").filter({ has: note });
  const before = await pinned.boundingBox();
  const bar = await pinned.locator(".page__name").boundingBox();
  await page.mouse.move(bar.x + 5, bar.y + 5);
  await page.mouse.down();
  await page.mouse.move(bar.x + 75, bar.y + 45, { steps: 5 });
  await page.mouse.up();
  const after = await pinned.boundingBox();
  assert.equal(
    after.x > before.x + 50 && after.y > before.y + 20,
    true,
    "Pinned host receives drag events through the portal",
  );
  await page.getByRole("button", { name: "Move note.txt to the sidebar", exact: true }).click();
  await page.getByRole("button", { name: "Move note.txt to the canvas", exact: true }).click();
  await pinned.waitFor();
  assert.equal(await note.evaluate((element) => element === window.heldNote), true);
  await page.getByRole("button", { name: "Unpin note.txt", exact: true }).click();
  const canvasCard = page.locator('.react-flow__node[data-id="file-preview:1"]');
  const oldBox = await canvasCard.boundingBox();
  const header = await canvasCard.locator(".page__name").boundingBox();
  await page.mouse.move(header.x + 5, header.y + 5);
  await page.mouse.down();
  await page.mouse.move(header.x + 55, header.y + 35, { steps: 5 });
  await page.mouse.up();
  const newBox = await canvasCard.boundingBox();
  assert.equal(
    newBox.x > oldBox.x + 30 && newBox.y > oldBox.y + 15,
    true,
    "Canvas drag survives reparenting",
  );

  await page.getByRole("button", { name: "Move note.txt to the sidebar", exact: true }).click();
  const snapshot = await page.evaluate(() => window.pageSnapshot());
  assert.equal(snapshot.values["pages.dockedFiles"].includes("file:1"), true);
  assert.equal(snapshot.values["pages.showingFile"], "file:1");
  assert.equal(
    snapshot.values["canvas.files"].find((node) => node.data.requestId === 1).data.text,
    "edited content",
  );
  await page.getByRole("button", { name: "Close note.txt", exact: true }).click();
  await page.waitForFunction(
    () => !document.querySelector('[role="textbox"][aria-label="note.txt"]'),
  );
  assert.equal(
    await page.evaluate(() => window.pageCalls.some((call) => call.cmd === "pty_close")),
    false,
  );
  assert.equal(errors.length, 0, errors.join("\n"));
  return {
    passed:
      "terminal identity, collapse, file/settings docking, failed saves, host capabilities, hiding, pinning, dragging, snapshot, close",
    errors,
  };
}
