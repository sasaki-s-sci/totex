import assert from "node:assert/strict";

/** Real Window and xterm; only native IPC is mocked. */
async function openPlaces(page, base, query = "") {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    if (window.top !== window) return;
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
        if (cmd === "pty_open") {
          window.nativePlaces.push({ ...args });
          return null;
        }
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
        if (cmd === "resolve_folder")
          return { path: args.path, label: args.path.split("/").at(-1), display: args.path };
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
            "canvas_read",
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
  await page.waitForFunction(
    async () =>
      window.placeSnapshot &&
      (await window.placeSnapshot()).values["workspace.open"]?.["/projects/app"]?.repositories
        .length === 1,
  );
  return errors;
}

async function showPlaceTerminal(page, number, id) {
  const input = page.locator('[data-terminal-shown="true"] .xterm-helper-textarea');
  await input.waitFor({ state: "attached" });
  await input.focus();
  await page.keyboard.press(`Control+${number}`);
  await page.locator(`#cli-sidebar [data-terminal="${id}"][data-terminal-shown="true"]`).waitFor();
}

async function holdFolderOffers(page) {
  const input = page.locator('[data-terminal-shown="true"] .xterm-helper-textarea');
  if (await input.count()) await input.focus();
  await page.keyboard.down("Control");
  await page.keyboard.down("Shift");
  await page.evaluate(() => new Promise(requestAnimationFrame));
}

async function releaseFolderOffers(page) {
  await page.keyboard.up("Shift");
  await page.keyboard.up("Control");
  await page
    .locator('#cli-sidebar .session-offer[data-offered="true"]')
    .waitFor({ state: "detached" });
}

async function assertFolderOffer(page, path, name) {
  const offer = page.locator(
    `#cli-sidebar .page__header .page__terminal-list .session-offer[title="${path}"]`,
  );
  await offer.waitFor();
  assert.equal(await offer.count(), 1, "Empty folders appear once in the compact header");
  assert.equal(await offer.innerText(), name, "The visible header uses the folder name alone");
  assert.equal(await page.locator("#cli-sidebar .session-offers").count(), 0);
  return offer;
}

async function verifyAddedRepository(page) {
  const sidebar = page.locator("#folder-sidebar");
  await sidebar.getByRole("button", { name: "Add a folder or repositories", exact: true }).click();
  await page.locator('[aria-label="Open as"] [value="repository"]').click();
  const path = page.locator('input[aria-label^="Path, e.g."]');
  await path.fill("/projects/app");
  await path.press("Enter");
  await page.getByRole("menu").waitFor({ state: "detached" });
  await sidebar.getByRole("button", { name: "Show in terminal list", exact: true }).click();
  await assertFolderOffer(page, "/projects/app", "app");
  await assertFolderOffer(page, "/worktrees/feature", "feature");
  await page.locator("#cli-sidebar .session-empty-header .page__header").waitFor();
  assert.equal(await page.evaluate(() => window.nativePlaces.length), 0);

  await holdFolderOffers(page);
  await page
    .locator('#cli-sidebar .session-offer[title="/projects/app"][data-offered="true"]')
    .waitFor();
  await releaseFolderOffers(page);
  await assertFolderOffer(page, "/projects/app", "app");
  await holdFolderOffers(page);
  await page.keyboard.press("ArrowRight");
  await page
    .locator('#cli-sidebar .session-offer[title="/worktrees/feature"][data-offered="true"]')
    .waitFor();
  await page.keyboard.press("ArrowLeft");
  await page
    .locator('#cli-sidebar .session-offer[title="/projects/app"][data-offered="true"]')
    .waitFor();
  await page.keyboard.press("Enter");
  await releaseFolderOffers(page);
  await page.waitForFunction(() => window.nativePlaces.length === 1);
  const session = await page.evaluate(() => window.nativePlaces[0]);
  assert.equal(
    session.cwd,
    "/projects/app",
    "Ctrl+Shift+Enter starts the selected persistent folder",
  );
  const terminal = page.locator(`#cli-sidebar [data-terminal="${session.id}"]`);
  await terminal.locator(".xterm-helper-textarea").waitFor({ state: "attached" });
  assert.equal(await page.locator('#cli-sidebar .session-offer[title="/projects/app"]').count(), 0);
  const group = page.locator(
    '#cli-sidebar .session-terminal:not([hidden]) .page__header .page__terminal-group[title="/projects/app"]',
  );
  assert.equal(await group.locator(".page__terminal-name").innerText(), "app");
  assert.equal(
    await group.locator('.page__terminal-numbers [data-active="true"]').innerText(),
    "1",
  );
  assert.equal(
    await page.evaluate(() => window.placeCalls.filter(({ cmd }) => cmd === "pty_open").length),
    1,
  );

  await terminal.locator(".xterm-helper-textarea").press("Control+x");
  await terminal.waitFor({ state: "detached" });
  const returned = await assertFolderOffer(page, "/projects/app", "app");
  await page.locator("#cli-sidebar .session-empty-header .page__header").waitFor();
  assert.equal(await page.evaluate(() => window.nativePlaces.length), 0);

  await returned.click();
  await page.waitForFunction(() => window.nativePlaces.length === 1);
  const clicked = await page.evaluate(() => window.nativePlaces[0]);
  assert.equal(clicked.cwd, "/projects/app", "The empty global header also accepts pointer input");
  const clickedTerminal = page.locator(`#cli-sidebar [data-terminal="${clicked.id}"]`);
  await clickedTerminal.locator(".xterm-helper-textarea").press("Control+x");
  await clickedTerminal.waitFor({ state: "detached" });
  await assertFolderOffer(page, "/projects/app", "app");
  await page.locator("#cli-sidebar .session-empty-header .page__header").waitFor();
  assert.equal(await page.evaluate(() => window.nativePlaces.length), 0);
}

export async function verifyPlaces(page, base = "http://127.0.0.1:18422") {
  const errors = await openPlaces(page, base);
  const sidebar = page.locator("#folder-sidebar");
  const folder = sidebar.locator('[data-folder-pane="1"]');
  const worktree = page.locator('#cli-sidebar .session-offer[title="/worktrees/feature"]');
  async function removePane(header, name) {
    await header.click({ button: "right" });
    await page.getByRole("menuitem", { name, exact: true }).click();
  }
  await folder.waitFor();
  await showPlaceTerminal(page, 2, "repo-cli");
  await assertFolderOffer(page, "/worktrees/feature", "feature");
  await holdFolderOffers(page);
  await worktree.waitFor();
  await releaseFolderOffers(page);
  await assertFolderOffer(page, "/worktrees/feature", "feature");
  const terminal = page.locator('#cli-sidebar [data-terminal="repo-cli"]');
  await terminal.locator(".xterm-screen").waitFor();
  const repositoryRow = sidebar.locator('[data-repo-row="2:/projects/app"]');
  assert.ok(
    !(await repositoryRow.innerText()).includes("refs/heads/"),
    "The explorer shows the local branch name returned as a full ref by Git",
  );
  assert.equal(await page.locator("main .xterm, main .card-board").count(), 0);

  assert.equal(
    await sidebar.getByRole("button", { name: /^Remove (folder|repository) and end/ }).count(),
    0,
    "Closing a pane belongs in its context menu",
  );
  assert.equal(await sidebar.getByRole("button", { name: /^Agents report from / }).count(), 0);
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
  await removePane(repositoryRow, "Remove repository and end its terminals");
  await page.getByText("Could not end all terminals. Try removing again.").first().waitFor();
  await assertFolderOffer(page, "/worktrees/feature", "feature");
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
  await removePane(repositoryRow, "Remove repository and end its terminals");
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
  await repositoryRow.waitFor({ state: "detached" });
  await terminal.waitFor({ state: "detached" });
  assert.equal(await page.locator('[data-session-canvas="repo-cli"]').count(), 0);
  assert.equal(await worktree.count(), 0, "Removing the repository removes its empty-folder offer");

  await removePane(
    folder.getByRole("button", { name: "notes", exact: true }).last(),
    "Remove folder and end its terminals",
  );
  await page.waitForFunction(() => window.nativePlaces.length === 0);
  await page.waitForFunction(
    async () => (await window.placeSnapshot()).values["sessions.list"].length === 0,
  );
  await folder.waitFor({ state: "detached" });
  const empty = page.locator(".terminal-canvases .canvas-empty");
  await empty.waitFor();
  assert.equal(
    (await empty.innerText()).trim(),
    "Ctrl+Shift + arrows to choose a folder · Enter to start",
  );
  assert.equal(await page.locator(".terminal-canvases button, .terminal-canvases form").count(), 0);
  await verifyAddedRepository(page);
  assert.equal(
    await page.evaluate(() =>
      window.placeCalls.some(({ cmd }) => cmd === "fs_delete_folder" || cmd === "fs_delete_file"),
    ),
    false,
  );
  assert.deepEqual(errors, []);
  return {
    sidebarContextClose: true,
    frontendAndNativeTerminalsEnded: true,
    invisibleWorktreeEnded: true,
    failedCloseRetryable: true,
    addedRepositoryRetainedInHeader: true,
    errors,
  };
}

// Kept for existing browser runners; folder removal now lives only in the explorer.
export { verifyPlaces as verifyCardPlaces };

export async function verifyWorkspaceIsolation(page, base = "http://127.0.0.1:18422") {
  const errors = await openPlaces(page, base, "?workspaces");
  await showPlaceTerminal(page, 2, "repo-cli");
  const main = page.locator('#cli-sidebar [data-terminal="repo-cli"]');
  const sibling = page.locator('#cli-sidebar [data-terminal="feature-cli"]');
  await main.locator(".xterm-screen").waitFor();
  await page.evaluate(() => {
    window.refusePlaceClose = true;
  });
  await main.locator(".xterm-helper-textarea").press("Control+x");
  await page
    .getByText("Could not end the terminal. It is still open; try again.")
    .first()
    .waitFor();
  assert.equal(await main.count(), 1);
  assert.equal(await page.locator('[data-session-canvas="repo-cli"]').count(), 1);
  await page.evaluate(() => {
    window.refusePlaceClose = false;
  });
  await main.locator(".xterm-helper-textarea").press("Control+x");
  await main.waitFor({ state: "detached" });
  assert.equal(await sibling.count(), 1);
  assert.equal(
    await page.evaluate(() => window.nativePlaces.some((session) => session.id === "feature-cli")),
    true,
  );
  assert.equal(
    await page.evaluate(() => window.nativePlaces.some((session) => session.id === "repo-cli")),
    false,
  );
  await page.locator('[data-session-canvas="repo-cli"]').waitFor({ state: "detached" });
  assert.equal(await page.locator('[data-session-canvas="feature-cli"]').count(), 1);
  await assertFolderOffer(page, "/projects/app", "app");
  await holdFolderOffers(page);
  assert.equal(
    await page.locator('#cli-sidebar .session-offer[title="/projects/app"]').count(),
    1,
    "Ending a terminal leaves its folder available for a new terminal",
  );
  await releaseFolderOffers(page);
  await assertFolderOffer(page, "/projects/app", "app");
  assert.equal(
    await page.evaluate(() =>
      window.placeCalls.some(({ cmd }) => cmd === "fs_delete_folder" || cmd === "fs_delete_file"),
    ),
    false,
  );
  assert.deepEqual(errors, []);
  return "terminal close is isolated from nested worktrees; failed close remains retryable";
}
