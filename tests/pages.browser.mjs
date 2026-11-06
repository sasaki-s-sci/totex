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
    window.pageCloseRefused = false;
    window.pageClosePending = false;
    window.pageWriteRefused = false;
    window.pageFileText = "saved text";
    window.pageClipboard = "日本語\nsecond line";
    window.pageAttachRefused = location.search.includes("attach-error");
    window.pageCloseRefused = false;
    window.pageClosePending = false;
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
        if (cmd === "clipboard_files") return [];
        if (cmd === "terminal_paths") return args.paths;
        if (cmd === "paste_media") return "/tmp/pasted-shot.png";
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
        if (cmd === "pty_attach") {
          if (window.pageAttachRefused) throw new Error("Temporary attachment failure");
          if (location.search.includes("attach-missing")) return null;
          return window.pageBacklog ?? { text: "Retained terminal\r\n", upto: 0 };
        }
        if (cmd === "pty_close") {
          if (window.pageCloseRefused) throw new Error("Temporary close failure");
          if (window.pageClosePending)
            return new Promise((resolve) => {
              window.releaseClose = () => {
                window.pageEmit("pty:exit", args.id);
                resolve(null);
              };
            });
          window.pageEmit("pty:exit", args.id);
          return null;
        }
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
        if (cmd === "read_directory")
          return {
            path: args.path,
            name: args.path.split("/").at(-1),
            parent: "/tmp",
            distro: null,
            truncated: false,
            entries: [
              {
                name: args.path === "/tmp" ? "sub" : "child.txt",
                path: args.path === "/tmp" ? "/tmp/sub" : "/tmp/sub/child.txt",
                isDir: args.path === "/tmp",
                isSymlink: false,
                isHidden: false,
                size: 10,
                modifiedMs: 0,
              },
            ],
          };
        if (cmd === "read_file_head")
          return {
            path: args.path,
            name: args.path.split("/").at(-1),
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
  assert.equal(await terminalHeader.locator(".page__terminal-name").textContent(), "tmp");
  assert.equal(await terminalHeader.locator(".page__terminal-list").count(), 1);
  assert.equal(
    await terminalHeader.locator(".page__terminal-numbers [data-active=true]").textContent(),
    "1",
  );
  assert.equal(await terminalHeader.locator(".monitor-badge").count(), 0);
  assert.equal(await terminalHeader.locator(".page__window-controls button").count(), 3);

  await note.click();
  await page.keyboard.press("Control+ArrowRight");
  assert.ok(
    await sidebar
      .locator('[data-terminal="terminal-one"]')
      .evaluate((node) => node.contains(document.activeElement)),
    "Ctrl+Right moves from a file editor to the sidebar",
  );
  await page.keyboard.press("Control+ArrowLeft");
  assert.ok(await note.evaluate((node) => node === document.activeElement));

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
  await note.click();
  await page.keyboard.press("Control+ArrowRight");
  assert.ok(
    await sidebar
      .locator(".settings-page")
      .evaluate((node) => node.contains(document.activeElement)),
    "Ctrl+Right restores the displayed non-terminal page",
  );
  await page.keyboard.press("Control+ArrowLeft");
  assert.ok(await note.evaluate((node) => node === document.activeElement));
  await page.keyboard.press("Control+ArrowRight");
  await page.getByRole("button", { name: "Move totex.json to the cards", exact: true }).click();
  assert.ok(await sidebar.isVisible(), "Moving a page out keeps the sidebar open");
  await page.getByRole("button", { name: "Hide page sidebar", exact: true }).click();
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
  await note.focus();
  await page.keyboard.press("Control+ArrowDown");
  assert.ok(
    await sidebar
      .locator('[data-terminal="terminal-one"]')
      .evaluate((node) => node.contains(document.activeElement)),
    "Ctrl+Down selects a terminal even when editing a sidebar file",
  );
  await sidebar.getByRole("button", { name: "Close main viewer", exact: true }).click();
  await page.getByRole("button", { name: "Hide page sidebar", exact: true }).click();
  await page.getByRole("button", { name: "Show page sidebar", exact: true }).click();
  await page.getByRole("button", { name: "Close note.txt", exact: true }).click();
  await page.waitForFunction(
    () => !document.querySelector('[role="textbox"][aria-label="note.txt"]'),
  );
  assert.equal(
    await page.evaluate(() => window.pageCalls.some((call) => call.cmd === "pty_close")),
    false,
  );
  await page.locator("button.page-terminal-number").click();
  await page.keyboard.press("Control+x");
  await page.waitForFunction(() =>
    window.pageCalls.some((call) => call.cmd === "pty_close" && call.args.id === "terminal-one"),
  );
  assert.equal(await terminal.count(), 0);
  assert.ok(await sidebar.isVisible(), "Killing the last terminal keeps the sidebar open");
  await page.getByRole("button", { name: "Hide page sidebar", exact: true }).click();
  assert.equal(await sidebar.isVisible(), false);
  await page.getByRole("button", { name: "Show page sidebar", exact: true }).click();
  assert.ok(await sidebar.isVisible(), "An empty sidebar can be reopened explicitly");
  await page.goto(`${base}/tests/fixtures/pages.html?grouped&onlyterminals`);
  await page.locator('[data-terminal="terminal-two"] .xterm-screen').waitFor();
  await page.keyboard.press("Control+2");
  await page.evaluate(() => {
    window.pageCloseRefused = true;
  });
  await page.keyboard.press("Control+x");
  await page
    .getByText("Could not end the terminal. It is still open; try again.", { exact: true })
    .waitFor();
  const refused = await page.evaluate(() => window.pageSnapshot());
  assert.equal(refused.values["sessions.active"], "terminal-two");
  assert.equal(refused.values["sessions.list"].length, 3, "A failed close retains every terminal");
  await page.evaluate(() => {
    window.pageCloseRefused = false;
  });
  await page.keyboard.press("Control+x");
  await page.waitForFunction(
    async () => (await window.pageSnapshot()).values["sessions.active"] === "terminal-other",
  );
  assert.equal(
    await page.locator('#cli-sidebar [data-terminal="terminal-other"]').isVisible(),
    true,
  );
  assert.equal((await page.locator('[data-terminal="terminal-one"]').count()) > 0, true);
  await page.keyboard.press("Control+x");
  await page.waitForFunction(
    async () => (await window.pageSnapshot()).values["sessions.active"] === "terminal-one",
  );
  await page.locator("main").evaluate((node) => {
    const data = new DataTransfer();
    data.items.add(
      new File([new Uint8Array([137, 80, 78, 71])], "shot.png", { type: "image/png" }),
    );
    node.dispatchEvent(
      new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: data }),
    );
  });
  await page.waitForFunction(async () =>
    (await window.pageSnapshot()).values["files.open"].some(
      (file) => file.path === "/tmp/pasted-shot.png",
    ),
  );
  await page.goto(`${base}/tests/fixtures/pages.html?grouped&onlyterminals`);
  await page.locator('[data-terminal="terminal-two"] .xterm-screen').waitFor();
  await page.keyboard.press("Control+2");
  await page.evaluate(() => {
    window.pageClosePending = true;
  });
  await page.keyboard.press("Control+x");
  await page.waitForFunction(() => window.releaseClose);
  await page.keyboard.press("Control+1");
  await page.evaluate(() => window.releaseClose());
  await page.waitForFunction(
    async () => (await window.pageSnapshot()).values["sessions.list"].length === 2,
  );
  assert.equal(
    (await page.evaluate(() => window.pageSnapshot())).values["sessions.active"],
    "terminal-one",
    "A delayed close must not override navigation performed while it was pending",
  );
  await page.goto(`${base}/tests/fixtures/pages.html?attach-error`);
  await page.getByRole("button", { name: "Retry connection", exact: true }).waitFor();
  assert.equal(
    await page.evaluate(() => window.pageCalls.some((call) => call.cmd === "pty_close")),
    false,
  );
  assert.equal(
    (await page.evaluate(() => window.pageSnapshot())).values["sessions.list"].length,
    1,
  );
  await page.evaluate(() => {
    window.pageAttachRefused = false;
  });
  await page.getByRole("button", { name: "Retry connection", exact: true }).click();
  await page.waitForFunction(
    () =>
      window.pageCalls.filter((call) => call.cmd === "pty_attach").length >= 2 &&
      !document.querySelector('[role="alert"]'),
  );
  await page.evaluate(() => window.pageEmit("pty:exit", "terminal-one"));
  await page.waitForFunction(
    async () => (await window.pageSnapshot()).values["sessions.list"].length === 0,
  );
  assert.equal(
    await page.evaluate(() => window.pageCalls.some((call) => call.cmd === "pty_close")),
    false,
    "A confirmed natural exit removes the view without another close request",
  );
  await page.goto(`${base}/tests/fixtures/pages.html?attach-missing`);
  await page.waitForFunction(
    async () =>
      window.pageSnapshot && (await window.pageSnapshot()).values["sessions.list"].length === 0,
  );
  assert.equal(
    await page.evaluate(() => window.pageCalls.some((call) => call.cmd === "pty_close")),
    false,
  );
  await page.goto(`${base}/tests/fixtures/pages.html?grouped&onlyterminals`);
  await page.locator('[data-terminal="terminal-other"] .xterm-screen').waitFor();
  await page.keyboard.press("Control+1");
  await page.keyboard.press("Control+2");
  await page.keyboard.press("Control+Alt+a");
  await page.evaluate(() => {
    window.pageEmit("pty:exit", "terminal-two");
    window.pageEmit("pty:exit", "terminal-one");
  });
  await page.waitForFunction(
    async () => (await window.pageSnapshot()).values["sessions.list"].length === 1,
  );
  const simultaneous = (await page.evaluate(() => window.pageSnapshot())).values;
  assert.equal(simultaneous["sessions.showing"], null);
  assert.equal(simultaneous["sessions.active"], null);
  assert.equal(simultaneous["pages.lowerSidebar"], null);
  assert.equal(errors.length, 0, errors.join("\n"));
  return {
    passed:
      "terminal identity, header dragging, columns, reordering, resizing, file/settings docking, failed saves, host capabilities, hiding, snapshot, close",
    errors,
  };
}

/** Active terminals keep their pane when navigating and closing a split. */
export async function verifyTerminalPanes(page, base = "http://127.0.0.1:18422") {
  await page.goto(`${base}/tests/fixtures/pages.html?terminals&onlyterminals`);
  await page.locator('[data-terminal="terminal-one"] .xterm-screen').click();
  // ConPTY waits for this response before the new shell can print its prompt.
  await page.evaluate(() => {
    window.pageBacklog = { text: "\x1b[6n", upto: 4 };
  });
  await page.keyboard.press("Control+a");
  await page.waitForFunction(
    async () => (await window.pageSnapshot()).values["sessions.list"].length === 2,
  );
  const checkOpened = async () => {
    const id = await page.evaluate(
      async () => (await window.pageSnapshot()).values["sessions.list"].at(-1).id,
    );
    await page.waitForFunction(async () => {
      const { values } = await window.pageSnapshot();
      const id = values["sessions.active"];
      const terminal = document.querySelector(`#cli-sidebar [data-terminal="${id}"]`);
      return values["sessions.showing"] === id && terminal?.contains(document.activeElement);
    });
    await page.waitForFunction(
      (id) =>
        window.pageCalls.some(
          (call) =>
            call.cmd === "pty_write" && call.args.id === id && call.args.data === "\x1b[1;1R",
        ),
      id,
    );
    assert.equal(
      await page.evaluate(
        (id) =>
          window.pageCalls.filter((call) => call.cmd === "pty_write" && call.args.id === id).length,
        id,
      ),
      1,
      "Only the sidebar answers the pending ConPTY startup query",
    );
  };
  await checkOpened();
  await page.keyboard.press("Control+a");
  await page.waitForFunction(
    async () => (await window.pageSnapshot()).values["sessions.list"].length === 3,
  );
  await checkOpened();
  const ids = await page.evaluate(async () =>
    (await window.pageSnapshot()).values["sessions.list"].map((s) => s.id),
  );
  const writesBeforeReplay = await page.evaluate(
    () => window.pageCalls.filter((call) => call.cmd === "pty_write").length,
  );
  await page.evaluate(() => {
    // A cursor query retained later in the session must not be answered again.
    window.pageBacklog = { text: "\x1b[6n", upto: 1004 };
  });
  const previousSize = await page.evaluate(
    (id) =>
      window.pageCalls.filter((call) => call.cmd === "pty_resize" && call.args.id === id).at(-1)
        ?.args,
    ids[2],
  );
  assert.ok(previousSize.rows > 2);
  await page.keyboard.press("Control+1");
  await page.waitForFunction(
    async (id) => (await window.pageSnapshot()).values["sessions.active"] === id,
    ids[0],
  );
  await page.locator(`#cli-sidebar [data-terminal="${ids[0]}"] .xterm-screen`).waitFor();
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  assert.equal(
    await page.evaluate(() => window.pageCalls.filter((call) => call.cmd === "pty_write").length),
    writesBeforeReplay,
    "Opening another viewer does not answer historical cursor queries",
  );
  await page.evaluate(() => {
    window.pageBacklog = undefined;
  });
  assert.deepEqual(
    await page.evaluate(
      (id) =>
        window.pageCalls.filter((call) => call.cmd === "pty_resize" && call.args.id === id).at(-1)
          ?.args,
      ids[2],
    ),
    previousSize,
    "Switching terminals preserves the previous shell's full-size grid",
  );
  await page.keyboard.press("Control+3");
  await page.waitForFunction(
    async (id) => (await window.pageSnapshot()).values["sessions.active"] === id,
    ids[2],
  );
  const resizeCount = await page.evaluate(
    () => window.pageCalls.filter((call) => call.cmd === "pty_resize").length,
  );
  for (const key of ["Control+ArrowUp", "Control+ArrowDown"]) {
    await page.keyboard.press(key);
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
  }
  assert.equal(
    await page.evaluate(() => window.pageCalls.filter((call) => call.cmd === "pty_resize").length),
    resizeCount,
    "Switching sidebar terminals does not trigger a redundant ConPTY repaint",
  );
  // Explicit controls open viewers while source cards remain editable.
  for (const id of ids) {
    await page
      .locator(`[data-page-card="terminal:${id}"]`)
      .getByRole("button", { name: /^Open .* in sidebar viewer$/ })
      .click();
  }
  await page.setViewportSize({ width: 1600, height: 400 });
  await page.locator(".card-board").evaluate((board) => {
    board.scrollTop = 0;
  });
  await page.keyboard.press("Control+ArrowUp");
  await page.waitForFunction(
    async (id) => (await window.pageSnapshot()).values["sessions.active"] === id,
    ids[1],
  );
  assert.equal(
    await page.locator(".card-board").evaluate((board) => board.scrollTop),
    0,
    "Selecting a sidebar terminal leaves the canvas and its folder headings in place",
  );
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.keyboard.press("Control+ArrowLeft");
  assert.ok(
    await page.locator('.folder-card[data-card-folder="/tmp"]').evaluate((folder) => {
      const header = folder.querySelector(".page__header").getBoundingClientRect();
      const board = folder.closest(".card-board").getBoundingClientRect();
      return header.top >= board.top && header.bottom <= board.bottom;
    }),
    "Returning to the canvas keeps the terminal's folder path in view",
  );
  await page.keyboard.press("Control+ArrowRight");
  await page.keyboard.press("Control+ArrowDown");
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

export async function verifyMixedPages(page, base = "http://127.0.0.1:18422") {
  await page.goto(`${base}/tests/fixtures/pages.html?grouped&mixed`);
  const file = page.locator('[data-page-card="file:1"]');
  await file.locator(".page-terminal-number").waitFor();
  await page.locator('[data-terminal="terminal-other"] .xterm-screen').waitFor();
  await page.evaluate(() => new Promise(requestAnimationFrame));
  assert.equal(await file.locator(".page-terminal-number").textContent(), "3");
  assert.equal(
    await file.locator("xpath=ancestor::*[@data-card-folder]").getAttribute("data-card-folder"),
    "/tmp",
  );
  await page.keyboard.press("Control+3");
  await page.locator("#cli-sidebar .file-preview").waitFor();
  await page.keyboard.press("Control+ArrowDown");
  await page.locator('#cli-sidebar [data-terminal="terminal-other"]').waitFor({ state: "visible" });
  await page.keyboard.press("Control+ArrowUp");
  await page.locator("#cli-sidebar .file-preview").waitFor({ state: "visible" });
  const note = page.getByRole("textbox", { name: "note.txt", exact: true });
  await note.click();
  await page.keyboard.press("Control+4");
  await page.locator('#cli-sidebar [data-terminal="terminal-other"]').waitFor({ state: "visible" });
  await page.keyboard.press("Control+3");
  await note.click();
  await page.keyboard.press("Control+x");
  assert.equal(await note.count(), 1, "Ctrl+X in an editor keeps the file open");
  await page.evaluate(() => {
    window.pageWriteRefused = true;
  });
  await note.fill("keep this draft");
  await page.locator("#cli-sidebar .file-preview").focus();
  await page.keyboard.press("Control+x");
  await page.locator(".file-preview__unsaved.is-refused").waitFor();
  assert.equal(await note.textContent(), "keep this draft", "Failed save retains the open draft");
  await page.evaluate(() => {
    window.pageWriteRefused = false;
  });
  await page.keyboard.press("Control+x");
  await note.waitFor({ state: "detached" });
  await page.locator('#cli-sidebar [data-terminal="terminal-other"]').waitFor({ state: "visible" });
  assert.equal(await page.evaluate(() => window.pageFileText), "keep this draft");
  await page.keyboard.press("Control+x");
  await page.locator('#cli-sidebar [data-terminal="terminal-one"]').waitFor({ state: "visible" });

  await page.goto(`${base}/tests/fixtures/pages.html?grouped&mixed`);
  await file.locator(".page-terminal-number").waitFor();
  await page.locator('[data-terminal="terminal-other"] .xterm-screen').waitFor();
  await page.evaluate(() => new Promise(requestAnimationFrame));
  await page.keyboard.press("Control+2");
  await page.keyboard.press("Control+x");
  await page.locator("#cli-sidebar .file-preview").waitFor({ state: "visible" });
  assert.equal(
    (await page.evaluate(() => window.pageSnapshot())).values["pages.showingFile"],
    "file:1",
    "Closing terminal 2 selects the following file",
  );
  await page.keyboard.press("Control+x");
  await page.locator('#cli-sidebar [data-terminal="terminal-other"]').waitFor({ state: "visible" });

  await page.goto(`${base}/tests/fixtures/pages.html?grouped&mixed`);
  await page.locator('[data-pick-row="/tmp/sub"]').click();
  await page.locator('[data-pick-row="/tmp/sub/child.txt"]').dblclick();
  const child = page.locator('[data-page-card="file:2"]');
  await child.locator(".page-terminal-number").waitFor();
  assert.equal(
    await child.locator("xpath=ancestor::*[@data-card-folder]").getAttribute("data-card-folder"),
    "/tmp",
  );
  const snapshot = await page.evaluate(() => window.pageSnapshot());
  assert.equal(snapshot.values["files.open"].find((file) => file.id === 2).folder, "/tmp");
  assert.equal(
    snapshot.values["canvas.files"].find((file) => file.data.requestId === 2).data.folder,
    "/tmp",
  );
  await page.keyboard.press("Control+3");
  await page.locator("#cli-sidebar .file-preview").waitFor({ state: "visible" });
  await page.keyboard.press("Control+1");
  await page.keyboard.press("Control+Alt+a");
  await page.waitForFunction(
    () => document.querySelector('[data-page-pane="file:1"]')?.dataset.active === "true",
  );
  await page.keyboard.press("Control+x");
  await page.waitForFunction(
    () => document.querySelector('[data-page-pane="file:2"]')?.dataset.active === "true",
  );
  await page.keyboard.press("Control+x");
  await page.locator('#cli-sidebar [data-terminal="terminal-other"]').waitFor({ state: "visible" });
  return "shared numbering, mixed next-on-close, failed-save protection, editor cut, sidebar origin";
}
