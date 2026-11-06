import assert from "node:assert/strict";

/** Real Window and xterm; only native IPC is mocked. */
async function openPlaces(page, base, query = "") {
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
          id: "main",
          repoId: "repo",
          name: "main",
          path: "/projects/app",
          head: null,
          shortHead: null,
          branch: "refs/heads/main",
          detached: false,
          bare: false,
          locked: false,
          lockReason: null,
          prunable: false,
          prunableReason: null,
          isMain: true,
          exists: true,
        },
        {
          id: "wt",
          repoId: "repo",
          name: "feature",
          path: location.search.includes("workspaces")
            ? "/projects/app/.worktrees/feature"
            : "/worktrees/feature",
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
    if (location.search.includes("workspaces"))
      window.nativePlaces.push({
        id: "feature-cli",
        cwd: "/projects/app/.worktrees/feature",
        rows: 24,
        cols: 80,
        meta: '{"branch":"feature"}',
      });
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
            "pty_doing",
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
  await page.goto(`${base}/tests/fixtures/place-lifecycle.html${query}`);
  return errors;
}

export async function verifyPlaces(page, base = "http://127.0.0.1:18422") {
  const errors = await openPlaces(page, base);
  const folderCard = page.locator('[data-card-folder="/projects/notes"]');
  const repositoryCard = page.locator('[data-card-folder="/worktrees/feature"]');
  const sidebar = page.locator("#folder-sidebar");
  const folderLabel = "Remove folder and end its terminals";
  const repoLabel = "Remove repository and end its terminals";
  const removeRepo = repositoryCard.getByRole("button", {
    name: "Close workspace and end its terminals",
    exact: true,
  });
  const removeFolder = folderCard.locator(`[aria-label="${folderLabel}"]`);
  await removeRepo.waitFor({ state: "attached" });
  await removeFolder.waitFor({ state: "attached" });
  const terminal = page.locator('[data-terminal="repo-cli"]');
  await terminal.locator(".xterm-screen").waitFor();
  assert.ok(
    !(
      await page.locator('[data-card-folder="/projects/app"] > .page__header').innerText()
    ).includes("refs/heads/"),
    "Cards show the local branch name returned as a full ref by Git",
  );
  // The sidebar exposes its close control on hover; card controls stay visible.
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
  await assertControlShown(removeRepo, true);
  await assertControlShown(removeFolder, true);
  const sidebarFolderClose = sidebar.locator(`[aria-label="${folderLabel}"]`).first();
  await assertControlShown(sidebarFolderClose, false);
  await sidebarFolderClose.locator("../..").hover();
  await assertControlShown(sidebarFolderClose, true);
  await page.mouse.move(1590, 990);
  await assertControlShown(sidebarFolderClose, false);
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
  await sidebar.getByRole("button", { name: repoLabel, exact: true }).locator("../..").hover();
  await sidebar.getByRole("button", { name: repoLabel, exact: true }).click();
  await page.getByText("Could not end all terminals. Try removing again.").first().waitFor();
  assert.equal(await repositoryCard.count(), 1);
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
  await sidebar.getByRole("button", { name: repoLabel, exact: true }).locator("../..").hover();
  await sidebar.getByRole("button", { name: repoLabel, exact: true }).click();
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
  await repositoryCard.waitFor({ state: "detached" });
  assert.equal(await terminal.count(), 0);
  // Closing through the folder pane must also remove its card and PTY.
  await sidebarFolderClose.locator("../..").hover();
  await sidebarFolderClose.click();
  await page.waitForFunction(() => window.nativePlaces.length === 0);
  await page.waitForFunction(
    async () => (await window.placeSnapshot()).values["sessions.list"].length === 0,
  );
  await folderCard.waitFor({ state: "detached" });
  assert.equal(await page.getByRole("region", { name: "Minimized", exact: true }).count(), 0);
  assert.equal(
    await page.evaluate(() =>
      window.placeCalls.some(({ cmd }) => cmd === "fs_delete_folder" || cmd === "fs_delete_file"),
    ),
    false,
  );
  assert.deepEqual(errors, []);
  return {
    sidebarHoverClose: true,
    frontendAndNativeTerminalsEnded: true,
    noMinimizedTray: true,
    invisibleWorktreeEnded: true,
    failedCloseRetryable: true,
    errors,
  };
}

/** Card removal uses the same native-session cleanup and sidebar workspace state. */
export async function verifyCardPlaces(page, base = "http://127.0.0.1:18422") {
  const errors = await openPlaces(page, base);
  const card = page.locator('[data-card-folder="/projects/notes"]');
  const remove = card.getByRole("button", {
    name: "Remove folder and end its terminals",
    exact: true,
  });
  await remove.waitFor();
  await page.evaluate(() => {
    window.refusePlaceClose = true;
  });
  await remove.click();
  await page.getByText("Could not end all terminals. Try removing again.").first().waitFor();
  assert.equal(await card.count(), 1);
  await page.evaluate(() => {
    window.refusePlaceClose = false;
  });
  await remove.click();
  await card.waitFor({ state: "detached" });
  const panes = await page.evaluate(
    async () => (await window.placeSnapshot()).values["folders.panes"],
  );
  assert.deepEqual(panes.find((p) => p.id === 1).graphed, []);
  assert.equal(
    await page.evaluate(() => window.nativePlaces.some((s) => s.id === "folder-cli")),
    false,
  );
  assert.equal(
    await page.evaluate(() => window.nativePlaces.some((s) => s.id === "repo-cli")),
    true,
  );

  await page.evaluate(() =>
    window.nativePlaces.push({
      id: "invisible-worktree",
      cwd: "/worktrees/feature",
      rows: 24,
      cols: 80,
      meta: '{"branch":"feature"}',
    }),
  );
  await page
    .locator('[data-card-folder="/worktrees/feature"]')
    .getByRole("button", { name: "Close workspace and end its terminals", exact: true })
    .first()
    .click();
  await page.waitForFunction(() => window.nativePlaces.length === 1);
  assert.equal(
    await page.evaluate(() => window.nativePlaces[0].id),
    "repo-cli",
    "Closing the feature workspace keeps the main workspace terminal",
  );
  await page.waitForFunction(
    () => !document.querySelector('[data-card-folder="/worktrees/feature"]'),
  );
  assert.equal(
    await page.evaluate(() =>
      window.placeCalls.some((c) => c.cmd === "fs_delete_folder" || c.cmd === "fs_delete_file"),
    ),
    false,
  );
  assert.deepEqual(errors, []);

  await page.reload();
  await card.waitFor();
  const sidebarClose = page.locator("#folder-sidebar").getByRole("button", {
    name: "Remove folder and end its terminals",
    exact: true,
  });
  await sidebarClose.locator("../..").hover();
  await sidebarClose.click();
  await card.waitFor({ state: "detached" });
  assert.equal(
    await page.evaluate(() => window.nativePlaces.some((s) => s.id === "folder-cli")),
    false,
  );
  return "card and sidebar lifecycle, failed removal retry, repository worktree cleanup";
}

export async function verifyWorkspaceIsolation(page, base = "http://127.0.0.1:18422") {
  const errors = await openPlaces(page, base, "?workspaces");
  const main = page.locator('[data-card-folder="/projects/app"]');
  const sibling = page.locator('[data-card-folder="/projects/app/.worktrees/feature"]');
  await sibling.locator('[data-terminal="feature-cli"] .xterm-screen').waitFor();
  await page.evaluate(() => {
    window.refusePlaceClose = true;
  });
  await main
    .getByRole("button", { name: "Close workspace and end its terminals", exact: true })
    .click();
  await page.getByText("Could not end all terminals. Try removing again.").first().waitFor();
  assert.equal(await main.count(), 1);
  await page.evaluate(() => {
    window.refusePlaceClose = false;
  });
  await main
    .getByRole("button", { name: "Close workspace and end its terminals", exact: true })
    .click();
  await main.waitFor({ state: "detached" });
  assert.equal(await sibling.locator('[data-terminal="feature-cli"]').count(), 1);
  assert.equal(
    await page.evaluate(() => window.nativePlaces.some((session) => session.id === "feature-cli")),
    true,
  );
  assert.equal(
    await page.evaluate(() => window.nativePlaces.some((session) => session.id === "repo-cli")),
    false,
  );
  assert.deepEqual(errors, []);
  return "workspace close is isolated, including nested worktrees and failed-close retry";
}
