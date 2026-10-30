import assert from "node:assert/strict";

/** Real explorer, menu and inline naming field; only filesystem IPC is replaced. */
export async function verifyFiles(page, base = "http://127.0.0.1:18422") {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem("totex.language", "en");
    const entries = new Map([
      ["/files/folder.dir", true],
      ["/files/folder.dir/child.txt", false],
      ["/files/other", true],
      ["/files/alpha.txt", false],
      ["/files/beta.txt", false],
      ["/files/gamma.txt", false],
    ]);
    const parent = (path) => path.slice(0, path.lastIndexOf("/")) || "/";
    const name = (path) => path.slice(path.lastIndexOf("/") + 1);
    const listeners = new Map();
    const callbacks = new Map();
    let serial = 0;
    window.fsCalls = [];
    window.fsRefused = null;
    const changed = (path) => {
      for (const { event, handler } of listeners.values()) {
        if (event === "fs:changed") callbacks.get(handler)?.({ event, payload: [path] });
      }
    };
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
        window.fsCalls.push({ cmd, args });
        if (cmd === "plugin:event|listen") {
          listeners.set(++serial, args);
          return serial;
        }
        if (cmd === "plugin:event|unlisten") return listeners.delete(args.eventId);
        if (cmd === "app_settings_read")
          return {
            path: "/settings.json",
            text: JSON.stringify(args.initial),
            value: args.initial,
          };
        if (cmd === "read_directory")
          return {
            path: args.path,
            name: name(args.path),
            parent: parent(args.path),
            distro: null,
            truncated: false,
            entries: [...entries]
              .filter(([path]) => parent(path) === args.path)
              .map(([path, isDir]) => ({
                path,
                name: name(path),
                isDir,
                isSymlink: false,
                isHidden: false,
                size: isDir ? null : 1,
                modifiedMs: 0,
              }))
              .sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name)),
          };
        if (cmd === "describe_folders")
          return args.paths.map((path) => ({ path, label: name(path), display: path }));
        if (cmd === "directory_changes") return {};
        if (["list_roots", "folders_holding_repositories", "terminal_usage"].includes(cmd))
          return [];
        if (cmd === "fs_rename_file") {
          const next = `${parent(args.path)}/${args.name}`;
          if (entries.has(next)) throw new Error("already-exists");
          for (const [path, isDir] of [...entries]) {
            if (path === args.path || path.startsWith(`${args.path}/`)) {
              entries.delete(path);
              entries.set(next + path.slice(args.path.length), isDir);
            }
          }
          changed(parent(args.path));
          return next;
        }
        if (cmd === "fs_delete_file" || cmd === "fs_delete_folder") {
          if (window.fsRefused === args.path) throw new Error("permission-denied");
          if (!entries.has(args.path)) throw new Error("no-such-file");
          for (const path of entries.keys()) {
            if (path === args.path || path.startsWith(`${args.path}/`)) entries.delete(path);
          }
          changed(parent(args.path));
        }
        if (cmd === "fs_copy_into") return args.paths.map((path) => `${args.into}/${name(path)}`);
        return null;
      },
    };
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
  });
  const row = (path) => page.locator(`[data-pick-row="/files/${path}"]`);
  const selected = () =>
    page
      .locator('[data-pick-row][aria-pressed="true"]')
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-pick-row")));
  const reset = async () => {
    await page.goto(`${base}/tests/fixtures/files.html`);
    await row("alpha.txt").waitFor();
  };
  const menu = async (path, label) => {
    await row(path).click({ button: "right" });
    await page.getByRole("menuitem", { name: label, exact: true }).click();
  };
  const confirmDelete = () =>
    page.getByRole("dialog").getByRole("button", { name: "Delete", exact: true }).click();
  const deleted = () =>
    page.evaluate(() =>
      window.fsCalls.filter(({ cmd }) => cmd === "fs_delete_file" || cmd === "fs_delete_folder"),
    );

  await reset();
  await row("alpha.txt").focus();
  await row("alpha.txt").click({ button: "right" });
  await page.keyboard.press("Escape");
  assert.ok(
    await row("alpha.txt").evaluate((node) => node === document.activeElement),
    "Cancelling the menu restores keyboard focus to the row",
  );
  await menu("alpha.txt", "Rename");
  const nameInput = page.getByPlaceholder("alpha.txt", { exact: true });
  await nameInput.waitFor();
  assert.deepEqual(
    await nameInput.evaluate((node) => [
      node === document.activeElement,
      node.selectionStart,
      node.selectionEnd,
    ]),
    [true, 0, 5],
    "Menu close preserves rename focus and selects the file stem",
  );
  await nameInput.fill("renamed.txt");
  await nameInput.press("Enter");
  await row("renamed.txt").waitFor();
  assert.equal(await row("alpha.txt").count(), 0);
  assert.equal(
    await page.evaluate(() => window.fsCalls.filter(({ cmd }) => cmd === "fs_rename_file").length),
    1,
  );
  await menu("folder.dir", "Rename");
  const folderInput = page.getByPlaceholder("folder.dir", { exact: true });
  assert.equal(await folderInput.evaluate((node) => node.selectionEnd), "folder.dir".length);
  await folderInput.fill("renamed.folder");
  await folderInput.press("Enter");
  await row("renamed.folder").waitFor();
  await menu("beta.txt", "Rename");
  await page.getByPlaceholder("beta.txt", { exact: true }).fill("cancelled.txt");
  await page.keyboard.press("Escape");
  await row("beta.txt").waitFor();
  assert.equal(
    await page.evaluate(() => window.fsCalls.filter(({ cmd }) => cmd === "fs_rename_file").length),
    2,
  );

  await reset();
  await row("alpha.txt").click();
  await row("gamma.txt").click({ modifiers: ["Shift"] });
  assert.deepEqual(await selected(), ["/files/alpha.txt", "/files/beta.txt", "/files/gamma.txt"]);
  await row("beta.txt").click({ modifiers: ["Control"] });
  assert.deepEqual(await selected(), ["/files/alpha.txt", "/files/gamma.txt"]);
  await menu("alpha.txt", "Copy 2 items");
  await menu("other", "Paste 2 items");
  assert.deepEqual(
    await page.evaluate(() => window.fsCalls.find(({ cmd }) => cmd === "fs_copy_into").args),
    { paths: ["/files/alpha.txt", "/files/gamma.txt"], into: "/files/other" },
  );
  await row("alpha.txt").click();
  await row("folder.dir").click({ modifiers: ["Control"] });
  await row("alpha.txt").dragTo(row("other"));
  assert.deepEqual(
    await page.evaluate(
      () => window.fsCalls.filter(({ cmd }) => cmd === "fs_copy_into").at(-1).args,
    ),
    { paths: ["/files/alpha.txt", "/files/folder.dir"], into: "/files/other" },
    "Dragging a selected row copies the selected files and folders together",
  );
  await row("alpha.txt").click();
  await row("beta.txt").click({ modifiers: ["Control"] });
  await menu("alpha.txt", "Delete 2 items");
  assert.match(await page.getByRole("dialog").innerText(), /alpha\.txt[\s\S]*beta\.txt/);
  await confirmDelete();
  await row("alpha.txt").waitFor({ state: "detached" });
  await row("beta.txt").waitFor({ state: "detached" });
  assert.deepEqual(
    (await deleted()).map(({ args }) => args.path),
    ["/files/alpha.txt", "/files/beta.txt"],
  );

  await reset();
  await row("folder.dir").click();
  await row("folder.dir/child.txt").waitFor();
  await row("folder.dir/child.txt").click({ modifiers: ["Control"] });
  await menu("folder.dir/child.txt", "Delete");
  assert.equal(
    await page.getByRole("dialog").getByText("Delete folder.dir?", { exact: true }).count(),
    1,
  );
  assert.equal(
    await page
      .getByRole("dialog")
      .getByText("This folder and everything in it will be permanently deleted.", { exact: true })
      .count(),
    1,
    "Confirmation names the selected parent tree even when its child was right-clicked",
  );
  await page.getByRole("dialog").getByRole("button", { name: "Cancel", exact: true }).click();
  await row("alpha.txt").click({ modifiers: ["Control"] });
  await menu("folder.dir", "Delete 2 items");
  await confirmDelete();
  await row("folder.dir").waitFor({ state: "detached" });
  assert.deepEqual(
    (await deleted()).map(({ cmd, args }) => [cmd, args.path]),
    [
      ["fs_delete_folder", "/files/folder.dir"],
      ["fs_delete_file", "/files/alpha.txt"],
    ],
    "Deleting a selected parent does not separately delete its selected child",
  );

  await reset();
  await row("alpha.txt").click();
  await row("beta.txt").click({ modifiers: ["Control"] });
  await page.evaluate(() => {
    window.fsRefused = "/files/beta.txt";
  });
  await page.keyboard.press("Delete");
  await confirmDelete();
  await row("alpha.txt").waitFor({ state: "detached" });
  await page.getByRole("dialog").getByText("Delete beta.txt?", { exact: true }).waitFor();
  await page.evaluate(() => {
    window.fsRefused = null;
  });
  await confirmDelete();
  await row("beta.txt").waitFor({ state: "detached" });
  assert.deepEqual(
    (await deleted()).map(({ args }) => args.path),
    ["/files/alpha.txt", "/files/beta.txt", "/files/beta.txt"],
  );

  await reset();
  await row("alpha.txt").click();
  await page.keyboard.press("Control+a");
  assert.equal((await selected()).length, 5);
  await page.keyboard.press("Escape");
  assert.deepEqual(await selected(), []);

  await row("alpha.txt").click();
  await row("gamma.txt").click({ modifiers: ["Meta"] });
  assert.deepEqual(await selected(), ["/files/alpha.txt", "/files/gamma.txt"]);
  await row("beta.txt").click({ modifiers: ["Control", "Shift"] });
  assert.deepEqual(await selected(), ["/files/alpha.txt", "/files/beta.txt", "/files/gamma.txt"]);

  await row("folder.dir").click();
  await row("folder.dir/child.txt").waitFor();
  await row("folder.dir/child.txt").click({ modifiers: ["Control"] });
  await row("folder.dir").click();
  await row("folder.dir/child.txt").waitFor({ state: "detached" });
  assert.deepEqual(await selected(), ["/files/folder.dir"]);

  await row("alpha.txt").click();
  await row("beta.txt").click({ modifiers: ["Control"] });
  await page.evaluate(() =>
    window.__TAURI_INTERNALS__.invoke("fs_delete_file", { path: "/files/alpha.txt" }),
  );
  await row("alpha.txt").waitFor({ state: "detached" });
  assert.deepEqual(await selected(), ["/files/beta.txt"], "Removed rows leave no stale selection");
  await row("folder.dir").getByRole("button", { name: "Go to", exact: true }).click();
  await row("folder.dir/child.txt").waitFor();
  assert.deepEqual(await selected(), [], "Navigating resets the pane selection");
  assert.deepEqual(errors, []);
  return "file/folder rename, range/toggle selection, batch paste/delete, nested deletion, retry and keyboard selection";
}
