import assert from "node:assert/strict";

async function installSetupNative(page) {
  await page.addInitScript(() => {
    if (window.top !== window) return;
    let serial = 0;
    let settings;
    const callbacks = new Map();
    const local = "/projects/local";
    const wsl = "\\\\wsl.localhost\\Ubuntu\\home\\a\\project";
    const replies = {
      [local]: {
        command: "'/home/a/Applications/totex/bin/totex' --register-codex-mcp",
        environment: "Linux",
      },
      [wsl]: {
        command: `'/mnt/c/Users/a/AppData/Local/totex/totex.exe' --register-codex-mcp --wsl 'Ubuntu' --codex-home "\${CODEX_HOME:-$HOME/.codex}"`,
        environment: "WSL · Ubuntu",
      },
    };
    const document = () => ({
      path: "/tmp/mcp-setup-settings.json",
      text: JSON.stringify(settings),
      value: structuredClone(settings),
    });
    window.mcpSetupFixture = {
      local,
      wsl,
      replies,
      modes: { [local]: "pending", [wsl]: "ready" },
      port: null,
      calls: [],
      pending: [],
      copied: [],
      refuseCopy: false,
      saved: null,
    };
    const fixture = window.mcpSetupFixture;
    window.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
      transformCallback(callback) {
        callbacks.set(++serial, callback);
        return serial;
      },
      unregisterCallback(id) {
        callbacks.delete(id);
      },
      async invoke(cmd, args = {}) {
        fixture.calls.push({ cmd, args });
        if (cmd === "plugin:event|listen") return ++serial;
        if (cmd === "app_settings_read") {
          settings = {
            ...args.initial,
            language: "en",
            mcpServing: localStorage.getItem("mcp.fixture.enabled") === "true",
          };
          fixture.saved = structuredClone(settings);
          return document();
        }
        if (cmd === "app_settings_patch") {
          settings = { ...settings, ...args.patch };
          fixture.saved = structuredClone(settings);
          localStorage.setItem("mcp.fixture.enabled", String(settings.mcpServing));
          return document();
        }
        if (cmd === "mcp_serving") return fixture.port;
        if (cmd === "mcp_serve") {
          fixture.port = 26374;
          return fixture.port;
        }
        if (cmd === "mcp_stop") {
          fixture.port = null;
          return null;
        }
        if (cmd === "mcp_setup") {
          const mode = fixture.modes[args.cwd];
          if (mode === "error") {
            fixture.port = null;
            throw new Error(
              "Could not start totex MCP at http://127.0.0.1:26374/mcp: address already in use",
            );
          }
          if (mode === "pending")
            return new Promise((resolve) => fixture.pending.push({ cwd: args.cwd, resolve }));
          if (!replies[args.cwd]) throw new Error("Unexpected terminal folder");
          fixture.port = 26374;
          return structuredClone(replies[args.cwd]);
        }
        if (cmd.startsWith("mcp_") && cmd !== "mcp_reports")
          throw new Error("Unexpected MCP credential or registration request");
        if (cmd === "plugin:clipboard-manager|write_text") {
          if (fixture.refuseCopy) throw new Error("Clipboard unavailable");
          fixture.copied.push(args.text);
          return null;
        }
        if (cmd === "pty_sessions")
          return [
            { id: "mcp-local", cwd: local, rows: 24, cols: 80, meta: '{"branch":"local"}' },
            { id: "mcp-wsl", cwd: wsl, rows: 24, cols: 80, meta: '{"branch":"wsl"}' },
          ];
        if (cmd === "pty_attach") return { text: "Retained terminal\r\n", upto: 0 };
        if (cmd === "workspace_statuses") return {};
        if (
          [
            "canvas_read",
            "pty_doing",
            "pty_standing",
            "mcp_reports",
            "list_roots",
            "describe_folders",
            "git_readings",
            "status_worktrees",
            "update_standing",
          ].includes(cmd)
        )
          return [];
        return null;
      },
    };
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
  });
}

const enabledCheckbox = (page) =>
  page.getByRole("checkbox", { name: "Let agents display evidence via MCP", exact: true });
const commandBox = (page) => page.getByLabel("Codex MCP registration command", { exact: true });

async function savedEnabled(page, enabled) {
  await page.waitForFunction(
    (enabled) =>
      window.mcpSetupFixture.saved?.mcpServing === enabled &&
      localStorage.getItem("mcp.fixture.enabled") === String(enabled),
    enabled,
  );
}

async function switchTerminal(page, number, id) {
  // Keep the real Settings dialog open while page navigation changes its terminal context.
  await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).focus();
  await page.keyboard.press(`Control+${number}`);
  await page.waitForFunction(
    async (id) => (await window.mcpSetupSnapshot()).values["sessions.active"] === id,
    id,
  );
}

async function assertCommand(page, environment, command) {
  await page.getByText(`Codex · ${environment}`, { exact: true }).waitFor();
  await page.waitForFunction(
    (command) =>
      document.querySelector('[aria-label="Codex MCP registration command"]')?.textContent ===
      command,
    command,
  );
  assert.equal(await commandBox(page).textContent(), command);
  assert.equal(await commandBox(page).evaluate((element) => element.isContentEditable), false);
  assert.equal(
    await commandBox(page).evaluate((element) => getComputedStyle(element).whiteSpace),
    "pre-wrap",
  );
}

/** Real Settings, PageWorkspace and xterm; native preparation never writes Codex configuration. */
export async function verifyMcpSetup(page, base = "http://127.0.0.1:18422") {
  const errors = [];
  const collect = (error) => errors.push(error.message);
  page.on("pageerror", collect);
  try {
    await installSetupNative(page);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`${base}/tests/fixtures/mcp-setup.html`);
    await enabledCheckbox(page).waitFor();
    assert.equal(await enabledCheckbox(page).isChecked(), false);
    assert.equal(await commandBox(page).count(), 0);
    assert.equal(
      await page.evaluate(() =>
        window.mcpSetupFixture.calls.some(({ cmd }) => cmd === "mcp_setup"),
      ),
      false,
    );

    await enabledCheckbox(page).check();
    await savedEnabled(page, true);
    await page.getByText("Preparing command…", { exact: true }).waitFor();
    assert.equal(await commandBox(page).count(), 0);
    await page.waitForFunction(() => window.mcpSetupFixture.pending.length > 0);
    const replies = await page.evaluate(() => {
      const fixture = window.mcpSetupFixture;
      fixture.modes[fixture.local] = "ready";
      for (const request of fixture.pending.splice(0))
        request.resolve(structuredClone(fixture.replies[request.cwd]));
      return { local: fixture.replies[fixture.local], wsl: fixture.replies[fixture.wsl] };
    });
    await assertCommand(page, replies.local.environment, replies.local.command);
    assert.equal(await page.evaluate(() => window.mcpSetupFixture.port), 26374);
    await page.setViewportSize({ width: 720, height: 1000 });
    await page.waitForFunction(() => {
      const element = document.querySelector('[aria-label="Codex MCP registration command"]');
      return element && element.scrollWidth <= element.clientWidth + 1;
    });
    await page.getByRole("button", { name: "Copy command", exact: true }).click();
    await page.getByRole("button", { name: "Copied", exact: true }).waitFor();
    assert.deepEqual(await page.evaluate(() => window.mcpSetupFixture.copied), [
      replies.local.command,
    ]);
    await page.setViewportSize({ width: 1440, height: 1000 });

    await enabledCheckbox(page).uncheck();
    await savedEnabled(page, false);
    await commandBox(page).waitFor({ state: "detached" });
    await page.reload();
    await enabledCheckbox(page).waitFor();
    assert.equal(await enabledCheckbox(page).isChecked(), false, "OFF survives a settings reload");
    assert.equal(
      await page.evaluate(() =>
        window.mcpSetupFixture.calls.some(({ cmd }) => cmd === "mcp_setup"),
      ),
      false,
    );
    await page.evaluate(() => {
      const fixture = window.mcpSetupFixture;
      fixture.modes[fixture.local] = "error";
    });
    await enabledCheckbox(page).check();
    await savedEnabled(page, true);
    await page.getByText("Could not prepare the command.", { exact: false }).waitFor();
    await page
      .getByText("http://127.0.0.1:26374/mcp: address already in use", { exact: false })
      .waitFor();
    assert.equal(await commandBox(page).count(), 0);
    await page.evaluate(() => {
      const fixture = window.mcpSetupFixture;
      fixture.modes[fixture.local] = "ready";
    });
    await page.getByRole("button", { name: "Retry", exact: true }).click();
    await assertCommand(page, replies.local.environment, replies.local.command);
    assert.equal(await page.evaluate(() => window.mcpSetupFixture.port), 26374);

    await page.evaluate(() => {
      window.mcpSetupFixture.refuseCopy = true;
    });
    await page.getByRole("button", { name: "Copy command", exact: true }).click();
    await page.getByText("Could not copy. Select and copy the command.", { exact: true }).waitFor();
    assert.equal(await commandBox(page).textContent(), replies.local.command);
    await page.evaluate(() => {
      window.mcpSetupFixture.refuseCopy = false;
    });
    await page.getByRole("button", { name: "Copy command", exact: true }).click();
    await page.getByRole("button", { name: "Copied", exact: true }).waitFor();

    await switchTerminal(page, 2, "mcp-wsl");
    await assertCommand(page, replies.wsl.environment, replies.wsl.command);
    await page.setViewportSize({ width: 720, height: 1000 });
    await page.waitForFunction(() => {
      const element = document.querySelector('[aria-label="Codex MCP registration command"]');
      const code = element?.querySelector("code");
      if (!code) return false;
      const range = document.createRange();
      range.selectNodeContents(code);
      return range.getClientRects().length > 1 && element.scrollWidth <= element.clientWidth + 1;
    });
    assert.equal(await page.getByRole("button", { name: "Copied", exact: true }).count(), 0);
    await page.getByRole("button", { name: "Copy command", exact: true }).click();
    assert.equal(
      await page.evaluate(() => window.mcpSetupFixture.copied.at(-1)),
      replies.wsl.command,
    );
    await page.setViewportSize({ width: 1440, height: 1000 });

    await page.evaluate(() => {
      const fixture = window.mcpSetupFixture;
      fixture.modes[fixture.local] = "pending";
    });
    await switchTerminal(page, 1, "mcp-local");
    await page.getByText("Preparing command…", { exact: true }).waitFor();
    await page.waitForFunction(() => window.mcpSetupFixture.pending.length > 0);
    await switchTerminal(page, 2, "mcp-wsl");
    await assertCommand(page, replies.wsl.environment, replies.wsl.command);
    await page.evaluate(() => {
      const fixture = window.mcpSetupFixture;
      for (const request of fixture.pending.splice(0))
        request.resolve({ command: "stale preparation must never be shown", environment: "Old" });
    });
    await page.evaluate(() => new Promise(requestAnimationFrame));
    await assertCommand(page, replies.wsl.environment, replies.wsl.command);
    assert.equal(
      await page.getByText("stale preparation must never be shown", { exact: true }).count(),
      0,
    );

    const state = await page.evaluate(async () => {
      const fixture = window.mcpSetupFixture;
      return {
        calls: fixture.calls,
        saved: fixture.saved,
        stored: JSON.stringify({
          local: { ...localStorage },
          session: { ...sessionStorage },
          snapshot: await window.mcpSetupSnapshot(),
        }),
      };
    });
    for (const { args } of state.calls.filter(({ cmd }) => cmd === "mcp_setup"))
      assert.deepEqual(Object.keys(args), ["cwd"], "Preparation passes only the current folder");
    for (const { args } of state.calls.filter(({ cmd }) => cmd === "app_settings_patch"))
      assert.deepEqual(Object.keys(args.patch), ["mcpServing"]);
    assert.equal(state.saved.mcpServing, true);
    assert.equal(
      state.stored.includes("--register-codex-mcp"),
      false,
      "Commands are not stored with UI settings",
    );
    assert.equal(JSON.stringify(state.saved).includes("--register-codex-mcp"), false);
    assert.equal(
      state.calls.some(({ cmd }) => cmd === "pty_write"),
      false,
      "Preparing and copying never executes the registration command",
    );
    assert.ok(
      state.calls
        .filter(({ cmd }) => cmd.startsWith("mcp_"))
        .every(({ cmd }) =>
          ["mcp_setup", "mcp_serving", "mcp_serve", "mcp_stop", "mcp_reports"].includes(cmd),
        ),
      "Setup never reads credentials or asks the backend to register Codex",
    );
    await page.reload();
    await enabledCheckbox(page).waitFor();
    assert.equal(await enabledCheckbox(page).isChecked(), true, "ON survives a settings reload");
    await page.getByText("Preparing command…", { exact: true }).waitFor();
    assert.deepEqual(errors, []);
    return "MCP toggle persistence, fixed-port startup retry, exact clipboard, selected-terminal context and stale completion";
  } finally {
    await page.keyboard.up("Control");
    page.off("pageerror", collect);
  }
}
