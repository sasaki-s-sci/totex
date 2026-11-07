import assert from "node:assert/strict";
import { verifyFileDragging } from "./fileDrag.browser.mjs";
import { verifyFolderColours } from "./folderColours.browser.mjs";

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
    if (location.search.includes("git")) entries.set("/files/.git", true);
    if (location.search.includes("many"))
      for (let number = 0; number < 100; number++)
        entries.set(`/files/z-extra-${String(number).padStart(3, "0")}.txt`, false);
    const parent = (path) => path.slice(0, path.lastIndexOf("/")) || "/";
    const name = (path) => path.slice(path.lastIndexOf("/") + 1);
    const listeners = new Map();
    const callbacks = new Map();
    window.fsEmit = (event, payload) => {
      for (const listener of listeners.values()) {
        if (listener.event === event) callbacks.get(listener.handler)?.({ event, payload });
      }
    };
    let serial = 0;
    window.fsCalls = [];
    window.fsChanges = {};
    window.fsRefused = null;
    window.fsDelay = 0;
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
        if (cmd === "plugin:window|scale_factor") return 2;
        if (["read_directory", "list_repositories", "space_standing"].includes(cmd))
          await new Promise((resolve) => setTimeout(resolve, window.fsDelay));
        if (cmd === "space_standing")
          return { space: args.path, told: true, settings: { mcp: true } };
        if (cmd === "read_file_head") return { text: "ref: refs/heads/feature/a-long-branch-name" };
        if (cmd === "pty_attach") return { text: "\x1b[?2004h", upto: 0 };
        if (cmd === "terminal_paths") return args.paths;
        if (cmd === "clipboard_files") return window.clipboardPaths ?? [];
        if (cmd === "plugin:clipboard-manager|read_text") throw new Error("image only");
        if (cmd === "plugin:clipboard-manager|read_image") return 42;
        if (cmd === "plugin:image|size") return { width: 1, height: 1 };
        if (cmd === "plugin:image|rgba") return [255, 0, 0, 255];
        if (cmd === "paste_media") {
          const path = "/files/other/pasted-123.png";
          entries.set(path, false);
          changed(parent(path));
          return path;
        }
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
        if (cmd === "list_repositories")
          return {
            root: args.root,
            repositories: [{ path: args.root, name: name(args.root) }],
            truncated: false,
            warnings: [],
          };
        if (cmd === "describe_folders")
          return args.paths.map((path) => ({ path, label: name(path), display: path }));
        if (cmd === "directory_changes")
          return Object.fromEntries(
            args.paths
              .filter((path) => window.fsChanges[path])
              .map((path) => [path, window.fsChanges[path]]),
          );
        if (["list_roots", "terminal_usage"].includes(cmd)) return [];
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
        if (cmd === "fs_move_into") {
          const moved = [];
          for (const source of args.paths) {
            const target = `${args.into}/${name(source)}`;
            for (const [path, isDir] of [...entries]) {
              if (path === source || path.startsWith(`${source}/`)) {
                entries.delete(path);
                entries.set(target + path.slice(source.length), isDir);
              }
            }
            changed(parent(source));
            changed(args.into);
            moved.push(target);
          }
          return moved;
        }
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

  await verifyFolderColours(page, base);
  await reset();
  await menu("alpha.txt", "Rename");
  const composingName = page.getByPlaceholder("alpha.txt", { exact: true });
  await composingName.fill("日本語.txt");
  for (const key of ["Enter", "Escape"]) {
    await composingName.dispatchEvent("keydown", { key, isComposing: true });
    assert.equal(await composingName.count(), 1, "IME keys must keep the naming field open");
  }
  await composingName.dispatchEvent("keydown", { key: "Enter", keyCode: 229 });
  assert.equal(
    await page.evaluate(() => window.fsCalls.filter(({ cmd }) => cmd === "fs_rename_file").length),
    0,
    "Committing an IME candidate must not rename the file",
  );
  await composingName.press("Enter");
  await row("日本語.txt").waitFor();

  await reset();
  await page.evaluate(() => {
    const invoke = window.__TAURI_INTERNALS__.invoke;
    window.__TAURI_INTERNALS__.invoke = (cmd, args) => {
      if (cmd === "space_tell")
        return new Promise((resolve) => {
          window.finishSpaceWrite = () =>
            resolve({ space: args.path, told: true, settings: args.settings });
        });
      if (cmd === "space_standing" && args.path === "/files/other")
        return new Promise((resolve) => {
          window.finishSpaceRead = () =>
            resolve({ space: args.path, told: true, settings: { mcp: true } });
        });
      return invoke(cmd, args);
    };
  });
  await page.getByRole("button", { name: "Agents report from files", exact: true }).click();
  await row("other").getByRole("button", { name: "Go to", exact: true }).click();
  await page.waitForFunction(() => Boolean(window.finishSpaceRead));
  const door = page.getByRole("button", { name: /^Agents report from / });
  assert.equal(await door.isDisabled(), true, "A new folder cannot use the old folder's setting");
  await page.evaluate(() => window.finishSpaceRead());
  await page.getByRole("button", { name: "Agents report from other", exact: true }).waitFor();
  await page.evaluate(() => window.finishSpaceWrite());
  await page.evaluate(() => new Promise(requestAnimationFrame));
  assert.equal(await door.getAttribute("aria-label"), "Agents report from other");
  assert.equal(await door.getAttribute("aria-pressed"), "true");

  await reset();
  await page.getByRole("button", { name: "Add a folder or repositories", exact: true }).click();
  const typedPath = page.getByRole("textbox", { name: /^Path, e.g./ });
  await typedPath.fill("/日本語");
  await typedPath.dispatchEvent("keydown", { key: "Enter", isComposing: true });
  await typedPath.dispatchEvent("keydown", { key: "Enter", keyCode: 229 });
  assert.equal(
    await page.evaluate(() => window.fsCalls.some(({ cmd }) => cmd === "resolve_folder")),
    false,
    "IME confirmation must not navigate to a half-written folder path",
  );
  const typedHost = page.getByPlaceholder("a@192.168.1.10", { exact: true });
  await typedHost.fill("日本語-host");
  await typedHost.dispatchEvent("keydown", { key: "Enter", isComposing: true });
  await typedHost.dispatchEvent("keydown", { key: "Enter", keyCode: 229 });
  assert.equal(
    await page.evaluate(() => window.fsCalls.some(({ cmd }) => cmd === "ssh_reach")),
    false,
    "IME confirmation must not connect to a half-written host",
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

  await menu("renamed.txt", "Rename");
  await page.getByPlaceholder("renamed.txt", { exact: true }).fill(" renamed.txt ");
  await page.keyboard.press("Enter");
  await row(" renamed.txt ").waitFor();
  assert.deepEqual(
    await page.evaluate(
      () => window.fsCalls.filter(({ cmd }) => cmd === "fs_rename_file").at(-1).args,
    ),
    { path: "/files/renamed.txt", name: " renamed.txt " },
  );
  await menu(" renamed.txt ", "Rename");
  await page.getByPlaceholder(" renamed.txt ", { exact: true }).press("Enter");
  await row(" renamed.txt ").waitFor();
  assert.equal(
    await page.evaluate(() => window.fsCalls.filter(({ cmd }) => cmd === "fs_rename_file").length),
    3,
    "Confirming an unchanged name preserves whitespace without renaming",
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
  await page.keyboard.down("Control");
  await row("alpha.txt").dragTo(row("other"));
  await page.keyboard.up("Control");
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
  await page.getByRole("button", { name: "Open in a new folder pane", exact: true }).click();
  const added = page.locator("[data-folder-pane]").last();
  await added.locator('[data-pick-row="/files/folder.dir/child.txt"]').waitFor();
  assert.equal(await page.locator("[data-folder-pane]").count(), 2);
  assert.equal(await added.locator("[data-repo-row]").count(), 0);
  await page.goto(`${base}/tests/fixtures/files.html?git&many`);
  const child = page.locator('[data-pick-row="/files/folder.dir"]');
  await child.waitFor();
  await child.click();
  await row("folder.dir/child.txt").waitFor();
  await page.locator("[data-pick-row]").last().scrollIntoViewIfNeeded();
  await row("z-extra-099.txt").waitFor();
  const left = await child.evaluate(
    (element) => element.querySelector("svg").getBoundingClientRect().left,
  );
  const geometry = await page.locator('[data-folder-pane="0"]').evaluate((pane) => ({
    height: pane.getBoundingClientRect().height,
    rows: [...pane.querySelectorAll("[data-pick-row]")].map(
      (row) => row.getBoundingClientRect().height,
    ),
    actions: [...pane.querySelector("section > div").querySelectorAll("button")]
      .slice(2)
      .map((button) => button.getBoundingClientRect().x),
  }));
  await page.evaluate(() => {
    window.fsDelay = 250;
  });
  for (const mode of ["git", "folder", "git", "folder"]) {
    await page.evaluate(() => {
      window.modeFrames = [];
      window.modeSampling = true;
      const sample = () => {
        window.modeFrames.push(
          document.querySelector('[data-folder-pane="0"]').getBoundingClientRect().height,
        );
        if (window.modeSampling) requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
    await page.getByRole("button", { name: `Switch to ${mode}`, exact: true }).click();
    await page.waitForTimeout(350);
    const frames = await page.evaluate(() => {
      window.modeSampling = false;
      return window.modeFrames;
    });
    assert.ok(
      frames.every((height) => height === geometry.height),
      `Mode ${mode} keeps the pane height in every frame: ${frames}`,
    );
    assert.equal(
      await row("folder.dir/child.txt").count(),
      1,
      "Expanded children survive mode switches",
    );
    const actions = await page
      .getByRole("button", { name: `Switch to ${mode === "git" ? "folder" : "git"}`, exact: true })
      .locator("..")
      .evaluate((header) =>
        [...header.querySelectorAll("button")]
          .slice(2)
          .map((button) => button.getBoundingClientRect().x),
      );
    assert.deepEqual(actions, geometry.actions, "Action slots keep their order and position");
  }
  assert.equal(
    await page.locator('[data-folder-pane="0"] > hr').count(),
    1,
    "The last pane has a divider",
  );
  assert.equal(
    await page.locator("#folder-sidebar [data-tauri-drag-region]").count(),
    1,
    "Only the top band drags the window",
  );
  await page.getByRole("button", { name: "Switch to git", exact: true }).click();
  await child.waitFor();
  const branch = page.getByText("feature/a-long-branch-name", { exact: true });
  await branch.waitFor();
  assert.equal(await branch.evaluate((node) => getComputedStyle(node).textOverflow), "clip");
  assert.equal(
    await child.evaluate((element) => element.querySelector("svg").getBoundingClientRect().left),
    left,
    "Git and folder modes align their children",
  );
  await page.getByRole("button", { name: "Switch to folder", exact: true }).click();
  await child.waitFor();
  await reset();
  await row("alpha.txt").dragTo(row("other"));
  await row("alpha.txt").waitFor({ state: "detached" });
  await row("folder.dir").dragTo(row("other"));
  await row("folder.dir").waitFor({ state: "detached" });
  await row("other").click();
  await row("other/alpha.txt").waitFor();
  await row("other/folder.dir").click();
  await row("other/folder.dir/child.txt").waitFor();
  await row("other").click();
  await row("other").evaluate((node) => {
    const data = new DataTransfer();
    data.items.add(
      new File([new Uint8Array([137, 80, 78, 71])], "capture.png", { type: "image/png" }),
    );
    node.dispatchEvent(
      new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: data }),
    );
  });
  await page.getByPlaceholder("pasted-123.png", { exact: true }).waitFor();
  await page.getByPlaceholder("pasted-123.png", { exact: true }).fill("my-shot.png");
  await page.keyboard.press("Enter");
  await row("other/my-shot.png").waitFor();
  await page.goto(`${base}/tests/fixtures/files.html?terminal`);
  const terminal = page.locator('[data-terminal="drop-terminal"]');
  await terminal.locator(".xterm-screen").waitFor();
  await row("alpha.txt").dragTo(terminal);
  await page.waitForFunction(() =>
    window.fsCalls.some(
      ({ cmd, args }) => cmd === "pty_write" && args.data.includes("/files/alpha.txt"),
    ),
  );
  assert.equal(
    await row("alpha.txt").count(),
    1,
    "Dropping into a terminal does not move the file",
  );
  await terminal.click();
  await page.keyboard.press("Control+v");
  await page.waitForFunction(() =>
    window.fsCalls.some(
      ({ cmd, args }) => cmd === "pty_write" && args.data.includes("pasted-123.png"),
    ),
  );
  await page.evaluate(() => {
    window.clipboardPaths = ["/files/recording with spaces.mp4"];
  });
  await page.keyboard.press("Control+v");
  await page.waitForFunction(() =>
    window.fsCalls.some(
      ({ cmd, args }) =>
        cmd === "pty_write" && args.data.includes("'/files/recording with spaces.mp4'"),
    ),
  );
  assert.equal(
    await page.evaluate(() =>
      window.fsCalls
        .filter(({ cmd }) => cmd === "pty_write")
        .some(({ args }) => /[\r\n]/.test(args.data)),
    ),
    false,
    "File paths never submit a command",
  );
  await verifyFileDragging(page, base);
  assert.deepEqual(errors, []);
  return "file/folder rename, range/toggle selection, batch paste/delete, nested deletion, retry and keyboard selection";
}
