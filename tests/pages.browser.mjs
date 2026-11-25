import assert from "node:assert/strict";
import { installCanvasNative } from "./fixtures/canvas-native.mjs";

const canvasFor = (page, id) => page.locator(`[data-session-canvas="${id}"]`);
const terminalFor = (page, id) => page.locator(`#cli-sidebar [data-terminal="${id}"]`);

async function focusTerminal(page) {
  await page.locator('[data-terminal-shown="true"] .xterm-helper-textarea').focus();
}

async function showTerminal(page, number, id) {
  await focusTerminal(page);
  await page.keyboard.press(`Control+${number}`);
  const canvasId = await page.evaluate(async (id) => {
    const session = (await window.pageSnapshot()).values["sessions.list"].find(
      (one) => one.id === id,
    );
    return session.canvas ?? session.id;
  }, id);
  await canvasFor(page, canvasId).waitFor({ state: "visible" });
  await terminalFor(page, id).locator(".xterm-helper-textarea").waitFor({ state: "attached" });
  assert.equal(await terminalFor(page, id).getAttribute("data-terminal-shown"), "true");
}

async function holdCanvas(page) {
  await page.keyboard.down("Control");
  await page.keyboard.down("Space");
  await page.locator('[data-session-canvas][data-selecting="true"]').waitFor();
}

async function releaseCanvas(page) {
  await page.keyboard.up("Space");
  await page.keyboard.up("Control");
  await page.waitForFunction(
    () =>
      !document.querySelector("[data-selecting]") &&
      document.activeElement?.matches('[data-terminal-shown="true"] .xterm-helper-textarea'),
  );
}

async function blankPane(page, id) {
  await page.waitForFunction(
    (id) => window.canvasStates[id].panes.some((pane) => pane.kind === "empty"),
    id,
  );
  const pane = await page.evaluate(
    (id) => window.canvasStates[id].panes.find((pane) => pane.kind === "empty").id,
    id,
  );
  await canvasFor(page, id).locator(`[data-canvas-pane="${pane}"]`).waitFor();
  return pane;
}

async function paneMenu(page, pane, keyboard = false) {
  const kind = await pane.evaluate(
    (element) => element.closest("[data-canvas-pane]")?.dataset.canvasKind,
  );
  if (keyboard || (kind && kind !== "empty")) {
    await pane.focus();
    await page.keyboard.press("Shift+F10");
  } else {
    await pane.click({ button: "right" });
  }
  await page.getByRole("menuitem", { name: "Add pane", exact: true }).waitFor();
  assert.equal(await page.getByRole("menuitem", { name: "Raw data", exact: true }).count(), 0);
  assert.equal(await page.getByRole("menuitem", { name: "Preview", exact: true }).count(), 0);
}

async function assertEmptyCanvas(page, id) {
  const canvas = canvasFor(page, id);
  await canvas.locator(".canvas-empty").waitFor();
  assert.equal(await canvas.locator("[data-canvas-pane]").count(), 0);
  assert.equal((await canvas.innerText()).trim(), "", "An unused canvas has no instruction text");
}

async function assertSingleTerminalViews(page) {
  const state = await page.evaluate(async () => {
    const { values } = await window.pageSnapshot();
    const hosts = [...document.querySelectorAll("[data-terminal]")];
    return {
      sessions: values["sessions.list"].map((session) => session.id).sort(),
      tabs: values["canvas.tabs"].map((tab) => tab.id).sort(),
      hosts: hosts.map((node) => node.dataset.terminal).sort(),
      canvases: [...document.querySelectorAll("[data-session-canvas]")]
        .map((node) => node.dataset.sessionCanvas)
        .sort(),
      xterms: hosts.map((node) => node.querySelectorAll(".xterm").length),
      shownTerminals: document.querySelectorAll('[data-terminal-shown="true"]').length,
      shownCanvases: document.querySelectorAll("[data-session-canvas]:not([hidden])").length,
      centeredTerminals: document.querySelectorAll("main [data-terminal]").length,
    };
  });
  assert.deepEqual(state.hosts, state.sessions, "Every terminal has exactly one DOM host");
  assert.deepEqual(state.canvases, state.tabs, "Each tab owns one shared canvas");
  assert.ok(
    state.xterms.every((count) => count === 1),
    "Every terminal has one xterm instance",
  );
  assert.equal(state.shownTerminals, 1);
  assert.equal(state.shownCanvases, 1);
  assert.equal(state.centeredTerminals, 0, "Terminal output stays in the right sidebar");
  assert.equal(await page.locator("[data-page-card], .card-board").count(), 0);
  assert.equal(
    await page
      .locator(
        ".terminal-canvases header, .terminal-canvases form, .terminal-canvases fieldset, " +
          ".terminal-canvases [role=toolbar], .terminal-canvases button, " +
          ".terminal-canvases .canvas-pane-tools, .terminal-canvases .canvas-file-views",
      )
      .count(),
    0,
    "The resting canvas contains content and separators without buttons, titles, tabs or forms",
  );
  assert.equal(
    await page.locator("#cli-sidebar .session-index, #cli-sidebar .session-location").count(),
    0,
  );
  assert.equal(
    await page
      .locator("#cli-sidebar .session-terminal:not([hidden]) .page__header .page__terminal-list")
      .count(),
    0,
    "Terminal navigation lives in the canvas tabs",
  );
  assert.equal(
    await page.getByText(/Legacy (task|request) summary must not be rendered/).count(),
    0,
  );
}

async function verifyFrameRetention(page) {
  const first = canvasFor(page, "terminal-one");
  await first.getByRole("heading", { name: "Review evidence", exact: true }).waitFor();
  const live = page.frame({ url: "http://127.0.0.1:18424/live" });
  assert.ok(live, "The localhost preview is an actual child browsing context");
  await live.getByRole("heading", { name: "Development preview", exact: true }).waitFor();
  await live.getByText("API connected", { exact: true }).waitFor();
  await live.getByRole("button", { name: "Count 0", exact: true }).click();
  await live.getByRole("button", { name: "Count 1", exact: true }).waitFor();
  const mount = await live.evaluate(() => window.canvasFixtureMount);
  assert.equal(await live.evaluate(() => localStorage.getItem("canvas.fixture.count")), "1");
  assert.equal(await live.evaluate(() => typeof window.__TAURI_INTERNALS__), "undefined");
  assert.equal(
    await live.evaluate(() => {
      try {
        void window.top.__TAURI_INTERNALS__;
        return false;
      } catch {
        return true;
      }
    }),
    true,
    "The served origin cannot access the app's native bridge",
  );
  await page.evaluate(() => {
    window.originalCanvasFrame = document.querySelector('[data-canvas-pane="live"] iframe');
    window.originalTerminal = document.querySelector('[data-terminal="terminal-one"] .xterm');
    window.originalAttachCount = window.pageCalls.filter(
      ({ cmd, args }) => cmd === "pty_attach" && args.id === "terminal-one",
    ).length;
  });
  await showTerminal(page, 2, "terminal-two");
  await canvasFor(page, "terminal-two")
    .getByText(/const total = items.reduce/)
    .waitFor();
  assert.equal(await first.isVisible(), false);
  assert.equal(await live.locator("button").textContent(), "Count 1");
  await showTerminal(page, 1, "terminal-one");
  await page.evaluate(() => {
    const canvas = window.canvasStates["terminal-one"];
    canvas.revision++;
    canvas.panes.find((pane) => pane.id === "live").title = "Updated preview title";
  });
  await page.locator('[data-canvas-pane="live"] iframe[title="Updated preview title"]').waitFor();
  assert.equal(await live.evaluate(() => window.canvasFixtureMount), mount);
  assert.equal(await live.getByRole("button", { name: "Count 1", exact: true }).count(), 1);
  assert.equal(
    await page.evaluate(
      () =>
        window.originalCanvasFrame === document.querySelector('[data-canvas-pane="live"] iframe') &&
        window.originalTerminal ===
          document.querySelector('[data-terminal="terminal-one"] .xterm') &&
        window.originalAttachCount ===
          window.pageCalls.filter(
            ({ cmd, args }) => cmd === "pty_attach" && args.id === "terminal-one",
          ).length,
    ),
    true,
    "Switching terminals preserves both the iframe and terminal runtime",
  );
  const geometry = await first.evaluate((node) => {
    const box = node.getBoundingClientRect();
    const cells = [...node.querySelectorAll(":scope > [data-canvas-pane]")].map((pane) =>
      pane.getBoundingClientRect(),
    );
    return {
      width: box.width,
      height: box.height,
      left: Math.min(...cells.map((cell) => cell.left)) - box.left,
      top: Math.min(...cells.map((cell) => cell.top)) - box.top,
      right: box.right - Math.max(...cells.map((cell) => cell.right)),
      bottom: box.bottom - Math.max(...cells.map((cell) => cell.bottom)),
      emptyArea:
        box.width * box.height - cells.reduce((sum, cell) => sum + cell.width * cell.height, 0),
    };
  });
  for (const edge of ["left", "top", "right", "bottom"])
    assert.ok(Math.abs(geometry[edge]) <= 1, `Panes reach the canvas ${edge} edge`);
  assert.ok(
    geometry.emptyArea <= (geometry.width + geometry.height) * 2,
    "Only separator lines remain between panes",
  );
  await assertSingleTerminalViews(page);
}

async function verifyCanvasEditing(page) {
  const first = canvasFor(page, "terminal-one");
  const before = await page.evaluate(() => ({
    panes: window.canvasStates["terminal-one"].panes.length,
    writes: window.pageCalls.filter(({ cmd }) => cmd === "pty_write").length,
  }));
  await first.locator('[data-canvas-pane="live"]').focus();
  await focusTerminal(page);
  await holdCanvas(page);
  await page.keyboard.press("Shift+F10");
  await page.getByRole("menuitem", { name: "Remove pane", exact: true }).waitFor();
  assert.equal(await page.locator(".canvas-menu-name").innerText(), "live");
  assert.equal(await page.locator(".canvas-menu-path").innerText(), "http://127.0.0.1:18424/live");
  await page.keyboard.up("Space");
  await page.keyboard.up("Control");
  await page.getByRole("menuitem", { name: "Remove pane", exact: true }).waitFor();
  assert.equal(await first.locator("[data-canvas-pane]").count(), before.panes);
  await page.keyboard.press("Escape");
  await page.getByRole("menu").waitFor({ state: "detached" });
  // A foreign iframe's mouse events cannot bubble into the app; the pane supports a keyboard menu.
  await paneMenu(page, first.locator('[data-canvas-pane="live"]'), true);
  await page.getByRole("menuitem", { name: "Add pane", exact: true }).click();
  const added = await blankPane(page, "terminal-one");
  await paneMenu(page, first.locator(`[data-canvas-pane="${added}"]`));
  await page.getByRole("menuitem", { name: "Remove pane", exact: true }).click();
  await first.locator(`[data-canvas-pane="${added}"]`).waitFor({ state: "detached" });
  assert.equal(await first.locator("[data-canvas-pane]").count(), before.panes);

  await first.locator('[data-canvas-pane="live"]').focus();
  await focusTerminal(page);
  await holdCanvas(page);
  await page.keyboard.press("ArrowRight");
  await page.waitForFunction(
    () =>
      document.querySelector('[data-session-canvas="terminal-one"] [data-selected]')?.dataset
        .canvasPane !== "live",
  );
  await page.keyboard.press("ArrowLeft");
  await page.waitForFunction(
    () =>
      document.querySelector('[data-session-canvas="terminal-one"] [data-selected]')?.dataset
        .canvasPane === "live",
  );
  await page.keyboard.press("a");
  const removed = await blankPane(page, "terminal-one");
  await page.keyboard.press("x");
  await first.locator(`[data-canvas-pane="${removed}"]`).waitFor({ state: "detached" });
  assert.equal(await first.locator("[data-canvas-pane]").count(), before.panes);
  await page.keyboard.press("a");
  const blank = await blankPane(page, "terminal-one");
  await releaseCanvas(page);
  assert.equal(
    await page.evaluate(() => window.pageCalls.filter(({ cmd }) => cmd === "pty_write").length),
    before.writes,
    "Canvas shortcuts never send Control+Space, arrows, A or X to the shell",
  );
  await page.keyboard.press("ArrowRight");
  await page.waitForFunction(
    (count) => window.pageCalls.filter(({ cmd }) => cmd === "pty_write").length > count,
    before.writes,
  );
  assert.equal(
    await first.locator("[data-selected]").getAttribute("data-canvas-pane"),
    blank,
    "Arrows return to the terminal as soon as the chord is released",
  );
  const transfer = await page.evaluateHandle(() => {
    const data = new DataTransfer();
    data.setData("application/x-totex-file", "/tmp/dropped.txt");
    data.setData("text/plain", "/tmp/dropped.txt");
    return data;
  });
  try {
    const target = first.locator(`[data-canvas-pane="${blank}"]`);
    const box = await target.boundingBox();
    const at = { clientX: box.x + box.width / 2, clientY: box.y + box.height / 2 };
    await target.dispatchEvent("dragover", { dataTransfer: transfer, ...at });
    await target.dispatchEvent("drop", { dataTransfer: transfer, ...at });
  } finally {
    await transfer.dispose();
  }
  await first.getByRole("textbox", { name: "dropped.txt", exact: true }).waitFor();
  assert.equal(await first.locator("[data-canvas-pane]").count(), before.panes + 1);
  assert.equal(await first.locator(`[data-canvas-pane="${blank}"]`).count(), 0);
  assert.equal(
    await page.evaluate(() => window.pageCalls.some(({ cmd }) => cmd === "fs_delete_file")),
    false,
    "Removing a pane never deletes its source file",
  );
  await assertSingleTerminalViews(page);
}

async function verifySaveProtection(page) {
  const first = canvasFor(page, "terminal-one");
  const note = first.getByRole("textbox", { name: "note.txt", exact: true });
  await page.evaluate(() => {
    window.pageWriteRefused = true;
  });
  await note.fill("keep this draft");
  const revision = await page.evaluate(() => window.canvasStates["terminal-one"].revision);
  await paneMenu(page, note);
  await page.getByRole("menuitem", { name: "Remove pane", exact: true }).click();
  await page.locator(".canvas-error").waitFor();
  assert.equal(await note.textContent(), "keep this draft");
  assert.equal(await page.evaluate(() => window.canvasStates["terminal-one"].revision), revision);
  assert.equal(await page.evaluate(() => window.pageFileText), "saved text");

  const writes = await page.evaluate(
    () => window.pageCalls.filter(({ cmd }) => cmd === "write_file").length,
  );
  await focusTerminal(page);
  await page.keyboard.press("Control+x");
  await page.waitForFunction(
    (count) => window.pageCalls.filter(({ cmd }) => cmd === "write_file").length > count,
    writes,
  );
  await page.evaluate(() => new Promise(requestAnimationFrame));
  assert.equal(await terminalFor(page, "terminal-one").count(), 1);
  assert.equal(await note.count(), 1);
  assert.equal(
    await page.evaluate(() => window.pageCalls.some(({ cmd }) => cmd === "pty_close")),
    false,
    "A failed canvas save also prevents closing its terminal",
  );

  await page.evaluate(() => {
    window.pageWriteRefused = false;
  });
  await paneMenu(page, note);
  await page.getByRole("menuitem", { name: "Remove pane", exact: true }).click();
  await note.waitFor({ state: "detached" });
  assert.equal(await page.evaluate(() => window.pageFileText), "keep this draft");
  assert.equal(await terminalFor(page, "terminal-one").count(), 1);
}

async function verifyExplorerContext(page) {
  await showTerminal(page, 2, "terminal-two");
  const first = await page.evaluate(() => structuredClone(window.canvasStates["terminal-one"]));
  await page.locator('[data-pick-row="/tmp/sub"]').click();
  await page.locator('[data-pick-row="/tmp/sub/child.txt"]').dblclick();
  const worker = canvasFor(page, "terminal-two");
  await worker.getByRole("textbox", { name: "child.txt", exact: true }).waitFor();
  assert.equal(
    await worker.getByRole("textbox", { name: "child.txt", exact: true }).textContent(),
    "Explorer file text",
  );
  assert.deepEqual(
    await page.evaluate(() => window.canvasStates["terminal-one"]),
    first,
    "Explorer files are attached to the currently selected terminal",
  );
  await page.evaluate(() => {
    const canvas = window.canvasStates["terminal-two"];
    canvas.revision += 1;
    canvas.panes = canvas.panes.map((pane) =>
      pane.id === "worker-code" ? { ...pane, text: "const agentUpdate = 'ready';" } : pane,
    );
    canvas.panes.push({
      id: "agent-shot",
      kind: "image",
      src: "/tmp/shot.png",
      title: "Agent screenshot",
    });
  });
  await worker.getByText("const agentUpdate = 'ready';", { exact: true }).waitFor();
  await page.waitForFunction(() => {
    const image = document.querySelector('[data-canvas-pane="agent-shot"] img');
    return image?.complete && image.naturalWidth === 1;
  });
  assert.deepEqual(await page.evaluate(() => window.canvasStates["terminal-one"]), first);
  await showTerminal(page, 1, "terminal-one");
  assert.equal(await worker.isVisible(), false);
  assert.equal(
    await canvasFor(page, "terminal-one").locator('[data-canvas-pane="agent-shot"]').count(),
    0,
  );
}

async function verifyTerminalStartup(page) {
  await showTerminal(page, 1, "terminal-one");
  const before = await page.evaluate(() => structuredClone(window.canvasStates["terminal-one"]));
  await page.keyboard.press("Control+a");
  await page.waitForFunction(
    async () => (await window.pageSnapshot()).values["sessions.list"].length === 4,
  );
  const opened = await page.evaluate(
    async () => (await window.pageSnapshot()).values["sessions.active"],
  );
  await terminalFor(page, opened).locator(".xterm").waitFor();
  assert.deepEqual(await page.evaluate(() => window.canvasStates["terminal-one"]), before);
  assert.equal(await canvasFor(page, "terminal-one").isVisible(), true);
  assert.equal(await canvasFor(page, opened).count(), 0);
  await assertSingleTerminalViews(page);
  await page.getByRole("button", { name: "New canvas", exact: true }).click();
  await page.getByRole("menuitem", { name: "/empty-a", exact: true }).click();
  const newCanvas = page.locator("[data-session-canvas]:not([hidden])");
  const id = await newCanvas.getAttribute("data-session-canvas");
  await assertEmptyCanvas(page, id);
  await paneMenu(page, newCanvas);
  await page.getByRole("menuitem", { name: "Add pane", exact: true }).click();
  const blank = await blankPane(page, id);
  await paneMenu(page, newCanvas.locator(`[data-canvas-pane="${blank}"]`));
  await page.getByRole("menuitem", { name: "Remove pane", exact: true }).click();
  await assertEmptyCanvas(page, id);
  await focusTerminal(page);
  await page.keyboard.press("Control+x");
  await terminalFor(page, id).waitFor({ state: "detached" });
  await assertEmptyCanvas(page, id);
  await page.getByRole("button", { name: "Close canvas /empty-a", exact: true }).click();
  await canvasFor(page, id).waitFor({ state: "detached" });
}

async function verifyTerminalInsertion(page) {
  await assertOrder(["terminal-one", "terminal-two", "terminal-other"]);
  await page.evaluate(() => {
    window.orderedTerminalHosts = [...document.querySelectorAll("[data-terminal]")].map((host) => ({
      id: host.dataset.terminal,
      host,
      xterm: host.querySelector(".xterm"),
      attaches: window.pageCalls.filter(
        ({ cmd, args }) => cmd === "pty_attach" && args.id === host.dataset.terminal,
      ).length,
    }));
  });

  async function assertOrder(ids) {
    const members = await page.evaluate(
      async () => (await window.pageSnapshot()).values["sessions.list"],
    );
    assert.equal(members.length, ids.length);
    assert.equal(await page.locator(".canvas-tab").count(), 3);
    for (const [index, id] of ids.entries()) {
      await showTerminal(page, index + 1, id);
      assert.equal(
        await page
          .locator('.canvas-tab[data-active] .canvas-tab-terminals [aria-pressed="true"]')
          .count(),
        1,
      );
    }
  }

  async function createAfter(number, id) {
    await showTerminal(page, number, id);
    const before = await page.evaluate(
      async () => (await window.pageSnapshot()).values["sessions.list"],
    );
    const source = before.find((session) => session.id === id);
    await page.keyboard.press("Control+a");
    await page.waitForFunction(
      async (count) => (await window.pageSnapshot()).values["sessions.list"].length === count + 1,
      before.length,
    );
    const { opened, call } = await page.evaluate(async () => {
      const { values } = await window.pageSnapshot();
      const opened = values["sessions.list"].find(
        (session) => session.id === values["sessions.active"],
      );
      return {
        opened,
        call: window.pageCalls.filter(
          ({ cmd, args }) => cmd === "pty_open" && args.id === opened.id,
        ),
      };
    });
    assert.ok(
      !before.some((session) => session.id === opened.id),
      "Creation keeps existing IDs distinct",
    );
    assert.deepEqual(
      { cwd: opened.cwd, branch: opened.branch, folder: opened.folder },
      { cwd: source.cwd, branch: source.branch, folder: source.folder },
      "Ctrl+A inherits the selected terminal's directory and metadata",
    );
    assert.equal(call.length, 1, "The new terminal starts exactly once");
    assert.equal(call[0].args.cwd, source.cwd);
    assert.deepEqual(JSON.parse(call[0].args.meta), {
      branch: source.branch,
      ...(source.folder ? { folder: true } : {}),
      canvas: source.canvas ?? source.id,
    });
    await terminalFor(page, opened.id).locator(".xterm").waitFor();

    return opened.id;
  }

  const first = await createAfter(1, "terminal-one");
  await assertOrder(["terminal-one", first, "terminal-two", "terminal-other"]);
  const second = await createAfter(1, "terminal-one");
  await assertOrder(["terminal-one", second, first, "terminal-two", "terminal-other"]);
  const middle = await createAfter(4, "terminal-two");
  await assertOrder(["terminal-one", second, first, "terminal-two", middle, "terminal-other"]);
  const other = await createAfter(6, "terminal-other");
  const order = ["terminal-one", second, first, "terminal-two", middle, "terminal-other", other];
  await assertOrder(order);
  for (const tab of await page.locator(".canvas-tab").all()) {
    await tab.getByRole("tab").click();
    const buttons = tab.locator(".canvas-tab-terminals button[aria-pressed]");
    await buttons.first().click();
    const count = await buttons.count();
    for (let i = 0; i < count; i++) {
      await page.keyboard.press("Control+ArrowUp");
      assert.equal(await buttons.nth((i + 1) % count).getAttribute("aria-pressed"), "true");
    }
    for (let i = 0; i < count; i++) {
      await page.keyboard.press("Control+ArrowDown");
      assert.equal(await buttons.nth(count - i - 1).getAttribute("aria-pressed"), "true");
    }
  }
  assert.equal(
    await page.evaluate(() =>
      window.orderedTerminalHosts.every(
        ({ id, host, xterm, attaches }) =>
          host === document.querySelector(`[data-terminal="${id}"]`) &&
          xterm === host.querySelector(".xterm") &&
          attaches ===
            window.pageCalls.filter(({ cmd, args }) => cmd === "pty_attach" && args.id === id)
              .length,
      ),
    ),
    true,
    "Renumbering preserves existing terminal hosts, xterms and native attachments",
  );
  assert.equal(
    await page.evaluate(() => window.pageCalls.some(({ cmd }) => cmd === "pty_close")),
    false,
  );
  await assertSingleTerminalViews(page);
}

async function runCanvasChecks(page, base, checks, query = "") {
  const errors = [];
  const report = (error) => errors.push(error.message);
  page.on("pageerror", report);
  try {
    await installCanvasNative(page);
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.goto(`${base}/tests/fixtures/pages.html?canvas&grouped&offers&mixed${query}`);
    await canvasFor(page, "terminal-one")
      .getByRole("textbox", { name: "note.txt", exact: true })
      .waitFor();
    await terminalFor(page, "terminal-other").locator(".xterm").waitFor({ state: "attached" });
    await focusTerminal(page);
    for (const check of checks) await check(page);
    assert.deepEqual(errors, [], "Canvas workflows produce no unhandled browser errors");
    return checks.map((check) => check.name).join(", ");
  } finally {
    await page.keyboard.up("Space");
    await page.keyboard.up("Shift");
    await page.keyboard.up("Control");
    page.off("pageerror", report);
  }
}

/** Real Window, editors, iframe JS and xterm; native IO and the localhost app are fixtures. */
export async function verifyPages(page, base = "http://127.0.0.1:18422") {
  return runCanvasChecks(page, base, [
    verifyFrameRetention,
    verifyCanvasEditing,
    verifySaveProtection,
    verifyExplorerContext,
    verifyTerminalStartup,
  ]);
}

export async function verifyTerminalPanes(page, base = "http://127.0.0.1:18422") {
  return runCanvasChecks(page, base, [verifyFrameRetention, verifyTerminalStartup]);
}

export async function verifyTerminalOrdering(page, base = "http://127.0.0.1:18422") {
  return runCanvasChecks(page, base, [verifyTerminalInsertion], "&ordering");
}

export async function verifyMixedPages(page, base = "http://127.0.0.1:18422") {
  return runCanvasChecks(page, base, [
    verifyCanvasEditing,
    verifySaveProtection,
    verifyExplorerContext,
  ]);
}
