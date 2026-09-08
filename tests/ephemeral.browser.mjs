import assert from "node:assert/strict";

/** Run against the production fixture with a Playwright Page. No dev HMR is involved. */
export async function verifyEphemeral(page, base = "http://127.0.0.1:18421") {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let manifest;
  let candidate = null;
  await page.route("**/ephemeral.json?*", async (route) => {
    if (candidate) return route.fulfill({ json: candidate });
    const response = await route.fetch();
    manifest = await response.json();
    await route.fulfill({ response });
  });
  await page.addInitScript(() => {
    const callbacks = new Map();
    let next = 0;
    window.calls = [];
    window.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
      transformCallback: (callback) => {
        callbacks.set(++next, callback);
        return next;
      },
      unregisterCallback: (id) => callbacks.delete(id),
      invoke: async (cmd, args) => {
        window.calls.push({ cmd, args });
        if (cmd === "plugin:event|listen") return ++next;
        if (cmd === "pty_attach") return { text: `Live ${args.id}\r\n`, upto: 0 };
        if (cmd === "update_standing")
          return ["persistent", "ephemeral"].map((layer) => ({
            layer,
            at: layer === "persistent" ? "0.2.1" : (window.viewVersion ?? "0.2.1"),
            can: true,
            picked: null,
            frontContract: 12,
            ephemeralContract: window.testIdentity?.().contract,
            held: [],
          }));
        if (cmd === "update_take") return "taken";
        if (cmd === "confirm_front") {
          if (window.failConfirm) throw new Error("confirmation failed");
          window.viewVersion = args.version;
        }
        return null;
      },
    };
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
  });
  await page.goto(`${base}/tests/fixtures/ephemeral.html`);
  await page.waitForFunction(
    () =>
      document.querySelectorAll(".xterm").length === 3 &&
      window.calls.filter((c) => c.cmd === "pty_attach").length === 3,
  );
  const draft = page.getByRole("textbox", { name: "Draft" });
  await draft.fill("unfinished input");
  await draft.focus();
  await page.evaluate(() => {
    window.before = {
      terminals: [...document.querySelectorAll(".xterm")],
      draft: document.activeElement,
      document,
      calls: window.calls.length,
      start: performance.timeOrigin,
    };
    window.before.draft.setSelectionRange(3, 9);
  });
  const original = await (await page.request.get(`${base}/${manifest.entry}`)).text();
  await page.route("**/assets/test-views.js", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: `${original}\nconst row = views["src/components/settings/Row.tsx:0"]; views["src/components/settings/Row.tsx:0"] = bindings => row({...bindings, label: "Updated view"});`,
    }),
  );
  candidate = { ...manifest, version: "0.2.2", entry: "assets/test-views.js" };
  assert.equal(await page.evaluate(() => window.testUpdate("ephemeral", "0.2.2")), "swapped");
  await page.getByText("Updated view", { exact: true }).waitFor();
  const kept = await page.evaluate(() => ({
    sameDocument:
      window.before.document === document && window.before.start === performance.timeOrigin,
    sameTerminals: window.before.terminals.every(
      (node, i) => node === document.querySelectorAll(".xterm")[i],
    ),
    sameInput: document.activeElement === window.before.draft,
    draft: window.before.draft.value,
    selection: [window.before.draft.selectionStart, window.before.draft.selectionEnd],
    destructive: window.calls
      .slice(window.before.calls)
      .filter((c) =>
        ["pty_close", "pty_open", "pty_attach", "persistent_restart", "update_restart"].includes(
          c.cmd,
        ),
      ),
  }));
  assert.deepEqual(kept, {
    sameDocument: true,
    sameTerminals: true,
    sameInput: true,
    draft: "unfinished input",
    selection: [3, 9],
    destructive: [],
  });
  // Existing terminals remain writable after the swap.
  await page.locator(".xterm-helper-textarea").first().focus();
  await page.keyboard.type("echo still alive");
  assert.ok(
    await page.evaluate(() =>
      window.calls.some((c) => c.cmd === "pty_write" && c.args.id === "session-1"),
    ),
  );
  candidate = { ...manifest, version: "0.2.3", contract: "incompatible" };
  assert.equal(await page.evaluate(() => window.testUpdate("ephemeral", "0.2.3")), "failed");
  assert.equal(await page.getByText("Updated view", { exact: true }).count(), 1);
  assert.equal(await page.evaluate(() => window.testIdentity().version), "0.2.2");
  // A renderer that throws with live inputs is rejected before any DOM is touched.
  await page.route("**/assets/broken-views.js", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: `${original}\nviews["src/components/settings/Row.tsx:0"] = () => {throw new Error("broken renderer")};`,
    }),
  );
  candidate = { ...manifest, version: "0.2.4", entry: "assets/broken-views.js" };
  assert.equal(await page.evaluate(() => window.testUpdate("ephemeral", "0.2.4")), "failed");
  assert.equal(await page.getByText("Updated view", { exact: true }).count(), 1);
  // Refusal to commit restores both the registry and styles without remounting terminals.
  await page.route("**/assets/uncommitted-views.js", (route) =>
    route.fulfill({ contentType: "text/javascript", body: original }),
  );
  candidate = { ...manifest, version: "0.2.5", entry: "assets/uncommitted-views.js" };
  await page.evaluate(() => {
    window.failConfirm = true;
  });
  assert.equal(await page.evaluate(() => window.testUpdate("ephemeral", "0.2.5")), "failed");
  await page.evaluate(() => {
    window.failConfirm = false;
  });
  assert.equal(await page.getByText("Updated view", { exact: true }).count(), 1);
  await page.route("**/assets/missing-style.css", (route) =>
    route.fulfill({ status: 404, body: "missing" }),
  );
  candidate = { ...manifest, version: "0.2.6", styles: ["assets/missing-style.css"] };
  assert.equal(await page.evaluate(() => window.testUpdate("ephemeral", "0.2.6")), "failed");
  assert.equal(await page.locator('link[media="not all"]').count(), 0);
  assert.equal(await page.getByText("Updated view", { exact: true }).count(), 1);
  // Older compatible views use the same activation path and retain the same terminals.
  candidate = manifest;
  assert.equal(
    await page.evaluate((version) => window.testUpdate("ephemeral", version), manifest.version),
    "swapped",
  );
  await page.getByText("Original view", { exact: true }).waitFor();
  assert.equal(await draft.inputValue(), "unfinished input");
  assert.ok(
    await page.evaluate(() =>
      window.before.terminals.every((node, i) => node === document.querySelectorAll(".xterm")[i]),
    ),
  );
  assert.deepEqual(errors, []);
  // Changing the CLI layout replaces its host DOM node but keeps its controller.
  // The new surface must attach to the existing shell and recover its output.
  const opened = await page.evaluate(() => window.calls.filter((c) => c.cmd === "pty_open").length);
  const attached = await page.evaluate(
    () => window.calls.filter((c) => c.cmd === "pty_attach").length,
  );
  await page.route("**/assets/cli-layout.js", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: `${original}\nconst cli = views["src/components/CliView.tsx:0"]; views["src/components/CliView.tsx:0"] = bindings => globalThis.__TOTEX_VIEWS__.jsx.jsx("section", {children: cli(bindings)});`,
    }),
  );
  candidate = { ...manifest, version: "0.2.7", entry: "assets/cli-layout.js" };
  assert.equal(await page.evaluate(() => window.testUpdate("ephemeral", "0.2.7")), "swapped");
  await page.waitForFunction(
    (count) =>
      document.querySelectorAll(".xterm").length === 3 &&
      window.calls.filter((c) => c.cmd === "pty_attach").length === count + 3,
    attached,
  );
  assert.equal(
    await page.evaluate(() => window.calls.filter((c) => c.cmd === "pty_open").length),
    opened,
  );
  assert.equal(
    await page.evaluate(() => window.calls.filter((c) => c.cmd === "pty_close").length),
    0,
  );
  await page.locator(".xterm-helper-textarea").first().focus();
  await page.keyboard.type("echo recovered");
  assert.deepEqual(errors, []);
  // The persistent path asks for a whole installation followed by a native relaunch.
  await page.evaluate(() => {
    window.calls = [];
  });
  assert.equal(await page.evaluate(() => window.testUpdate("persistent", "0.3.0")), "ready");
  assert.deepEqual(
    await page.evaluate(() =>
      window.calls
        .filter((c) => c.cmd.startsWith("update_"))
        .map((c) => [c.cmd, c.args?.layer, c.args?.version]),
    ),
    [
      ["update_take", "persistent", "0.3.0"],
      ["update_restart", undefined, undefined],
      ["update_standing", undefined, undefined],
    ],
  );
  return { sessions: 3, kept, failuresPreserveView: true, persistentRequestsRelaunch: true };
}
