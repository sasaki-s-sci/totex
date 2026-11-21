// Real React, xterm and frames; only the native service and served preview are replaced.
export async function installCanvasNative(page) {
  await page.route("http://127.0.0.1:18424/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api")
      return route.fulfill({ contentType: "application/json", body: '{"ready":true}' });
    if (path === "/module.js")
      return route.fulfill({
        contentType: "text/javascript",
        body: 'export const heading = "Development preview";',
      });
    if (path !== "/live") return route.fulfill({ status: 404, body: "Not found" });
    await route.fulfill({
      contentType: "text/html; charset=utf-8",
      body: [
        "<!doctype html><html lang=en><meta charset=utf-8><title>Served preview</title>",
        "<style>body{font:16px system-ui;margin:40px;background:#faf9f6;color:#18302a}",
        "button{padding:12px 20px;background:#184a3b;color:white;border:0}",
        "output{display:block;margin-top:20px}</style>",
        "<h1>Loading preview</h1><p>A served application with its own scripts and storage.</p>",
        "<button type=button>Count 0</button><output>Connecting</output>",
        '<script type="module">',
        'import { heading } from "/module.js";',
        "document.querySelector('h1').textContent = heading;",
        "window.canvasFixtureMount = crypto.randomUUID();",
        "let count = 0;",
        "const button = document.querySelector('button');",
        "localStorage.removeItem('canvas.fixture.count');",
        "button.onclick = () => {",
        "  localStorage.setItem('canvas.fixture.count', String(++count));",
        "  button.textContent = 'Count ' + count;",
        "};",
        "fetch('/api').then(r => r.json()).then(data => {",
        "  document.querySelector('output').textContent = data.ready ? 'API connected' : 'API failed';",
        "});",
        "</script></html>",
      ].join("\n"),
    });
  });
  await page.addInitScript(() => {
    // Native IPC belongs to the app, never to its scriptless wrapper or served pages.
    if (window.top !== window || window.canvasNativeInstalled) return;
    window.canvasNativeInstalled = true;
    localStorage.setItem("totex.language", "en");
    let serial = 0;
    const callbacks = new Map();
    const listeners = new Map();
    const fileVersions = new Map();
    const fileText = (path) => window.pageFiles[path] ?? "saved text";
    const byteSize = (text) => new TextEncoder().encode(text).length;
    const picture =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGOQ8LL+DwACuAGd8psO1AAAAABJRU5ErkJggg==";
    const ordering = location.search.includes("ordering");
    const running = new Map([
      [
        "terminal-one",
        { id: "terminal-one", cwd: "/tmp", rows: 24, cols: 80, meta: '{"branch":"main"}' },
      ],
      ...(location.search.includes("grouped")
        ? [
            [
              "terminal-two",
              {
                id: "terminal-two",
                cwd: "/tmp",
                rows: 24,
                cols: 80,
                meta: ordering ? '{"branch":"worker","folder":true}' : '{"branch":"worker"}',
              },
            ],
            [
              "terminal-other",
              {
                id: "terminal-other",
                cwd: ordering ? "/elsewhere/tmp" : "/elsewhere",
                rows: 24,
                cols: 80,
                meta: '{"branch":"other"}',
              },
            ],
          ]
        : []),
    ]);
    window.pageEmit = (event, payload) => {
      for (const listener of listeners.values()) {
        if (listener.event === event) callbacks.get(listener.handler)?.({ event, payload });
      }
    };
    window.pageCalls = [];
    window.pageCloseRefused = false;
    window.pageClosePending = false;
    window.pageWriteRefused = false;
    window.pageFiles = {
      "/tmp/note.txt": "saved text",
      "/tmp/dropped.txt": "Dropped file text",
      "/tmp/sub/child.txt": "Explorer file text",
    };
    Object.defineProperty(window, "pageFileText", {
      get: () => fileText("/tmp/note.txt"),
      set: (text) => {
        window.pageFiles["/tmp/note.txt"] = text;
        fileVersions.set("/tmp/note.txt", (fileVersions.get("/tmp/note.txt") ?? 0) + 1);
      },
    });
    window.pageClipboard = "日本語\nsecond line";
    window.pageAttachRefused = location.search.includes("attach-error");
    window.canvasStates = {
      "terminal-one": {
        id: "terminal-one",
        revision: 1,
        panes: [
          {
            id: "live",
            kind: "iframe",
            url: "http://127.0.0.1:18424/live",
            title: "Development preview",
          },
          {
            id: "notes",
            kind: "markdown",
            text: "# Review evidence\n\nThe canvas belongs to this terminal.\n\n- Running preview\n- Saved screenshots\n- Source files",
            title: "Review notes",
          },
        ],
      },
      "terminal-two": {
        id: "terminal-two",
        revision: 1,
        panes: [
          {
            id: "worker-code",
            kind: "code",
            text: "const total = items.reduce((sum, item) => sum + item.price, 0);",
            language: "typescript",
          },
        ],
      },
    };
    window.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
      convertFileSrc(path) {
        return `http://127.0.0.1:18424/asset/${encodeURIComponent(path)}`;
      },
      transformCallback(callback) {
        callbacks.set(++serial, callback);
        return serial;
      },
      unregisterCallback(id) {
        callbacks.delete(id);
      },
      async invoke(cmd, args = {}) {
        window.pageCalls.push({ cmd, args });
        if (cmd === "mcp_setup")
          return {
            command: "'/home/a/Applications/totex/bin/totex' --register-codex-mcp",
            environment: "Linux",
          };
        if (cmd === "canvas_read")
          return structuredClone(
            args.id
              ? [window.canvasStates[args.id]].filter(Boolean)
              : Object.values(window.canvasStates),
          );
        if (cmd === "canvas_write") {
          const old = window.canvasStates[args.id] ?? { id: args.id, revision: 0, panes: [] };
          if (args.revision !== old.revision)
            throw new Error("The canvas changed. Read it again before replacing it.");
          const next = {
            id: args.id,
            revision: old.revision + 1,
            panes: structuredClone(args.panes),
          };
          window.canvasStates[args.id] = next;
          return structuredClone(next);
        }
        if (cmd === "plugin:clipboard-manager|read_text") return window.pageClipboard;
        if (cmd === "clipboard_files") return [];
        if (cmd === "terminal_paths") return args.paths;
        if (cmd === "paste_media") return "/tmp/pasted-shot.png";
        if (cmd === "plugin:window|scale_factor") return 1;
        if (cmd === "plugin:event|listen") {
          const id = ++serial;
          listeners.set(id, args);
          return id;
        }
        if (cmd === "plugin:event|unlisten") {
          listeners.delete(args.eventId);
          return null;
        }
        if (cmd === "pty_sessions") return structuredClone([...running.values()]);
        if (cmd === "pty_open") {
          running.set(args.id, { ...args });
          return null;
        }
        if (cmd === "pty_attach") {
          if (window.pageAttachRefused) throw new Error("Temporary attachment failure");
          if (location.search.includes("attach-missing")) return null;
          return (
            window.pageBacklog ?? {
              text: "Retained terminal\r\n",
              upto: 0,
              ...(location.search.includes("terminal-resize")
                ? { windowsPty: { backend: "conpty", buildNumber: 22631 } }
                : {}),
            }
          );
        }
        if (cmd === "pty_close") {
          if (window.pageCloseRefused) throw new Error("Temporary close failure");
          const close = () => {
            running.delete(args.id);
            window.pageEmit("pty:exit", args.id);
          };
          if (window.pageClosePending)
            return new Promise((resolve) => {
              window.releaseClose = () => {
                close();
                resolve(null);
              };
            });
          close();
          return null;
        }
        if (cmd === "pty_standing")
          return window.pageAgent
            ? [
                {
                  id: "terminal-one",
                  doing: "working",
                  asking: false,
                  said: "Canvas review",
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
              taskSummary: "Legacy task summary must not be rendered",
              requestSummary: "Legacy request summary must not be rendered",
              estimate: null,
              updatedAt: Date.now(),
              error: null,
              monitorStatus: "idle",
              shot: null,
              agents: [],
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
          const value = {
            ...args.initial,
            ...(ordering ? { terminalSort: "createdAt" } : {}),
            monitor: { ...args.initial.monitor, enabled: location.search.includes("grouped") },
          };
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
        if (cmd === "stat_file")
          return {
            size: args.path.endsWith(".png") ? 70 : byteSize(fileText(args.path)),
            modifiedMs: fileVersions.get(args.path) ?? 0,
          };
        if (cmd === "read_file_head") {
          const text = fileText(args.path);
          return {
            path: args.path,
            name: args.path.split("/").at(-1),
            text,
            size: byteSize(text),
            truncated: false,
          };
        }
        if (cmd === "media_file") return args.path;
        if (cmd === "read_file_data")
          return { path: args.path, name: args.path.split("/").at(-1), size: 70, data: picture };
        if (cmd === "write_file") {
          if (window.pageWriteRefused) throw new Error("Write refused");
          if (args.expected !== undefined && args.expected !== fileText(args.path))
            throw new Error("file-changed");
          window.pageFiles[args.path] = args.text;
          fileVersions.set(args.path, (fileVersions.get(args.path) ?? 0) + 1);
          return byteSize(args.text);
        }
        if (cmd === "file_diff")
          return { standing: "unknown", patch: "", truncated: false, runs: [] };
        return null;
      },
    };
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
  });
}
