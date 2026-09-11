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
              "files.open": [{ id: 1, path: "/tmp/note.txt", at: null }],
            },
          };
          return connection;
        };
        shell = value;
      },
    });
    window.calls = [];
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
        if (
          [
            "pty_asking",
            "pty_doing",
            "mcp_reports",
            "mcp_setups",
            "list_roots",
            "describe_folders",
            "update_standing",
          ].includes(cmd)
        )
          return [];
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
            text: "saved text",
            size: 10,
            truncated: false,
          };
        if (cmd === "file_diff")
          return { standing: "unknown", patch: "", truncated: false, runs: [] };
        if (cmd === "confirm_front" && window.failConfirmation)
          throw new Error("Confirmation refused");
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
  const draft = front.getByRole("textbox", { name: "note.txt" });
  await draft.fill("unsaved words");
  await draft.focus();
  await page.waitForFunction(
    () => window.calls.filter((call) => call.cmd === "pty_attach").length === 3,
  );
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
    (await front.locator('[data-terminal-shown="true"]').getAttribute("data-terminal")) ===
      "/tmp cli 2",
    "Selected terminal changed",
  );
  check((await front.locator(".xterm").count()) === 3, "A terminal disappeared");
  check(
    (await front.evaluate(() => document.activeElement?.getAttribute("aria-label"))) === "note.txt",
    "Draft focus was not restored",
  );
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
      ["pty_close", "pty_open", "update_restart", "write_file"].includes(call.cmd),
    ),
  }));
  check(result.documentKept, "Shell document was replaced");
  check(result.listeners === result.before, "Native listeners leaked across swaps");
  check(result.forbidden.length === 0, "Swap restarted a process or saved the draft");
  check(errors.length === 0, `Browser errors: ${errors.join(", ")}`);
  // A newly opened session must reserve a fresh ID and await its actual startup.
  await front.locator('[data-terminal-shown="true"] .xterm-helper-textarea').press("Control+a");
  await front.waitForFunction(() => document.querySelectorAll(".xterm").length === 4);
  await page.waitForFunction(() =>
    window.calls.some((call) => call.cmd === "pty_attach" && call.args.id === "/tmp cli 4"),
  );
  check(
    (await front.locator('[data-terminal="/tmp cli 4"]').count()) === 1,
    "New terminal reused a transferred ID or attached before startup",
  );
  return { ...result, errors };
}
