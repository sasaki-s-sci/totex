import assert from "node:assert/strict";

/** Following, a clash and a deletion on the real Window, against a file held in memory. */
export async function verifyFileFollow(page, base = "http://127.0.0.1:18422") {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem("totex.language", "en");
    let serial = 0;
    const callbacks = new Map();
    const listeners = new Map();
    const file = { text: "alpha\nbeta\ngamma\n", exists: true, time: 1 };
    window.file = file;
    window.calls = [];
    const told = () => {
      for (const [id, listener] of listeners)
        if (listener.event === "fs:changed")
          callbacks.get(listener.callback)?.({ event: listener.event, id, payload: ["/tmp"] });
    };
    window.changeFile = (text) => {
      if (text === null) file.exists = false;
      else Object.assign(file, { text, exists: true });
      file.time += 1;
      told();
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
        window.calls.push(cmd);
        if (cmd === "plugin:event|listen") {
          const id = ++serial;
          listeners.set(id, { event: args.event, callback: args.handler });
          return id;
        }
        if (cmd === "plugin:event|unlisten") return listeners.delete(args.eventId);
        if (
          [
            "pty_sessions",
            "pty_doing",
            "pty_typed",
            "mcp_reports",
            "list_roots",
            "describe_folders",
            "update_standing",
            "overseer_sessions",
            "overseer_statuses",
            "overseer_distros",
          ].includes(cmd)
        )
          return [];
        if (cmd === "app_settings_read")
          return {
            path: "/tmp/totex.json",
            text: JSON.stringify(args.initial),
            value: args.initial,
          };
        if (cmd === "stat_file") {
          if (args.path !== "/tmp/note.txt") return { size: 1, modifiedMs: 1 };
          if (!file.exists) throw "no-such-file";
          return { size: file.text.length, modifiedMs: file.time };
        }
        if (cmd === "read_file_head") {
          if (args.path !== "/tmp/note.txt")
            return { path: args.path, name: "x", text: "{}", size: 2, truncated: false };
          if (!file.exists) throw "no-such-file";
          return {
            path: args.path,
            name: "note.txt",
            text: file.text,
            size: file.text.length,
            truncated: false,
          };
        }
        if (cmd === "write_file") {
          if (args.path !== "/tmp/note.txt") return args.text.length;
          if (!file.exists) throw "no-such-file";
          if (args.expectSize !== file.text.length) throw "changed";
          file.text = args.text;
          file.time += 1;
          setTimeout(told, 30);
          return file.text.length;
        }
        if (cmd === "fs_create_entry") {
          if (file.exists) throw "already-exists";
          Object.assign(file, { exists: true, text: "", time: file.time + 1 });
          setTimeout(told, 30);
          return "/tmp/note.txt";
        }
        if (cmd === "file_diff")
          return { standing: "unknown", patch: "", truncated: false, runs: [] };
        return null;
      },
    };
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
  });
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto(`${base}/tests/fixtures/pages.html`);
  const notes = page.getByRole("textbox", { name: "note.txt", exact: true });
  const note = notes.first();
  await note.waitFor();
  const text = () => note.evaluate((element) => element.textContent);
  await page.waitForFunction(() => window.calls.includes("stat_file"));

  // 1. Followed: a change made elsewhere is taken up.
  await page.evaluate(() => window.changeFile("alpha\nbeta\ngamma\ndelta\n"));
  await page.waitForFunction(() =>
    document.querySelector('[role="textbox"][aria-label="note.txt"]').textContent.includes("delta"),
  );

  // 2. A clash: both change the last line before the page writes.
  await note.evaluate((element) => {
    element.focus();
    getSelection().collapse(element.firstChild, element.firstChild.length);
  });
  await page.keyboard.type("mine");
  await page.evaluate(() => window.changeFile("alpha\nbeta\ngamma\ndeltatheirs\n"));
  const standing = page.locator(".file-standing");
  await standing.getByText("Conflict").waitFor();
  await page.waitForTimeout(1200);
  assert.equal(await page.evaluate(() => window.file.text), "alpha\nbeta\ngamma\ndeltatheirs\n");
  assert.match(await text(), /deltamine\n$/);
  // Moving again leaves the page alone.
  await page.evaluate(() => window.changeFile("ALPHA\nbeta\ngamma\ndeltatheirs\n"));
  await page.waitForTimeout(400);
  assert.match(await text(), /^alpha[\s\S]*deltamine\n$/);
  // A blur does not write over the file either.
  await note.evaluate((element) => element.blur());
  await page.waitForTimeout(800);
  assert.equal(await page.evaluate(() => window.file.text), "ALPHA\nbeta\ngamma\ndeltatheirs\n");

  await standing.getByRole("button", { name: "Open beside" }).dispatchEvent("click");
  await page.waitForFunction(
    () => document.querySelectorAll('[role="textbox"][aria-label="note.txt"]').length === 2,
  );
  await page.waitForFunction(() =>
    [...document.querySelectorAll('[role="textbox"][aria-label="note.txt"]')].some((one) =>
      one.textContent.startsWith("ALPHA"),
    ),
  );

  await standing.getByRole("button", { name: "Save over" }).dispatchEvent("click");
  await standing.waitFor({ state: "detached" });
  assert.equal(await page.evaluate(() => window.file.text), "alpha\nbeta\ngamma\ndeltamine\n");
  // The page beside follows what was written.
  await page.waitForFunction(() =>
    document
      .querySelectorAll('[role="textbox"][aria-label="note.txt"]')[1]
      ?.textContent.endsWith("mine\n"),
  );

  // 3. Deleted: said in both, saved back from the first.
  await page.evaluate(() => window.changeFile(null));
  await page.locator(".file-standing").first().getByText("Deleted").waitFor();
  assert.equal(await page.locator(".file-standing").count(), 2);
  await page
    .locator(".file-standing")
    .first()
    .getByRole("button", { name: "Save" })
    .dispatchEvent("click");
  await page.waitForFunction(() => window.file.exists && window.file.text.endsWith("mine\n"));
  await page.waitForFunction(() => document.querySelectorAll(".file-standing").length === 0);

  // Deleted again, then closed without writing.
  await page.evaluate(() => window.changeFile(null));
  await page.waitForFunction(() => document.querySelectorAll(".file-standing").length === 2);
  const before = await page.evaluate(
    () => window.calls.filter((cmd) => cmd === "write_file" || cmd === "fs_create_entry").length,
  );
  await page
    .locator(".file-standing")
    .first()
    .getByRole("button", { name: "Close" })
    .dispatchEvent("click");
  await page.waitForFunction(
    () => document.querySelectorAll('[role="textbox"][aria-label="note.txt"]').length === 1,
  );
  await page
    .locator(".file-standing")
    .getByRole("button", { name: "Close" })
    .dispatchEvent("click");
  await page.waitForFunction(
    () => document.querySelectorAll('[role="textbox"][aria-label="note.txt"]').length === 0,
  );
  assert.equal(
    await page.evaluate(
      () => window.calls.filter((cmd) => cmd === "write_file" || cmd === "fs_create_entry").length,
    ),
    before,
  );
  assert.equal(await page.evaluate(() => window.file.exists), false);
  assert.deepEqual(errors, []);
}
