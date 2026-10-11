import assert from "node:assert/strict";

/** Real Window, React Flow, file editors and xterm; only native IPC is replaced. */
export async function verifyPages(page, base = "http://127.0.0.1:18422", monitoringOnly = false) {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem("totex.language", "en");
    let serial = 0;
    const callbacks = new Map();
    const listeners = new Map();
    const overseers = new Map();
    window.pageCalls = [];
    window.pageWriteRefused = false;
    window.pageClipboard = "日本語\nsecond line";
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
        if (cmd === "plugin:clipboard-manager|read_text") return window.pageClipboard;
        if (cmd === "plugin:event|listen") {
          const id = ++serial;
          listeners.set(id, { event: args.event, callback: args.handler });
          return id;
        }
        if (cmd === "plugin:event|unlisten") {
          listeners.delete(args.eventId);
          return;
        }
        if (cmd === "overseer_sessions") return [...overseers.values()];
        if (cmd === "overseer_distros") return ["Ubuntu", "Debian"];
        if (cmd === "overseer_statuses") return [];
        if (cmd === "overseer_start" || cmd === "overseer_stop") {
          if (window.overseerRefused) throw new Error("Monitor unavailable");
          const scope = args?.distro ?? "";
          const ended = overseers.get(scope);
          if (cmd === "overseer_start")
            overseers.set(
              scope,
              scope ? `\\\\wsl.localhost\\${scope}\\home\\a\\monitor overseer` : "monitor-agent",
            );
          else overseers.delete(scope);
          const payload = [...overseers.values()];
          for (const [id, listener] of listeners) {
            if (listener.event === "overseer:session")
              callbacks.get(listener.callback)?.({ event: listener.event, id, payload });
            if (cmd === "overseer_stop" && ended && listener.event === "pty:exit")
              callbacks.get(listener.callback)?.({ event: listener.event, id, payload: ended });
          }
          return cmd === "overseer_start" ? overseers.get(scope) : null;
        }
        if (cmd === "pty_sessions")
          return [
            { id: "terminal-one", cwd: "/tmp", rows: 24, cols: 80, meta: '{"branch":"main"}' },
            ...[...overseers.values()].map((id) => ({
              id,
              cwd: id === "monitor-agent" ? "/tmp/monitor" : id.replace(/ overseer$/, ""),
              rows: 24,
              cols: 80,
              meta: '{"branch":"","overseer":true}',
            })),
          ];
        if (cmd === "pty_attach") return { text: "Retained terminal\r\n", upto: 0 };
        if (
          [
            "pty_asking",
            "pty_doing",
            "pty_typed",
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
  if (monitoringOnly) {
    const settings = page.locator(".settings-page");
    const local = settings.getByRole("checkbox", { name: "Monitor this machine's terminals" });
    const ubuntu = settings.getByRole("checkbox", { name: "Monitor WSL: Ubuntu terminals" });
    const debian = settings.getByRole("checkbox", { name: "Monitor WSL: Debian terminals" });
    await settings.getByText(/needs mirrored networking/).waitFor();
    await page.evaluate(() => {
      window.overseerRefused = true;
    });
    await local.click();
    await settings.getByRole("alert").filter({ hasText: "Monitor unavailable" }).waitFor();
    assert.equal(await local.isChecked(), false);
    await page.evaluate(() => {
      window.overseerRefused = false;
    });
    await local.click();
    await page.waitForFunction(
      () => document.querySelector('[aria-label="Monitor this machine\'s terminals"]')?.checked,
    );
    assert.equal(
      await settings.getByRole("alert").filter({ hasText: "Monitor unavailable" }).count(),
      0,
    );
    await page.locator('[data-terminal="monitor-agent"]').waitFor({ state: "attached" });
    // A second environment runs beside the first rather than replacing it.
    await ubuntu.click();
    await page.waitForFunction(
      () => document.querySelector('[aria-label="Monitor WSL: Ubuntu terminals"]')?.checked,
    );
    assert.deepEqual(
      await page.evaluate(
        () => window.pageCalls.filter(({ cmd }) => cmd === "overseer_start").at(-1).args,
      ),
      { distro: "Ubuntu" },
    );
    assert.equal(await local.isChecked(), true);
    assert.equal(await debian.isChecked(), false);
    // Stopping one stops only that one.
    await local.click();
    await page.waitForFunction(
      () => !document.querySelector('[aria-label="Monitor this machine\'s terminals"]')?.checked,
    );
    assert.deepEqual(
      await page.evaluate(() =>
        window.pageCalls.filter(({ cmd }) => cmd === "overseer_stop").map(({ args }) => args),
      ),
      [{ distro: null }],
    );
    assert.equal(await ubuntu.isChecked(), true);
    await ubuntu.click();
    await page.waitForFunction(
      () => !document.querySelector('[aria-label="Monitor WSL: Ubuntu terminals"]')?.checked,
    );
    assert.equal(errors.length, 0, errors.join("\n"));
    return {
      passed:
        "Settings per-environment monitoring: start, stop, side by side, failed start and retry",
      errors,
    };
  }
  const sidebar = page.locator("#cli-sidebar");
  const terminal = page.locator('[data-terminal="terminal-one"]');
  const note = page.getByRole("textbox", { name: "note.txt", exact: true });
  await page.evaluate(() => {
    window.heldTerminal = document.querySelector('[data-terminal="terminal-one"]');
    window.heldSettings = document.querySelector(".settings-page input");
    window.heldNote = document.querySelector('[role="textbox"][aria-label="note.txt"]');
    window.initialAttaches = window.pageCalls.filter((call) => call.cmd === "pty_attach").length;
  });

  // Ctrl is held only while pressed, even if a child consumes its release.
  const typedReads = () =>
    page.evaluate(() => window.pageCalls.filter((call) => call.cmd === "pty_typed").length);
  const waitForHeld = async (before) => {
    await page.waitForFunction(
      (count) => window.pageCalls.filter((call) => call.cmd === "pty_typed").length > count,
      before,
    );
  };
  const verifyReleased = async (text) => {
    await page.keyboard.type(text);
    await page.waitForTimeout(250);
    const count = await typedReads();
    await page.waitForTimeout(250);
    assert.equal(await typedReads(), count, "Ctrl release stops navigation-mode polling");
    const written = await page.evaluate(() =>
      window.pageCalls
        .filter((call) => call.cmd === "pty_write")
        .map((call) => call.args.data)
        .join(""),
    );
    assert.ok(written.endsWith(text), "Terminal accepts input after Ctrl release");
  };
  await terminal.locator(".xterm-screen").click();
  let readsBefore = await typedReads();
  await page.keyboard.down("Control");
  await waitForHeld(readsBefore);
  await terminal.locator("textarea").evaluate((input) => {
    input.addEventListener("keyup", (event) => event.stopPropagation(), { once: true });
  });
  await page.keyboard.up("Control");
  await verifyReleased("released");

  // A lost keyup must recover on an ordinary keydown, even when xterm consumes it.
  readsBefore = await typedReads();
  await terminal.locator("textarea").evaluate((input) => {
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Control", ctrlKey: true, bubbles: true }),
    );
  });
  await waitForHeld(readsBefore);
  await verifyReleased("recovered");

  // Ctrl+V must work without a browser paste event, through xterm's paste API.
  await page.keyboard.press("Control+v");
  await page.waitForFunction(() =>
    window.pageCalls.some(
      (call) => call.cmd === "pty_write" && call.args.data === "日本語\rsecond line",
    ),
  );
  assert.equal(
    await page.evaluate(
      () =>
        window.pageCalls.filter(
          (call) => call.cmd === "pty_write" && call.args.data === "日本語\rsecond line",
        ).length,
    ),
    1,
    "Clipboard text is pasted exactly once",
  );

  // Sidebar terminals use one header: move action, terminal list, page and window controls.
  const terminalHeader = sidebar.locator(".cli-page .page__header");
  await terminalHeader.locator(".page__window-controls button").first().waitFor();
  assert.equal(await terminalHeader.locator(".page__name").count(), 0);
  const headerLayout = await terminalHeader.evaluate((header) => {
    const move = header.querySelector(".page__to-canvas").getBoundingClientRect();
    const list = header.querySelector(".page__terminal-list").getBoundingClientRect();
    const controls = header.querySelector(".page__window-controls").getBoundingClientRect();
    return {
      singleRow: header.getBoundingClientRect().height < 40,
      order: move.right <= list.left && list.right <= controls.left,
      listed: header.querySelector(".page__terminal-list").children.length > 0,
      controls: header.querySelectorAll(".page__window-controls button").length,
    };
  });
  assert.equal(headerLayout.singleRow, true);
  assert.equal(headerLayout.order, true);
  assert.equal(headerLayout.controls, 3);
  assert.equal(headerLayout.listed, true);

  // Settings are an ordinary page and keep their form instance when docked.
  await page.getByRole("button", { name: "Move totex.json to the sidebar", exact: true }).click();
  await sidebar.locator(".settings-page").waitFor();
  await sidebar.locator(".settings-page .page__window-controls button").first().waitFor();
  assert.equal(await sidebar.locator(".settings-page .page__terminal-list").count(), 0);
  assert.equal(
    await sidebar
      .locator(".settings-page input")
      .first()
      .evaluate((element) => element === window.heldSettings),
    true,
  );
  assert.equal(await sidebar.getByRole("combobox", { name: "Select page" }).count(), 0);
  await page.getByRole("button", { name: "Move totex.json to the canvas", exact: true }).click();
  await page.getByRole("button", { name: "Show page sidebar", exact: true }).click();
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

  await page.getByRole("button", { name: "Move main to the canvas", exact: true }).click();

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

  // Hiding is not closing; reopening preserves the file draft.
  await page.getByRole("button", { name: "Hide page sidebar", exact: true }).click();
  await page.getByRole("button", { name: "Show page sidebar", exact: true }).click();
  assert.equal(await sidebar.getByRole("combobox", { name: "Select page" }).count(), 0);
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

export async function verifyMonitoring(page, base = "http://127.0.0.1:18422") {
  return verifyPages(page, base, true);
}
