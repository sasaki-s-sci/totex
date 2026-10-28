import assert from "node:assert/strict";
import { verifyCardLayout } from "./cards.browser.mjs";

/** Real Window, cards, file editors and xterm; only native IPC is replaced. */
export async function verifyPages(page, base = "http://127.0.0.1:18422") {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem("totex.language", "en");
    let serial = 0;
    const callbacks = new Map();
    const listeners = new Map();
    window.pageEmit = (event, payload) => {
      for (const listener of listeners.values()) {
        if (listener.event === event) callbacks.get(listener.handler)?.({ event, payload });
      }
    };
    window.pageCalls = [];
    window.pageWriteRefused = false;
    window.pageFileText = "saved text";
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
          listeners.set(id, args);
          return id;
        }
        if (cmd === "plugin:event|unlisten") {
          listeners.delete(args.eventId);
          return null;
        }
        if (cmd === "pty_sessions")
          return [
            { id: "terminal-one", cwd: "/tmp", rows: 24, cols: 80, meta: '{"branch":"main"}' },
          ];
        if (cmd === "pty_attach") return { text: "Retained terminal\r\n", upto: 0 };
        if (cmd === "pty_standing")
          return window.pageAgent
            ? [
                {
                  id: "terminal-one",
                  doing: "working",
                  asking: false,
                  said: "Implement grouped pages",
                  running: "claude",
                  tail: "agent output",
                },
              ]
            : [];
        if (cmd === "monitor_snapshots")
          return [
            {
              id: "terminal-one",
              environment: "local",
              source: "observed",
              status: "running",
              goal: null,
              taskSummary: "Long agent task ".repeat(80),
              requestSummary: "Long user request ".repeat(80),
              estimate: null,
              updatedAt: Date.now(),
              error: null,
              monitorStatus: "idle",
              shot: null,
              agents: window.pageNoWorkers
                ? []
                : [
                    {
                      id: "a",
                      kind: "subagent",
                      source: "observed",
                      label: "First helper",
                      status: "running",
                      detail: "Code",
                    },
                    {
                      id: "b",
                      kind: "subagent",
                      source: "observed",
                      label: "Second helper",
                      status: "running",
                      detail: "Test",
                    },
                    {
                      id: "c",
                      kind: "background",
                      source: "observed",
                      label: "Build",
                      status: "running",
                      detail: "Compile",
                    },
                  ],
            },
          ];

        if (
          [
            "pty_doing",
            "mcp_reports",
            "list_roots",
            "describe_folders",
            "update_standing",
          ].includes(cmd)
        )
          return [];
        if (cmd === "app_settings_read") {
          const value = location.search.includes("grouped")
            ? {
                ...args.initial,
                monitor: { ...args.initial.monitor, enabled: true },
              }
            : args.initial;
          return { path: "/tmp/totex.json", text: JSON.stringify(value), value };
        }
        if (cmd === "app_settings_write")
          return { path: "/tmp/totex.json", text: args.text, value: JSON.parse(args.text) };
        if (cmd === "read_file_head")
          return {
            path: args.path,
            name: "note.txt",
            text: window.pageFileText,
            size: window.pageFileText.length,
            truncated: false,
          };
        if (cmd === "write_file") {
          if (window.pageWriteRefused) throw new Error("Write refused");
          window.pageFileText = args.text;
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
  assert.equal(
    await page.locator("#folder-sidebar").isVisible(),
    true,
    "Folder sidebar opens by default",
  );
  const sidebar = page.locator("#cli-sidebar");
  const terminal = page.locator('.card-board [data-terminal="terminal-one"]');
  const note = page.getByRole("textbox", { name: "note.txt", exact: true });
  await page.evaluate(() => {
    window.heldTerminal = document.querySelector('[data-terminal="terminal-one"]');
    window.heldSettings = document.querySelector(".settings-page input");
    window.heldNote = document.querySelector('[role="textbox"][aria-label="note.txt"]');
    window.initialAttaches = window.pageCalls.filter((call) => call.cmd === "pty_attach").length;
  });

  assert.equal(await page.locator('.card-board [data-terminal="terminal-one"]').count(), 1);
  assert.equal(await page.locator(".card-session-preview, .page__terminal-list").count(), 0);
  assert.equal(await page.locator(".cli-page .page__header").count(), 0);
  const initialTools = page.locator(".cli-page .page__tools");
  assert.equal(
    await initialTools
      .getByRole("button", { name: "Open main in sidebar viewer", exact: true })
      .count(),
    1,
  );
  assert.equal(
    await initialTools.getByRole("button", { name: "Close main", exact: true }).count(),
    1,
  );
  await terminal.locator(".xterm-screen").click();
  await page.keyboard.type("default-input");
  await page.waitForFunction(() =>
    window.pageCalls
      .filter((call) => call.cmd === "pty_write")
      .map((call) => call.args.data)
      .join("")
      .includes("default-input"),
  );

  await page.waitForFunction(
    () =>
      window.pageCalls
        .filter((call) => call.cmd === "pty_resize" && call.args.id === "terminal-one")
        .at(-1)?.args.rows === 2,
  );
  await page.evaluate(() => {
    window.heldTerminalTools = document.querySelector(".cli-page .page__tools");
  });
  await page
    .locator('[data-page-card="terminal:terminal-one"]')
    .getByRole("separator", { name: "Resize page height", exact: true })
    .focus();
  await page.keyboard.press("ArrowDown");
  await page.waitForFunction(
    () =>
      window.pageCalls
        .filter((call) => call.cmd === "pty_resize" && call.args.id === "terminal-one")
        .at(-1)?.args.rows > 2,
  );
  assert.equal(await initialTools.evaluate((header) => header === window.heldTerminalTools), true);
  assert.equal(await page.locator(".cli-page .page__header").count(), 0);
  await page
    .locator('[data-page-card="terminal:terminal-one"]')
    .getByRole("separator", { name: "Resize page height", exact: true })
    .focus();
  await page.keyboard.press("ArrowUp");
  await page.waitForFunction(
    () =>
      window.pageCalls
        .filter((call) => call.cmd === "pty_resize" && call.args.id === "terminal-one")
        .at(-1)?.args.rows === 2,
  );
  assert.equal(await terminal.evaluate((element) => element === window.heldTerminal), true);
  assert.equal(
    await page.evaluate(() => window.pageCalls.filter((call) => call.cmd === "pty_attach").length),
    await page.evaluate(() => window.initialAttaches),
  );
  await page
    .locator('[data-page-card="terminal:terminal-one"]')
    .getByRole("separator", { name: "Resize page height", exact: true })
    .focus();
  await page.keyboard.press("ArrowDown");

  for (let step = 0; step < 10; step++) await page.keyboard.press("ArrowDown");
  await verifyCardLayout(page);

  // Ctrl is held only while pressed, even if a child consumes its release.
  const verifyReleased = async (text) => {
    await page.keyboard.type(text);
    await page.waitForTimeout(250);
    const written = await page.evaluate(() =>
      window.pageCalls
        .filter((call) => call.cmd === "pty_write")
        .map((call) => call.args.data)
        .join(""),
    );
    assert.ok(written.endsWith(text), "Terminal accepts input after Ctrl release");
  };
  await terminal.locator(".xterm-screen").click();
  await page.keyboard.down("Control");
  await terminal.locator("textarea").evaluate((input) => {
    input.addEventListener("keyup", (event) => event.stopPropagation(), { once: true });
  });
  await page.keyboard.up("Control");
  await verifyReleased("released");

  // A lost keyup must recover on an ordinary keydown, even when xterm consumes it.
  await terminal.locator("textarea").evaluate((input) => {
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Control", ctrlKey: true, bubbles: true }),
    );
  });
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

  // The sidebar adds one viewer header while preserving the source card.
  const terminalHeader = sidebar.locator(".cli-page .page__header");
  await terminalHeader.locator(".page__window-controls button").first().waitFor();
  assert.equal(await terminalHeader.count(), 1);
  assert.equal(await terminalHeader.locator(".page__name").textContent(), "main");
  assert.equal(await terminalHeader.locator(".page__terminal-list, .monitor-badge").count(), 0);
  assert.equal(await terminalHeader.locator(".page__window-controls button").count(), 3);

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
  await page.getByRole("button", { name: "Move totex.json to the cards", exact: true }).click();
  await page.getByRole("button", { name: "Show page sidebar", exact: true }).click();
  await page.getByRole("button", { name: "Close main viewer", exact: true }).click();
  await page.locator('.card-board [data-terminal="terminal-one"]').waitFor();
  assert.equal(await terminal.evaluate((element) => element === window.heldTerminal), true);
  assert.equal(await terminal.count(), 1);
  assert.equal(
    await terminal.evaluate((element) => element.contains(document.activeElement)),
    true,
    "Dismissing its viewer restores card keyboard focus",
  );
  await page
    .locator(".cli-page")
    .getByRole("button", { name: "Open main in sidebar viewer", exact: true })
    .click();
  await sidebar.locator('[data-terminal="terminal-one"]').waitFor();
  assert.equal(await terminal.evaluate((element) => element === window.heldTerminal), true);
  assert.equal(
    await page.evaluate(
      () =>
        window.pageCalls.filter((call) => call.cmd === "pty_attach").length >
        window.initialAttaches,
    ),
    true,
  );

  await page.getByRole("button", { name: "Close main viewer", exact: true }).click();

  // Failed writes leave the draft and its page in place.
  await note.fill("edited content");
  await page.evaluate(() => {
    window.pageWriteRefused = true;
  });
  await page.getByRole("button", { name: "Move note.txt to the sidebar", exact: true }).click();
  await page.locator(".file-preview__unsaved.is-refused").waitFor();
  assert.equal(await note.evaluate((element) => !!element.closest(".card-board")), true);
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
  await page.getByRole("button", { name: "Move note.txt to the cards", exact: true }).click();
  assert.equal(await page.getByRole("button", { name: "Pin note.txt", exact: true }).count(), 0);
  assert.equal(await page.getByRole("button", { name: /Shrink .* to its smallest/ }).count(), 0);
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
  await page.locator(".cli-page").getByRole("button", { name: "Close main", exact: true }).click();
  await page.waitForFunction(() =>
    window.pageCalls.some((call) => call.cmd === "pty_close" && call.args.id === "terminal-one"),
  );
  assert.equal(await terminal.count(), 0);
  assert.equal(errors.length, 0, errors.join("\n"));
  return {
    passed:
      "terminal identity, header dragging, columns, reordering, resizing, file/settings docking, failed saves, host capabilities, hiding, snapshot, close",
    errors,
  };
}

/** Active terminals keep their pane when navigating and closing a split. */
export async function verifyTerminalPanes(page, base = "http://127.0.0.1:18422") {
  await page.goto(`${base}/tests/fixtures/pages.html?terminals`);
  await page.locator('[data-terminal="terminal-one"] .xterm-screen').click();
  await page.keyboard.press("Control+a");
  await page.waitForFunction(
    async () => (await window.pageSnapshot()).values["sessions.list"].length === 2,
  );
  await page.keyboard.press("Control+a");
  await page.waitForFunction(
    async () => (await window.pageSnapshot()).values["sessions.list"].length === 3,
  );
  const ids = await page.evaluate(async () =>
    (await window.pageSnapshot()).values["sessions.list"].map((s) => s.id),
  );
  await page.keyboard.press("Control+1");
  await page.waitForFunction(
    async (id) => (await window.pageSnapshot()).values["sessions.active"] === id,
    ids[0],
  );
  await page.keyboard.press("Control+3");
  await page.waitForFunction(
    async (id) => (await window.pageSnapshot()).values["sessions.active"] === id,
    ids[2],
  );
  // Explicit controls open viewers while source cards remain editable.
  for (const id of ids) {
    await page
      .locator(`[data-page-card="terminal:${id}"]`)
      .getByRole("button", { name: /^Open .* in sidebar viewer$/ })
      .click();
  }
  await page.keyboard.press("Control+Alt+a");
  const check = async (top, bottom, active) => {
    await page.waitForFunction(
      ({ top, bottom, active }) => {
        const panes = [...document.querySelectorAll("[data-page-pane]")];
        const pane = (id) => panes.find((e) => e.dataset.pagePane === `terminal:${id}`);
        const a = pane(active);
        return (
          a?.dataset.active === "true" &&
          a.contains(document.activeElement) &&
          getComputedStyle(pane(top)).top === "0px" &&
          (bottom === null ||
            pane(bottom).getBoundingClientRect().top > pane(top).getBoundingClientRect().top)
        );
      },
      { top, bottom, active },
    );
  };
  await check(ids[2], ids[0], ids[0]);
  await page.keyboard.press("Control+ArrowDown");
  await check(ids[2], ids[1], ids[1]);
  await page.keyboard.press("Control+ArrowDown");
  await check(ids[2], ids[1], ids[2]);
  await page.locator(`#cli-sidebar [data-terminal="${ids[1]}"] .xterm-screen`).click();
  await check(ids[2], ids[1], ids[1]);
  await page.keyboard.press("Control+Alt+x");
  await page.waitForFunction(
    (id) => window.pageCalls.some((c) => c.cmd === "pty_close" && c.args.id === id),
    ids[1],
  );
  await check(ids[2], null, ids[2]);
  assert.equal(await page.locator(`[data-terminal="${ids[1]}"]`).count(), 0);
  await page.keyboard.press("Control+Alt+a");
  await check(ids[2], ids[0], ids[0]);
  await page.keyboard.press("Control+ArrowUp");
  await check(ids[2], ids[0], ids[2]);
  await page.keyboard.press("Control+Alt+x");
  await page.waitForFunction((id) => !document.querySelector(`[data-terminal="${id}"]`), ids[2]);
  await check(ids[0], null, ids[0]);
  await page.keyboard.press("Control+Alt+a");
  await page.waitForFunction(
    async () => (await window.pageSnapshot()).values["sessions.list"].length === 2,
  );
  const fresh = await page.evaluate(
    async () => (await window.pageSnapshot()).values["sessions.active"],
  );
  await check(ids[0], fresh, fresh);
  await page.keyboard.press("Control+Alt+x");
  await check(ids[0], null, ids[0]);
  return "split focus, active-pane navigation, pointer selection, closing either pane";
}
