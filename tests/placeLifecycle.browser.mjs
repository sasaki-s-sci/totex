import assert from "node:assert/strict";

/** Real Window and xterm; only native IPC is mocked. */
export async function verifyPlaces(page, base = "http://127.0.0.1:18422") {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    let serial = 0;
    const callbacks = new Map();
    const repo = {
      id: "repo",
      name: "app",
      path: "/projects/app",
      gitDir: "/projects/app/.git",
      bare: false,
      head: null,
      headDetached: false,
      defaultBranch: null,
      remotes: [],
      branches: [],
      commits: [],
      historyTruncated: false,
      worktrees: [
        {
          id: "wt",
          repoId: "repo",
          name: "feature",
          path: "/worktrees/feature",
          head: null,
          shortHead: null,
          branch: null,
          detached: false,
          bare: false,
          locked: false,
          lockReason: null,
          prunable: false,
          prunableReason: null,
          isMain: false,
          exists: true,
        },
      ],
    };
    window.placeCalls = [];
    window.refusePlaceClose = false;
    window.nativePlaces = [
      {
        id: "folder-cli",
        cwd: "/projects/notes",
        rows: 24,
        cols: 80,
        meta: '{"branch":"notes","folder":true}',
      },
      { id: "repo-cli", cwd: "/projects/app", rows: 24, cols: 80, meta: '{"branch":"main"}' },
    ];
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
        window.placeCalls.push({ cmd, args });
        if (cmd === "plugin:event|listen") return ++serial;
        if (cmd === "pty_sessions") return structuredClone(window.nativePlaces);
        if (cmd === "pty_attach") return { text: "Retained terminal\r\n", upto: 0 };
        if (cmd === "pty_close") {
          if (window.refusePlaceClose) throw new Error("runtime unavailable");
          window.nativePlaces = window.nativePlaces.filter((session) => session.id !== args.id);
        }
        if (cmd === "workspace_statuses") return {};
        if (cmd === "scan_workspace")
          return { root: args.root, repositories: [repo], warnings: [] };
        if (cmd === "list_repositories")
          return {
            root: args.root,
            repositories: [{ name: "app", path: "/projects/app" }],
            truncated: false,
            warnings: [],
          };
        if (cmd === "read_directory")
          return {
            path: args.path,
            name: args.path.split("/").at(-1),
            parent: "/projects",
            distro: null,
            entries: [],
            truncated: false,
          };
        if (cmd === "app_settings_read")
          return {
            path: "/tmp/totex-place-settings.json",
            text: JSON.stringify({ ...args.initial, language: "en" }),
            value: { ...args.initial, language: "en" },
          };
        if (
          [
            "pty_asking",
            "pty_doing",
            "pty_typed",
            "mcp_reports",
            "list_roots",
            "describe_folders",
            "update_standing",
            "git_readings",
            "status_worktrees",
          ].includes(cmd)
        )
          return [];
        return null;
      },
    };
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
  });
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto(`${base}/tests/fixtures/place-lifecycle.html`);
  const canvasFolder = page.locator(".react-flow__node-folder");
  const canvasRepo = page.locator(".react-flow__node-repository");
  const sidebar = page.locator("#folder-sidebar");
  const folderLabel = "Remove folder and end its terminals";
  const repoLabel = "Remove repository and end its terminals";
  const removeRepo = canvasRepo.locator(`[aria-label="${repoLabel}"]`);
  const removeFolder = canvasFolder.locator(`[aria-label="${folderLabel}"]`);
  await removeRepo.waitFor({ state: "attached" });
  await removeFolder.waitFor({ state: "attached" });
  const terminal = page.locator('[data-terminal="repo-cli"]');
  await terminal.locator(".xterm-screen").waitFor();
  // Move the fixture's top-edge folder heading below the window drag region.
  await page.mouse.move(1300, 600);
  await page.mouse.down();
  await page.mouse.move(1300, 800, { steps: 10 });
  await page.mouse.up();

  // Controls must appear on hover, including the sidebar's folder header.
  async function assertControlShown(control, shown) {
    const handle = await control.elementHandle();
    await page.waitForFunction(
      ({ button, shown }) => {
        let visible = button.getBoundingClientRect().width > 0;
        for (let element = button; element; element = element.parentElement) {
          const style = getComputedStyle(element);
          if (style.opacity === "0" || style.visibility === "hidden" || style.display === "none")
            visible = false;
        }
        return visible === shown;
      },
      { button: handle, shown },
    );
    await handle.dispose();
  }
  await page.mouse.move(1590, 990);
  await assertControlShown(removeRepo, false);
  await assertControlShown(removeFolder, false);
  const sidebarFolderClose = sidebar.locator(`[aria-label="${folderLabel}"]`).first();
  await assertControlShown(sidebarFolderClose, false);
  await sidebarFolderClose.locator("../..").hover();
  await assertControlShown(sidebarFolderClose, true);
  await canvasRepo.locator(".band__name").hover();
  await assertControlShown(removeRepo, true);
  await canvasFolder.locator(".folder__heading").hover();
  await assertControlShown(removeFolder, true);
  await assertControlShown(removeRepo, false);
  await assertControlShown(sidebarFolderClose, false);
  await page.mouse.move(1590, 990);
  await assertControlShown(removeFolder, false);
  assert.equal(
    await page.getByRole("button", { name: /^Minimize (folder|repository)$/ }).count(),
    0,
  );
  assert.equal(await page.getByRole("region", { name: "Minimized", exact: true }).count(), 0);
  assert.equal(
    await page.evaluate(() => window.placeCalls.filter(({ cmd }) => cmd === "pty_close").length),
    0,
  );

  await page.evaluate(() => {
    window.nativePlaces.push({
      id: "invisible-worktree",
      cwd: "/worktrees/feature",
      rows: 24,
      cols: 80,
      meta: '{"branch":"feature"}',
    });
    window.refusePlaceClose = true;
  });
  await canvasRepo.locator(".band__name").hover();
  await removeRepo.click();
  await page.getByText("Could not end all terminals. Try removing again.").first().waitFor();
  assert.equal(await canvasRepo.count(), 1);
  assert.equal(await terminal.isVisible(), true);
  assert.equal(
    await page.evaluate(() => window.nativePlaces.some(({ id }) => id === "repo-cli")),
    true,
  );
  assert.equal(
    await page.evaluate(async () =>
      (await window.placeSnapshot()).values["sessions.list"].some(({ id }) => id === "repo-cli"),
    ),
    true,
  );
  await page.evaluate(() => {
    window.refusePlaceClose = false;
  });
  await removeRepo.click();
  await page.waitForFunction(() => window.nativePlaces.length === 1);
  const closed = await page.evaluate(() =>
    window.placeCalls.filter(({ cmd }) => cmd === "pty_close").map(({ args }) => args.id),
  );
  assert.equal(closed.includes("repo-cli"), true);
  assert.equal(closed.includes("invisible-worktree"), true);
  assert.equal(closed.includes("folder-cli"), false);
  await page.waitForFunction(
    async () =>
      !(await window.placeSnapshot()).values["sessions.list"].some(({ id }) => id === "repo-cli"),
  );
  await page.waitForFunction(() => !document.querySelector(".react-flow__node-repository"));
  assert.equal(await terminal.count(), 0);
  // Closing through the folder pane must also dispose its graph and PTY.
  await sidebarFolderClose.locator("../..").hover();
  await sidebarFolderClose.click();
  await page.waitForFunction(() => window.nativePlaces.length === 0);
  await page.waitForFunction(
    async () => (await window.placeSnapshot()).values["sessions.list"].length === 0,
  );
  await page.waitForFunction(() => !document.querySelector(".react-flow__node-folder"));
  assert.equal(await page.getByRole("region", { name: "Minimized", exact: true }).count(), 0);
  assert.equal(
    await page.evaluate(() =>
      window.placeCalls.some(({ cmd }) => cmd === "fs_delete_folder" || cmd === "fs_delete_file"),
    ),
    false,
  );
  assert.deepEqual(errors, []);
  return {
    hoverOnlyClose: true,
    frontendAndNativeTerminalsEnded: true,
    noMinimizedTray: true,
    invisibleWorktreeEnded: true,
    failedCloseRetryable: true,
    errors,
  };
}
