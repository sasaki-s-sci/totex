/** Production builds on 18422 and 18423; native IPC is mocked, React and xterm are real. */
export async function verifyShell(
  page,
  base = "http://127.0.0.1:18422",
  nextBase = "http://127.0.0.1:18423",
) {
  const check = (value, message) => {
    if (!value) throw new Error(message);
  };
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem("totex.language", "en");
    if (window.parent !== window) {
      // WebView2 installs these read-only globals in every frame. Frontend
      // callbacks must still use the shell's registry, not these local ones.
      Object.defineProperty(window, "__TAURI_INTERNALS__", { value: Object.freeze({}) });
      Object.defineProperty(window, "__TAURI_EVENT_PLUGIN_INTERNALS__", {
        value: Object.freeze({}),
      });
      return;
    }
    const sessions = [1, 2, 3].map((number) => ({
      id: `/tmp cli ${number}`,
      cwd: "/tmp",
      branch: "main",
    }));
    const callbacks = new Map();
    const running = new Set(sessions.map((session) => session.id));
    const canvases = new Map([
      [
        sessions[0].id,
        {
          id: sessions[0].id,
          revision: 1,
          panes: [{ id: "other-evidence", kind: "code", text: "Evidence for terminal one" }],
        },
      ],
      [
        sessions[1].id,
        {
          id: sessions[1].id,
          revision: 1,
          panes: [{ id: "evidence", kind: "code", text: "Evidence for terminal two" }],
        },
      ],
    ]);
    const listeners = new Map();
    let serial = 0;
    let shell;
    // Seed a realistic running window, then let subsequent fronts receive the actual handoff.
    Object.defineProperty(window, "__TOTEX_SHELL__", {
      get: () => shell,
      set(value) {
        const connect = value.connect;
        value.connect = (source) => {
          const connection = connect(source);
          connection.snapshot ??= {
            schema: 1,
            values: {
              "window.foldersOpen": true,
              "sessions.list": sessions,
              "sessions.showing": sessions[1].id,
              "sessions.paged": [sessions[0].id, sessions[2].id],
              "sessions.active": sessions[1].id,
              "files.open": [{ id: 1, path: "/tmp/note.txt", at: null }],
              "window.settings": 1,
            },
          };
          return connection;
        };
        shell = value;
      },
    });
    window.calls = [];
    let confirmedVersion = "99.0.0";
    let fileText = "saved text";
    window.savedFileText = () => fileText;
    window.fileWriteRefused = true;
    window.listenerCount = () => listeners.size;
    window.__TAURI_INTERNALS__ = {
      transformCallback(callback) {
        callbacks.set(++serial, callback);
        return serial;
      },
      unregisterCallback(id) {
        callbacks.delete(id);
      },
      async invoke(cmd, args) {
        window.calls.push({ cmd, args });
        if (cmd === "mcp_setup")
          return {
            command: "'/home/a/Applications/totex/bin/totex' --register-codex-mcp",
            environment: "Linux",
          };
        if (cmd === "plugin:event|listen") {
          listeners.set(++serial, args);
          return serial;
        }
        if (cmd === "plugin:event|unlisten") {
          listeners.delete(args.eventId);
          return;
        }
        if (cmd === "pty_sessions")
          return sessions.map((session) => ({
            ...session,
            rows: 24,
            cols: 80,
            meta: JSON.stringify({ branch: "main" }),
          }));
        if (cmd === "pty_open") {
          await new Promise((resolve) => setTimeout(resolve, 80));
          running.add(args.id);
          return;
        }
        if (cmd === "pty_attach")
          return running.has(args.id) ? { text: `Running ${args.id}\r\n`, upto: 0 } : null;
        if (cmd === "canvas_read") return structuredClone([...canvases.values()]);
        if (cmd === "canvas_open")
          return structuredClone(canvases.get(args.id) ?? { id: args.id, revision: 0, panes: [] });
        if (cmd === "canvas_close") {
          canvases.delete(args.id);
          return null;
        }
        if (cmd === "canvas_write") {
          const was = canvases.get(args.id) ?? { id: args.id, revision: 0, panes: [] };
          if (was.revision !== args.revision) throw new Error("Canvas revision changed");
          const next = {
            id: args.id,
            revision: was.revision + 1,
            panes: structuredClone(args.panes),
          };
          canvases.set(args.id, next);
          return structuredClone(next);
        }
        if (["pty_doing", "mcp_reports", "list_roots", "describe_folders"].includes(cmd)) return [];
        if (cmd === "update_standing")
          return ["persistent", "ephemeral"].map((layer) => ({
            layer,
            at: layer === "persistent" ? "99.0.0" : confirmedVersion,
            can: true,
            picked: null,
            ephemeralContract: "test-runtime",
          }));
        if (cmd === "update_choices")
          return [
            { version: "99.0.1", ephemeralContract: "test-runtime", persistentAvailable: true },
          ];
        if (cmd === "app_settings_read")
          return {
            path: "/tmp/settings.json",
            text: JSON.stringify(args.initial),
            value: args.initial,
          };
        if (cmd === "read_file_head")
          return {
            path: args.path,
            name: "note.txt",
            text: fileText,
            size: fileText.length,
            truncated: false,
          };
        if (cmd === "stat_file") return { size: fileText.length, modifiedMs: 0 };
        if (cmd === "write_file") {
          if (window.fileWriteRefused) throw new Error("Write refused");
          fileText = args.text;
          return fileText.length;
        }
        if (cmd === "file_diff")
          return { standing: "unknown", patch: "", truncated: false, runs: [] };
        if (cmd === "confirm_front") {
          if (window.failConfirmation) throw new Error("Confirmation refused");
          if (args.version) confirmedVersion = args.version;
        }
        return null;
      },
    };
    // Tauri's actual metadata properties are non-enumerable.
    Object.defineProperty(window.__TAURI_INTERNALS__, "metadata", {
      value: {
        currentWindow: { label: "main" },
        currentWebview: { label: "main" },
      },
    });
    for (const key of Object.getOwnPropertyNames(window.__TAURI_INTERNALS__)) {
      Object.defineProperty(window.__TAURI_INTERNALS__, key, {
        writable: false,
        configurable: false,
        enumerable: false,
      });
    }
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
  });
  let candidate = false;
  let failedLoad = false;
  await page.route(`${base}/**`, async (route) => {
    const path = route.request().url().slice(base.length);
    const pathname = path.split("?")[0];
    if (
      !candidate ||
      !(
        pathname === "/front.html" ||
        pathname === "/ephemeral.json" ||
        pathname.startsWith("/assets/")
      )
    )
      return route.continue();
    if (failedLoad && pathname === "/front.html")
      return route.fulfill({
        contentType: "text/html",
        body: '<script src="/assets/fail-front.js"></script>',
      });
    if (pathname === "/assets/fail-front.js")
      return route.fulfill({
        contentType: "text/javascript",
        body: 'window.parent.__TOTEX_SHELL__.connect(window).failed(new Error("Startup failed"));',
      });
    const response = await page.request.get(`${nextBase}${path}`);
    if (!response.ok()) return route.continue();
    return route.fulfill({ response });
  });
  await page.goto(base);
  await page.waitForFunction(
    () => document.querySelector("iframe")?.style.visibility === "visible",
  );
  let front = page.frames().find((frame) => frame.parentFrame());
  await page.waitForFunction(
    () => window.calls.filter((call) => call.cmd === "pty_attach").length === 3,
  );
  check(
    await front.getByRole("button", { name: "patch 99.0.1", exact: true }).isEnabled(),
    "The new patch must be offered before confirmation",
  );
  await front.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
  await front.getByRole("dialog").waitFor({ state: "hidden" });
  const draft = front.getByRole("textbox", { name: "note.txt" });
  await draft.fill("unsaved words");
  await draft.focus();
  const canvas = '[data-session-canvas="/tmp cli 2"]';
  check(
    (await front.locator(`${canvas} [data-canvas-pane]`).count()) === 2,
    "The opened file must join the current terminal's existing evidence",
  );
  check((await front.locator("main .xterm").count()) === 0, "Canvas duplicated a terminal");
  await page.evaluate(() => {
    window.before = {
      document,
      frame: document.querySelector("iframe"),
      listeners: window.listenerCount(),
    };
  });
  const activate = () =>
    page.evaluate(() =>
      window.__TOTEX_SHELL__
        .connect(document.querySelector("iframe").contentWindow)
        .activate("99.0.1"),
    );
  candidate = true;
  failedLoad = true;
  let startupRefused = false;
  try {
    await activate();
  } catch {
    startupRefused = true;
  }
  check(startupRefused, "Failed startup was accepted");
  check(
    await page.evaluate(
      () => document.querySelector("iframe") === window.before.frame && !window.before.frame.inert,
    ),
    "Old frame was lost on startup failure",
  );
  failedLoad = false;
  // Failed confirmation must leave the original document, draft and sessions usable.
  await page.evaluate(() => {
    window.failConfirmation = true;
  });
  let refused = false;
  try {
    await activate();
  } catch {
    refused = true;
  }
  check(refused, "Failed confirmation was accepted");
  check(
    await page.evaluate(
      () => document.querySelector("iframe") === window.before.frame && !window.before.frame.inert,
    ),
    "Old frame was lost on failure",
  );
  check((await draft.innerText()) === "unsaved words", "Draft was lost on failure");
  check(
    (await front.locator(`${canvas} [data-canvas-pane="evidence"]`).innerText()).includes(
      "Evidence for terminal two",
    ),
    "Canvas evidence was lost on failure",
  );
  await page.evaluate(() => {
    window.failConfirmation = false;
  });
  await activate();
  await page.waitForFunction(
    () =>
      document.querySelectorAll("iframe").length === 1 &&
      document.querySelector("iframe") !== window.before.frame,
  );
  front = page.frames().find((frame) => frame.parentFrame());
  check(
    (await front.evaluate(() => document.documentElement.dataset.frontRevision)) === "next",
    "New executable frontend did not run",
  );
  check(
    (await front.getByRole("textbox", { name: "note.txt" }).innerText()) === "unsaved words",
    "Draft was not handed off",
  );
  check(
    (await front
      .locator('#cli-sidebar [data-terminal-shown="true"]')
      .getAttribute("data-terminal")) === "/tmp cli 2",
    "Selected terminal changed",
  );
  check((await front.locator(".xterm").count()) === 3, "A terminal disappeared or was duplicated");
  check(
    (await front.evaluate(() => document.activeElement?.getAttribute("aria-label"))) === "note.txt",
    "Draft focus was not restored",
  );
  check(
    (await front.locator(`${canvas}:not([hidden]) [data-canvas-pane]`).count()) === 2 &&
      (await front
        .locator('[data-session-canvas="/tmp cli 1"] [data-canvas-pane="other-evidence"]')
        .count()) === 1,
    "Terminal canvases changed during the handoff",
  );
  check(
    (await page.evaluate(() => window.savedFileText())) === "saved text",
    "The handoff must preserve an unsaved draft, not depend on autosave",
  );
  await front.getByRole("button", { name: "Settings", exact: true }).click();
  // The candidate reads the old committed version during startup, before the shell confirms it.
  await front.getByRole("button", { name: "patch", exact: true }).waitFor();
  check(
    await front.getByRole("button", { name: "patch", exact: true }).isDisabled(),
    "The activated frontend must stop offering the patch it just applied",
  );
  check(
    (await front.getByRole("button", { name: "patch", exact: true }).getAttribute("title")) ===
      "patch up to date",
    "Settings must reflect the confirmed patch version",
  );
  await front.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
  await front.getByRole("dialog").waitFor({ state: "hidden" });
  await front.getByRole("textbox", { name: "note.txt" }).focus();
  await front.evaluate(() => {
    window.terminalNodes = [...document.querySelectorAll(".xterm")];
  });
  await activate();
  check(
    await front.evaluate(() =>
      window.terminalNodes.every(
        (node, index) => node === document.querySelectorAll(".xterm")[index],
      ),
    ),
    "Compatible view update replaced terminal DOM",
  );
  const result = await page.evaluate(() => ({
    documentKept: document === window.before.document,
    listeners: window.listenerCount(),
    before: window.before.listeners,
    forbidden: window.calls.filter((call) =>
      ["pty_close", "pty_open", "update_restart"].includes(call.cmd),
    ),
  }));
  check(result.documentKept, "Shell document was replaced");
  check(result.listeners === result.before, "Native listeners leaked across swaps");
  check(result.forbidden.length === 0, "Swap restarted a process");
  check(errors.length === 0, `Browser errors: ${errors.join(", ")}`);
  // A newly opened session must reserve a fresh ID and await its actual startup.
  await front
    .locator('#cli-sidebar [data-terminal-shown="true"] .xterm-helper-textarea')
    .press("Control+a");
  await front.waitForFunction(() => document.querySelectorAll("#cli-sidebar .xterm").length === 4);
  await page.waitForFunction(() =>
    window.calls.some((call) => call.cmd === "pty_attach" && call.args.id === "/tmp cli 4"),
  );
  check(
    (await front.locator('#cli-sidebar [data-terminal="/tmp cli 4"]').count()) === 1,
    "New terminal reused a transferred ID or attached before startup",
  );
  check(
    (await front.locator('[data-session-canvas="/tmp cli 4"]:not([hidden])').count()) === 1 &&
      (await front.locator('[data-session-canvas="/tmp cli 4"] [data-canvas-pane]').count()) === 0,
    "A new terminal must have its own empty canvas",
  );
  return { ...result, errors };
}
