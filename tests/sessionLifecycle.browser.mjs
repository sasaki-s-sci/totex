import assert from "node:assert/strict";

/** Real session hook: a destructive caller may proceed only after confirmed termination. */
export async function verifySessionLifecycle(page, base = "http://127.0.0.1:18422") {
  await page.addInitScript(() => {
    window.sessionCalls = [];
    window.refuseSession = "visible";
    window.refuseListing = false;
    window.nativeSessions = [];
    window.__TAURI_INTERNALS__ = {
      async invoke(cmd, args) {
        window.sessionCalls.push({ cmd, args });
        if (cmd === "pty_sessions") {
          if (window.refuseListing) throw new Error("Cannot list sessions");
          return structuredClone(window.nativeSessions);
        }
        if (cmd === "pty_close") {
          if (args.id === window.refuseSession) throw new Error("Cannot end session");
          window.nativeSessions = window.nativeSessions.filter((session) => session.id !== args.id);
        }
      },
    };
  });
  await page.goto(`${base}/tests/fixtures/session-lifecycle.html`);
  await page.waitForFunction(
    () => window.endWorktree && window.sessionCalls.some((call) => call.cmd === "pty_sessions"),
  );
  await page.evaluate(() => {
    window.nativeSessions = [{ id: "unseen", cwd: "/repo", rows: 24, cols: 80, meta: null }];
  });
  const remove = () =>
    page.evaluate(async () => {
      try {
        await window.endWorktree("/repo");
        await window.__TAURI_INTERNALS__.invoke("delete_branch", {
          repoId: "repo",
          branch: "feature",
        });
        return true;
      } catch {
        return false;
      }
    });
  assert.equal(await remove(), false);
  assert.deepEqual(
    await page.evaluate(() =>
      window.sessionCalls
        .filter((call) => call.cmd === "pty_close")
        .map((call) => call.args.id)
        .sort(),
    ),
    ["unseen", "visible"],
  );
  assert.equal(
    await page.evaluate(() => window.sessionCalls.some((call) => call.cmd === "delete_branch")),
    false,
  );
  assert.deepEqual(
    await page.evaluate(async () =>
      (await window.sessionSnapshot()).values["sessions.list"].map((session) => session.id),
    ),
    ["visible", "other"],
  );
  await page.evaluate(() => {
    window.refuseListing = true;
    window.refuseSession = null;
  });
  assert.equal(await remove(), false, "A failed native listing must also block worktree deletion");
  await page.evaluate(() => {
    window.refuseListing = false;
  });
  assert.equal(await remove(), true);
  assert.deepEqual(
    await page.evaluate(async () =>
      (await window.sessionSnapshot()).values["sessions.list"].map((session) => session.id),
    ),
    ["other"],
  );
  return {
    passed:
      "worktree deletion waits for all visible and native sessions; close/list failures retain state and block deletion",
  };
}
